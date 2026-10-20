import { type Hash, type PublicClient } from '@zoltar/core-shared/evm/ethereum'
import { getActiveNetworkProfile } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'

import { resolveConfiguredRpcUrl } from '@zoltar/ui-core-shared/wallet/rpcConfig.js'
import { useEffect, useId, useRef, useState } from 'preact/hooks'

import { recordTransactionSettled, recordTransactionSubmitted, releaseTransactionActivityWatch } from '@zoltar/ui-core-shared/transactions/transactionActivityStore.js'
import { getTransactionFailureKind } from '@zoltar/ui-core-shared/transactions/transactionLifecycle.js'

import { parseDeploymentSetupInput, type DeploymentConfiguration } from '../protocol/config.js'

import { deploymentConfigurationForPlan, getTradingDeploymentPlan, isTradingDeploymentComplete, loadTradingDeploymentStatus, nextTradingDeploymentStep, type CoreDeployment, type TradingDeploymentPlan, type TradingDeploymentStep } from '../protocol/deployment.js'
import { createWalletContextSubscription, type InjectedEthereum } from '../protocol/injected.js'
import { readInjectedChainIdNumber, requireInjectedAccount, switchInjectedChain } from '@zoltar/ui-core-shared/wallet/injectedEthereum.js'
import { publicErrorMessage, validateRpcChainId, waitForActiveEnvironmentReady } from '../protocol/live.js'

import * as deploymentCopy from '../copy/deployment.js'

import { contractStatusPresentation, type DeploymentStatus, deploymentActionAvailability, inspectionPresentation, tradingDeploymentScope } from './tradingDeploymentPresentation.js'
import { isRecoverableContractReadError } from '@zoltar/ui-core-shared/lib/errors.js'

import { defaultTradingDeploymentSetupServices, type TradingDeploymentSetupServices } from './deploymentSetupServices.js'
import { useSignal } from '@preact/signals'

/** Roughly one mainnet block between checks for the Statoblast prerequisite. */
const BLOCKED_FACTORY_RECHECK_MILLISECONDS = 12_000

export type DeploymentWalletState = Readonly<{ account: string | undefined; connecting: boolean; networkName: string | undefined; ready: boolean }>

export type TradingDeploymentSetupOptions = {
	currentConfiguration?: DeploymentConfiguration
	onComplete(configuration: DeploymentConfiguration): void
	onWorkflowLockChange?(locked: boolean): void
	onWalletStateChange?(state: DeploymentWalletState): void
	services?: TradingDeploymentSetupServices
	walletControlRequestNonce?: number
}

type DeploymentInspection =
	| { phase: 'idle' }
	| { phase: 'loading'; plan?: TradingDeploymentPlan; client?: PublicClient }
	| { phase: 'blocked' | 'ready'; plan: TradingDeploymentPlan; client: PublicClient; status: DeploymentStatus; revision: number }
	| { phase: 'error'; message: string; plan?: TradingDeploymentPlan; client?: PublicClient; status?: DeploymentStatus; revision?: number }

type DeploymentInspectionView =
	| Readonly<{ phase: 'idle'; plan: undefined; status: undefined; message: undefined }>
	| Readonly<{ phase: 'loading'; plan: TradingDeploymentPlan | undefined; status: undefined; message: undefined }>
	| Readonly<{ phase: 'blocked' | 'ready'; plan: TradingDeploymentPlan; status: DeploymentStatus; message: undefined }>
	| Readonly<{ phase: 'error'; message: string; plan: TradingDeploymentPlan | undefined; status: DeploymentStatus | undefined }>

/** Keep the phase's required data together without exposing its RPC client or request revision. */
function projectInspection(snapshot: DeploymentInspection): DeploymentInspectionView {
	switch (snapshot.phase) {
		case 'idle':
			return { phase: snapshot.phase, plan: undefined, status: undefined, message: undefined }
		case 'loading':
			return { phase: snapshot.phase, plan: snapshot.plan, status: undefined, message: undefined }
		case 'blocked':
		case 'ready':
			return { phase: snapshot.phase, plan: snapshot.plan, status: snapshot.status, message: undefined }
		case 'error':
			return { phase: snapshot.phase, message: snapshot.message, plan: snapshot.plan, status: snapshot.status }
		default: {
			const unexpected: never = snapshot
			throw new Error(`Unsupported deployment inspection: ${JSON.stringify(unexpected)}`)
		}
	}
}

export function useTradingDeploymentSetup({ currentConfiguration, onComplete, onWorkflowLockChange = () => undefined, onWalletStateChange, services = defaultTradingDeploymentSetupServices, walletControlRequestNonce }: TradingDeploymentSetupOptions) {
	const activeNetwork = getActiveNetworkProfile()
	const deploymentScope = tradingDeploymentScope()
	const configuredRpcUrl = resolveConfiguredRpcUrl({ fallbackRpcUrl: activeNetwork.chain.rpcUrls.default.http[0] ?? '', networkId: activeNetwork.id })
	const [coreDeployments, setCoreDeployments] = useState<readonly CoreDeployment[]>([])
	const [registryLoading, setRegistryLoading] = useState(true)
	const [registryError, setRegistryError] = useState<string>()
	const [chainId, setChainId] = useState(currentConfiguration?.chainId.toString() ?? activeNetwork.chain.id.toString())
	const [rpcUrl, setRpcUrl] = useState(configuredRpcUrl)
	const [rpcOverride, setRpcOverride] = useState(true)
	const feeBps = '30'
	const [walletAccount, setWalletAccount] = useState<string>()
	const [walletChain, setWalletChain] = useState<number>()
	const [walletConnectionMessage, setWalletConnectionMessage] = useState<string>()
	const [walletConnecting, setWalletConnecting] = useState(false)
	const inspectionSnapshot = useSignal<DeploymentInspection>({ phase: 'idle' })
	const snapshot = inspectionSnapshot.value
	const inspectionState = snapshot.phase
	const plan = 'plan' in snapshot ? snapshot.plan : undefined
	const publicClient = 'client' in snapshot ? snapshot.client : undefined
	const deploymentStatus = 'status' in snapshot ? snapshot.status : undefined
	const inspectedRevision = 'revision' in snapshot ? snapshot.revision : undefined
	// The contract whose deployment transaction is running; each contract has its own action.
	const [busyStepId, setBusyStepId] = useState<TradingDeploymentStep['id']>()
	const busy = busyStepId !== undefined
	const [actionMessage, setActionMessage] = useState<string>()
	const [actionError, setActionError] = useState(false)
	const [retryNonce, setRetryNonce] = useState(0)
	const inputRevision = useRef(0)
	const walletConnectionPending = useRef(false)
	const walletConnectionRevision = useRef(0)
	const walletContextEventRevision = useRef(0)
	const mounted = useRef(true)
	const walletContextSubscription = useRef<ReturnType<typeof createWalletContextSubscription>>()
	const boundWalletProvider = useRef<InjectedEthereum>()
	const walletAccountConnected = useRef(false)
	walletAccountConnected.current = walletAccount !== undefined
	if (walletContextSubscription.current === undefined)
		walletContextSubscription.current = createWalletContextSubscription(eventName => {
			walletContextEventRevision.current += 1
			if (walletConnectionPending.current) return
			walletConnectionRevision.current += 1
			const revision = walletConnectionRevision.current
			const provider = boundWalletProvider.current
			const dropWalletContext = () => {
				if (!mounted.current || walletConnectionRevision.current !== revision) return
				setWalletAccount(undefined)
				setWalletChain(undefined)
				setWalletConnectionMessage(deploymentCopy.walletChanged)
			}
			// A network change keeps the connected account, so setup follows the wallet's chain and offers the switch back instead of disconnecting.
			if (eventName !== 'chainChanged' || provider === undefined || !walletAccountConnected.current) return dropWalletContext()
			void readInjectedChainIdNumber(provider).then(chainId => {
				if (mounted.current && walletConnectionRevision.current === revision) setWalletChain(chainId)
			}, dropWalletContext)
		})
	useEffect(() => {
		if (busy || currentConfiguration === undefined) return
		const nextChainId = currentConfiguration.chainId.toString()
		const nextRpcUrl = configuredRpcUrl
		if (chainId === nextChainId && rpcUrl === nextRpcUrl && rpcOverride) return
		inputRevision.current += 1
		setChainId(nextChainId)
		setRpcUrl(nextRpcUrl)
		setRpcOverride(true)
	}, [busy, chainId, configuredRpcUrl, currentConfiguration, rpcOverride, rpcUrl])
	useEffect(() => {
		if (busy || currentConfiguration !== undefined) return
		const nextChainId = activeNetwork.chain.id.toString()
		if (coreDeployments.length > 0 && !coreDeployments.some(deployment => deployment.chainId.toString() === nextChainId)) return
		if (chainId === nextChainId && rpcUrl === configuredRpcUrl && rpcOverride) return
		inputRevision.current += 1
		setChainId(nextChainId)
		setRpcUrl(configuredRpcUrl)
		setRpcOverride(true)
	}, [activeNetwork.chain.id, busy, chainId, configuredRpcUrl, coreDeployments, currentConfiguration, rpcOverride, rpcUrl])
	const selectedCore = coreDeployments.find(deployment => deployment.chainId.toString() === chainId)
	// The chain the settings asked for; when the registry has no core deployment there, setup falls back to the first registered chain and says so.
	const requestedChainId = currentConfiguration?.chainId.toString() ?? activeNetwork.chain.id.toString()
	const requestedNetworkName = requestedChainId === activeNetwork.chain.id.toString() ? activeNetwork.displayName : deploymentCopy.chainLabel(requestedChainId)
	const fallbackNotice = selectedCore !== undefined && selectedCore.chainId.toString() !== requestedChainId && !coreDeployments.some(deployment => deployment.chainId.toString() === requestedChainId) ? deploymentCopy.networkFallback(requestedNetworkName, selectedCore.chainName) : undefined
	useEffect(() => {
		if (busy || coreDeployments.length === 0 || selectedCore !== undefined) return
		inputRevision.current += 1
		setChainId(coreDeployments[0]?.chainId.toString() ?? '')
	}, [busy, chainId, coreDeployments, selectedCore])
	useEffect(() => {
		if (busy || rpcOverride || selectedCore === undefined || rpcUrl === selectedCore.defaultRpcUrl) return
		inputRevision.current += 1
		setRpcUrl(selectedCore.defaultRpcUrl)
	}, [busy, rpcOverride, rpcUrl, selectedCore])
	const effectiveRpcUrl = rpcOverride ? rpcUrl : (selectedCore?.defaultRpcUrl ?? rpcUrl)
	const walletConnected = walletAccount !== undefined
	const walletReady = walletConnected && selectedCore !== undefined && walletChain === selectedCore.chainId
	let inputError: string | undefined
	if (chainId !== '' && rpcUrl !== '') {
		try {
			parseDeploymentSetupInput({ chainId, feeBps, rpcUrl })
		} catch (error) {
			inputError = publicErrorMessage(error, deploymentCopy.deploymentConfigurationInvalid)
		}
	}

	useEffect(() => {
		let active = true
		setRegistryLoading(true)
		setRegistryError(undefined)
		setCoreDeployments([])
		void (async () => {
			try {
				const deployments = await services.loadCoreDeployments()
				if (!active) return
				setCoreDeployments(deployments)
			} catch (error) {
				if (!active) return
				setRegistryError(publicErrorMessage(error, deploymentCopy.supportedNetworksUnavailable))
			} finally {
				if (active) setRegistryLoading(false)
			}
		})()
		return () => {
			active = false
		}
	}, [retryNonce, services])

	useEffect(() => {
		const revision = inputRevision.current
		inspectionSnapshot.value = { phase: 'idle' }
		setActionMessage(undefined)
		setActionError(false)
		if (selectedCore === undefined || chainId === '' || effectiveRpcUrl === '' || inputError !== undefined) {
			return
		}
		let active = true
		inspectionSnapshot.value = { phase: 'loading' }
		void (async () => {
			try {
				const input = parseDeploymentSetupInput({ chainId, feeBps, rpcUrl: effectiveRpcUrl })
				const nextPlan = getTradingDeploymentPlan(selectedCore, input.feeBps)
				await waitForActiveEnvironmentReady()
				if (!active || revision !== inputRevision.current) return
				inspectionSnapshot.value = { phase: 'loading', plan: nextPlan }
				const client = services.createPublicClient(input.rpcUrl)
				validateRpcChainId(await client.getChainId(), input.chainId)
				if (!active || revision !== inputRevision.current) return
				inspectionSnapshot.value = { phase: 'loading', plan: nextPlan, client }
				const securityPoolFactoryCode = await client.getCode({ address: nextPlan.core.securityPoolFactory })
				if (securityPoolFactoryCode === undefined || securityPoolFactoryCode === '0x') {
					if (!active || revision !== inputRevision.current) return
					inspectionSnapshot.value = { phase: 'blocked', plan: nextPlan, client, status: { factory: false, router: false }, revision }
					return
				}
				const status = await loadTradingDeploymentStatus(client, nextPlan)
				if (!active || revision !== inputRevision.current) return
				inspectionSnapshot.value = { phase: 'ready', plan: nextPlan, client, status, revision }
				if (isTradingDeploymentComplete(nextPlan, status)) {
					const configuration = deploymentConfigurationForPlan(nextPlan, input.rpcUrl)
					onComplete(configuration)
					return
				}
			} catch (error) {
				if (!active) return
				inspectionSnapshot.value = { ...inspectionSnapshot.value, phase: 'error', message: publicErrorMessage(error, deploymentCopy.inspectionFailed) }
			}
		})()
		return () => {
			active = false
		}
	}, [chainId, effectiveRpcUrl, feeBps, inputError, onComplete, retryNonce, selectedCore, services])

	// A missing Statoblast factory is looked up again on its own, so deploying Statoblast elsewhere continues this page without a
	// manual retry: on an interval while the page is visible, and whenever it becomes visible or focused again. Finding it
	// continues in place with the same plan and client, so the contract rows stay mounted and the registry is not fetched again.
	// A failed lookup waits for the next check; an unexpected failure ends the rechecks with the inspection error and its retry.
	useEffect(() => {
		const blocked = inspectionSnapshot.value
		if (blocked.phase !== 'blocked') return
		const { plan, client: publicClient } = blocked
		let active = true
		const factory = plan.core.securityPoolFactory
		const recheck = async () => {
			if (document.hidden) return
			try {
				const code = await publicClient.getCode({ address: factory })
				if (!active || code === undefined || code === '0x') return
				const status = await loadTradingDeploymentStatus(publicClient, plan)
				if (!active) return
				inspectionSnapshot.value = { ...blocked, phase: 'ready', status }
				if (isTradingDeploymentComplete(plan, status)) onComplete(deploymentConfigurationForPlan(plan, parseDeploymentSetupInput({ chainId, feeBps, rpcUrl: effectiveRpcUrl }).rpcUrl))
			} catch (error) {
				if (!active || isRecoverableContractReadError(error)) return
				inspectionSnapshot.value = { ...inspectionSnapshot.value, phase: 'error', message: publicErrorMessage(error, deploymentCopy.inspectionFailed) }
			}
		}
		const recheckNow = () => void recheck()
		const timer = setInterval(recheckNow, BLOCKED_FACTORY_RECHECK_MILLISECONDS)
		document.addEventListener('visibilitychange', recheckNow)
		window.addEventListener('focus', recheckNow)
		return () => {
			active = false
			clearInterval(timer)
			document.removeEventListener('visibilitychange', recheckNow)
			window.removeEventListener('focus', recheckNow)
		}
	}, [chainId, effectiveRpcUrl, feeBps, inspectionState, onComplete, plan, publicClient])

	function bindWalletProvider(provider: InjectedEthereum | undefined) {
		boundWalletProvider.current = provider
		walletContextSubscription.current?.bind(provider)
	}
	useEffect(() => {
		mounted.current = true
		bindWalletProvider(services.getWalletProvider?.())
		return () => {
			mounted.current = false
			walletConnectionRevision.current += 1
			walletConnectionPending.current = false
			walletContextSubscription.current?.dispose()
			boundWalletProvider.current = undefined
		}
	}, [services])
	async function connectDeploymentWallet() {
		if (walletConnectionPending.current) return
		walletConnectionPending.current = true
		setWalletConnecting(true)
		const revision = walletConnectionRevision.current + 1
		walletConnectionRevision.current = revision
		setWalletConnectionMessage(undefined)
		try {
			const initialProvider = services.getWalletProvider?.()
			bindWalletProvider(initialProvider)
			if (initialProvider === undefined && services.connectWallet === undefined) throw new Error(deploymentCopy.walletNotFound)
			if (initialProvider !== undefined && selectedCore !== undefined) {
				const currentChain = await readInjectedChainIdNumber(initialProvider)
				if (currentChain !== selectedCore.chainId) {
					await switchInjectedChain(initialProvider, selectedCore.chainId)
					const switchedChain = await readInjectedChainIdNumber(initialProvider)
					if (switchedChain !== selectedCore.chainId) throw new Error(deploymentCopy.walletMustUseNetwork(selectedCore.chainName))
				}
			}
			const connectService = services.connectWallet
			if (connectService === undefined) throw new Error(deploymentCopy.walletConnectionUnavailable)
			const connected = await connectService()
			if (!mounted.current || walletConnectionRevision.current !== revision) return
			const provider = initialProvider ?? connected.provider
			bindWalletProvider(provider)
			const contextRevision = walletContextEventRevision.current
			const account = provider === undefined ? connected.account : await requireInjectedAccount(provider)
			const connectedChain = provider === undefined ? connected.chainId : await readInjectedChainIdNumber(provider)
			if (walletContextEventRevision.current !== contextRevision) throw new Error(deploymentCopy.walletChangedDuringConnection)
			const currentProvider = services.getWalletProvider?.()
			if (provider !== undefined && currentProvider !== undefined && currentProvider !== provider) throw new Error(deploymentCopy.activeWalletChangedDuringConnection)
			if (!mounted.current || walletConnectionRevision.current !== revision) return
			setWalletAccount(account)
			setWalletChain(connectedChain)
		} catch (error) {
			if (!mounted.current || walletConnectionRevision.current !== revision) return
			setWalletAccount(undefined)
			setWalletChain(undefined)
			setWalletConnectionMessage(publicErrorMessage(error, deploymentCopy.walletConnectionFailed))
		} finally {
			if (mounted.current && walletConnectionRevision.current === revision) {
				walletConnectionPending.current = false
				setWalletConnecting(false)
			}
		}
	}
	function disconnectDeploymentWallet() {
		walletConnectionRevision.current += 1
		walletConnectionPending.current = false
		setWalletConnecting(false)
		setWalletAccount(undefined)
		setWalletChain(undefined)
		setWalletConnectionMessage(undefined)
	}
	const walletControlRevision = useRef(walletControlRequestNonce)
	useEffect(() => {
		onWalletStateChange?.({ account: walletAccount, connecting: walletConnecting, networkName: selectedCore?.chainName, ready: !registryLoading && registryError === undefined && selectedCore !== undefined })
	}, [onWalletStateChange, registryError, registryLoading, selectedCore, walletAccount, walletConnecting])
	useEffect(
		() => () => {
			onWalletStateChange?.({ account: undefined, connecting: false, networkName: undefined, ready: false })
		},
		[onWalletStateChange],
	)
	useEffect(() => {
		if (walletControlRequestNonce === undefined || walletControlRevision.current === walletControlRequestNonce) return
		walletControlRevision.current = walletControlRequestNonce
		if (walletAccount === undefined) void connectDeploymentWallet()
		else disconnectDeploymentWallet()
	}, [walletControlRequestNonce])
	const deploymentComplete = plan !== undefined && deploymentStatus !== undefined && isTradingDeploymentComplete(plan, deploymentStatus)
	const deploymentSteps =
		plan === undefined
			? []
			: [plan.factory, plan.router].map(step => {
					const deployed = deploymentStatus?.[step.id]
					const isNext = inspectionState === 'ready' && nextTradingDeploymentStep(plan, deploymentStatus ?? { factory: false, router: false })?.id === step.id && !deploymentComplete
					return { step, presentation: contractStatusPresentation(deployed, isNext, inspectionState === 'error') }
				})
	const inspectionIsCurrent = inspectedRevision === inputRevision.current
	const inspectionBadge = inspectionPresentation(inspectionState, { busy, deploymentComplete, inputError: inputError !== undefined, plan: plan !== undefined, registryError: registryError !== undefined, registryLoading })
	// Only a failed read needs a manual retry; a missing Statoblast factory is rechecked automatically.
	const retryChecks = registryError !== undefined || inspectionState === 'error'
	const inspectionBadgeId = useId()
	const networkNoticeId = useId()
	const wrongNetworkNotice = walletConnected && !walletReady && selectedCore !== undefined ? deploymentCopy.connectedWalletMustUseNetwork(selectedCore.chainName) : undefined
	/** `step` is undefined before a plan exists; the shared reasons (networks, settings, inspection) then explain the placeholder action. */
	function stepAvailability(step: TradingDeploymentStep | undefined) {
		const missingPrerequisite = plan === undefined || step === undefined ? undefined : step.dependencies.map(dependency => plan[dependency]).find(dependency => deploymentStatus?.[dependency.id] !== true)
		const availability = deploymentActionAvailability({
			busy,
			inputError: inputError !== undefined,
			inspectionIsCurrent,
			inspectionState,
			prerequisiteLabel: missingPrerequisite?.label,
			registryError: registryError !== undefined,
			registryLoading,
			selectedCoreChainName: selectedCore?.chainName,
			settingsIncomplete: selectedCore === undefined || chainId === '' || effectiveRpcUrl === '',
			stepDeployed: step !== undefined && deploymentStatus?.[step.id] === true,
			walletConnected,
			walletReady,
		})
		// The inspection badge or the network notice already states a shared blocked reason; the action references it instead of repeating it.
		let externalReasonId: string | undefined
		if (inspectionBadge !== undefined && inspectionBadge.label === availability.reason) externalReasonId = inspectionBadgeId
		else if (wrongNetworkNotice !== undefined && availability.reason === deploymentCopy.walletMustUseNetwork(selectedCore?.chainName ?? '')) externalReasonId = networkNoticeId
		return { availability, externalReasonId }
	}
	async function deployStepNow(step: TradingDeploymentStep) {
		if (busy || registryLoading || registryError !== undefined || inspectedRevision === undefined || inspectedRevision !== inputRevision.current || plan === undefined || publicClient === undefined || deploymentStatus === undefined) return
		// Each button deploys only its own contract, and only once the contracts it depends on exist.
		if (deploymentStatus[step.id] || step.dependencies.some(dependency => !deploymentStatus[dependency])) return
		setBusyStepId(step.id)
		onWorkflowLockChange(true)
		setActionMessage(undefined)
		setActionError(false)
		let broadcastHash: Hash | undefined
		try {
			const deployStep = services.deployStep ?? defaultTradingDeploymentSetupServices.deployStep
			if (deployStep === undefined) throw new Error(deploymentCopy.deploymentUnavailable)
			await deployStep(publicClient, plan, step, hash => {
				// A replacement broadcast takes over the row of the transaction it replaced.
				recordTransactionSubmitted({ hash, previousHash: broadcastHash, scope: deploymentScope, title: deploymentCopy.formatDeployStep(step.label) })
				broadcastHash = hash
			})
			if (broadcastHash !== undefined) recordTransactionSettled(broadcastHash, { status: 'confirmed' })
			const status = await loadTradingDeploymentStatus(publicClient, plan)
			inspectionSnapshot.value = { phase: 'ready', plan, client: publicClient, status, revision: inspectedRevision }
			if (isTradingDeploymentComplete(plan, status)) {
				const input = parseDeploymentSetupInput({ chainId, feeBps, rpcUrl: effectiveRpcUrl })
				const configuration = deploymentConfigurationForPlan(plan, input.rpcUrl)
				onComplete(configuration)
				return
			}
			setActionMessage(deploymentCopy.contractDeployedContinue(step.label, nextTradingDeploymentStep(plan, status)?.label ?? deploymentCopy.nextContractFallbackLabel))
		} catch (error) {
			if (broadcastHash !== undefined) {
				// A reverted receipt settles the entry; any other failure leaves the activity list watching the broadcast.
				const failureKind = getTransactionFailureKind(error)
				if (failureKind === 'reverted' || failureKind === 'replaced') recordTransactionSettled(broadcastHash, { status: 'failed', failureKind })
				else releaseTransactionActivityWatch(broadcastHash)
			}
			setActionError(true)
			let detail = publicErrorMessage(error, deploymentCopy.deployFailed(step.label))
			try {
				const status = await loadTradingDeploymentStatus(publicClient, plan)
				inspectionSnapshot.value = { phase: 'ready', plan, client: publicClient, status, revision: inspectedRevision }
				if (status[step.id]) {
					if (isTradingDeploymentComplete(plan, status)) {
						const input = parseDeploymentSetupInput({ chainId, feeBps, rpcUrl: effectiveRpcUrl })
						const configuration = deploymentConfigurationForPlan(plan, input.rpcUrl)
						onComplete(configuration)
						return
					}
					setActionError(false)
					setActionMessage(deploymentCopy.contractAlreadyInstalledContinue(step.label, nextTradingDeploymentStep(plan, status)?.label ?? deploymentCopy.nextContractFallbackLabel))
					return
				}
			} catch (recoveryError) {
				detail = deploymentCopy.deploymentStatusUnverified(detail, publicErrorMessage(recoveryError, deploymentCopy.statusCheckFailed))
			}
			setActionMessage(broadcastHash === undefined ? detail : deploymentCopy.broadcastWithoutCompletion(broadcastHash, detail))
		} finally {
			setBusyStepId(undefined)
			onWorkflowLockChange(false)
		}
	}
	const retryInspection = () => {
		setRegistryLoading(true)
		setRegistryError(undefined)
		setRetryNonce(current => current + 1)
	}
	return {
		network: {
			loading: registryLoading,
			error: registryError,
			configurationError: inputError,
			core: selectedCore,
			fallbackNotice,
		},
		wallet: {
			account: walletAccount,
			connecting: walletConnecting,
			connectionMessage: walletConnectionMessage,
			canConnect: !busy && !registryLoading && coreDeployments.length > 0,
			networkNotice: wrongNetworkNotice,
			networkNoticeId,
		},
		inspection: {
			...projectInspection(snapshot),
			complete: deploymentComplete,
			steps: deploymentSteps,
			badge: inspectionBadge,
			badgeId: inspectionBadgeId,
			canRetry: retryChecks,
		},
		actions: {
			scope: deploymentScope,
			busy,
			pendingStepId: busyStepId,
			feedback: actionMessage === undefined ? undefined : { message: actionMessage, failed: actionError },
			availabilityFor: stepAvailability,
			connectWallet: connectDeploymentWallet,
			disconnectWallet: disconnectDeploymentWallet,
			deployStep: deployStepNow,
			retryInspection,
		},
	}
}
