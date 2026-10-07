import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { WalletConnectionControl } from '@zoltar/ui-core-shared/components/WalletConnectionControl.js'
import { createPublicClient, http, type Hash, type PublicClient } from '@zoltar/core-shared/evm/ethereum'
import { getActiveBackend, getActiveNetworkProfile } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import type { ChainBackend } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import { resolveConfiguredRpcUrl } from '@zoltar/ui-core-shared/wallet/rpcConfig.js'
import { useEffect, useId, useRef, useState } from 'preact/hooks'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { DeploymentStepList } from '@zoltar/ui-core-shared/components/DeploymentStepList.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { recordTransactionSettled, recordTransactionSubmitted, releaseTransactionActivityWatch } from '@zoltar/ui-core-shared/transactions/transactionActivityStore.js'
import { getTransactionFailureKind } from '@zoltar/ui-core-shared/transactions/transactionLifecycle.js'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { ReadOnlyAddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { parseDeploymentSetupInput, type DeploymentConfiguration } from '../protocol/config.js'
import { loadCoreDeployments } from '../protocol/coreDeployments.js'
import { deployTradingStep, deploymentConfigurationForPlan, getTradingDeploymentPlan, isTradingDeploymentComplete, loadTradingDeploymentStatus, nextTradingDeploymentStep, type CoreDeployment, type TradingDeploymentPlan, type TradingDeploymentStep } from '../protocol/deployment.js'
import { createWalletContextSubscription, getActiveInjectedProvider, type InjectedEthereum } from '../protocol/injected.js'
import { readInjectedChainIdNumber, requestInjectedAccount, requireInjectedAccount, switchInjectedChain } from '@zoltar/ui-core-shared/wallet/injectedEthereum.js'
import { createTradingWalletClient, publicErrorMessage, validateRpcChainId, waitForActiveEnvironmentReady } from '../protocol/live.js'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import * as coreAppCopy from '@zoltar/ui-core-shared/copy/app.js'
import * as appCopy from '../copy/app.js'
import * as deploymentCopy from '../copy/deployment.js'
import { deployContractsGuideHref } from '../lib/docsLinks.js'
import { contractStatusPresentation, type DeploymentStatus, deploymentActionAvailability, deploymentProgress, inspectionPresentation, PlaceholderDeployAction, tradingDeploymentScope } from './tradingDeploymentPresentation.js'
import { isRecoverableContractReadError } from '@zoltar/ui-core-shared/lib/errors.js'

/** How often a blocked deploy page looks for the Statoblast factory again; roughly one mainnet block. */
const BLOCKED_FACTORY_RECHECK_MILLISECONDS = 12_000

export type TradingDeploymentSetupServices = Readonly<{
	createPublicClient(rpcUrl: string): PublicClient
	connectWallet?(): Promise<{ account: string; chainId: number; provider?: InjectedEthereum }>
	deployStep?(publicClient: PublicClient, plan: TradingDeploymentPlan, step: TradingDeploymentStep, onSubmitted: (hash: Hash) => void): Promise<void>
	getWalletProvider?(): InjectedEthereum | undefined
	loadCoreDeployments(): Promise<readonly CoreDeployment[]>
}>

export type DeploymentWalletState = Readonly<{ account: string | undefined; connecting: boolean; networkName: string | undefined; ready: boolean }>

function createDeploymentReadClient(rpcUrl: string, backend: Pick<ChainBackend, 'createReadClient' | 'id'> = getActiveBackend()): PublicClient {
	return backend.id === 'simulation' ? backend.createReadClient() : createPublicClient({ transport: http(rpcUrl) })
}

const defaultServices: TradingDeploymentSetupServices = {
	createPublicClient: createDeploymentReadClient,
	connectWallet: async () => {
		const provider = getActiveInjectedProvider()
		if (provider === undefined) throw new Error(deploymentCopy.walletNotFound)
		const account = await requestInjectedAccount(provider)
		return { account, chainId: await readInjectedChainIdNumber(provider), provider }
	},
	getWalletProvider: getActiveInjectedProvider,
	deployStep: async (publicClient, plan, step, onSubmitted) => {
		const provider = getActiveInjectedProvider()
		if (provider === undefined) throw new Error(deploymentCopy.walletNotFound)
		let currentChainId = await readInjectedChainIdNumber(provider)
		if (currentChainId !== plan.core.chainId) {
			await switchInjectedChain(provider, plan.core.chainId)
			currentChainId = await readInjectedChainIdNumber(provider)
		}
		if (currentChainId !== plan.core.chainId) throw new Error(deploymentCopy.walletMustUseNetwork(plan.core.chainName))
		const account = await requestInjectedAccount(provider)
		const walletClient = createTradingWalletClient(provider, account)
		await deployTradingStep(walletClient, publicClient, plan, step, onSubmitted, async () => {
			validateRpcChainId(await publicClient.getChainId(), plan.core.chainId)
			if (getActiveInjectedProvider() !== provider || (await readInjectedChainIdNumber(provider)) !== plan.core.chainId || (await requestInjectedAccount(provider)) !== account) throw new Error(deploymentCopy.walletChangedBeforeDeployment)
		})
		if (getActiveInjectedProvider() !== provider || (await readInjectedChainIdNumber(provider)) !== plan.core.chainId || (await requestInjectedAccount(provider)) !== account) throw new Error(deploymentCopy.walletChangedDuringDeployment)
	},
	loadCoreDeployments,
}

export function TradingDeploymentSetup({
	currentConfiguration,
	onComplete,
	onWorkflowLockChange = () => undefined,
	onWalletStateChange,
	services = defaultServices,
	walletControlRequestNonce,
}: {
	currentConfiguration?: DeploymentConfiguration
	onComplete(configuration: DeploymentConfiguration): void
	onWorkflowLockChange?(locked: boolean): void
	onWalletStateChange?(state: DeploymentWalletState): void
	services?: TradingDeploymentSetupServices
	walletControlRequestNonce?: number
}) {
	const activeNetwork = getActiveNetworkProfile()
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
	const [inspectionState, setInspectionState] = useState<'blocked' | 'idle' | 'loading' | 'ready' | 'error'>('idle')
	const [inspectionError, setInspectionError] = useState<string>()
	const [plan, setPlan] = useState<TradingDeploymentPlan>()
	const [publicClient, setPublicClient] = useState<PublicClient>()
	const [deploymentStatus, setDeploymentStatus] = useState<DeploymentStatus>()
	// The contract whose deployment transaction is running; each contract has its own action.
	const [busyStepId, setBusyStepId] = useState<TradingDeploymentStep['id']>()
	const busy = busyStepId !== undefined
	const [actionMessage, setActionMessage] = useState<string>()
	const [actionError, setActionError] = useState(false)
	const [retryNonce, setRetryNonce] = useState(0)
	const [inspectedRevision, setInspectedRevision] = useState<number>()
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
		setPlan(undefined)
		setPublicClient(undefined)
		setDeploymentStatus(undefined)
		setActionMessage(undefined)
		setActionError(false)
		setInspectedRevision(undefined)
		if (selectedCore === undefined || chainId === '' || effectiveRpcUrl === '' || inputError !== undefined) {
			setInspectionState('idle')
			setInspectionError(undefined)
			return
		}
		let active = true
		setInspectionState('loading')
		setInspectionError(undefined)
		void (async () => {
			try {
				const input = parseDeploymentSetupInput({ chainId, feeBps, rpcUrl: effectiveRpcUrl })
				const nextPlan = getTradingDeploymentPlan(selectedCore, input.feeBps)
				await waitForActiveEnvironmentReady()
				if (!active || revision !== inputRevision.current) return
				setPlan(nextPlan)
				const client = services.createPublicClient(input.rpcUrl)
				validateRpcChainId(await client.getChainId(), input.chainId)
				if (!active || revision !== inputRevision.current) return
				setPublicClient(client)
				const securityPoolFactoryCode = await client.getCode({ address: nextPlan.core.securityPoolFactory })
				if (securityPoolFactoryCode === undefined || securityPoolFactoryCode === '0x') {
					if (!active || revision !== inputRevision.current) return
					setDeploymentStatus({ factory: false, router: false })
					setInspectedRevision(revision)
					setInspectionState('blocked')
					return
				}
				const status = await loadTradingDeploymentStatus(client, nextPlan)
				if (!active || revision !== inputRevision.current) return
				setDeploymentStatus(status)
				setInspectedRevision(revision)
				setInspectionState('ready')
				if (isTradingDeploymentComplete(nextPlan, status)) {
					const configuration = deploymentConfigurationForPlan(nextPlan, input.rpcUrl)
					onComplete(configuration)
					return
				}
			} catch (error) {
				if (!active) return
				setInspectionState('error')
				setInspectionError(publicErrorMessage(error, deploymentCopy.inspectionFailed))
			}
		})()
		return () => {
			active = false
		}
	}, [chainId, effectiveRpcUrl, feeBps, inputError, onComplete, retryNonce, selectedCore, services])

	// A missing Statoblast factory is looked up again on its own, so deploying Statoblast elsewhere continues this page without a
	// manual retry: on an interval while the page is visible, and whenever it becomes visible or focused again. Finding it
	// continues in place with the same plan and client, so the contract rows stay mounted and the registry is not fetched again.
	useEffect(() => {
		if (inspectionState !== 'blocked' || publicClient === undefined || plan === undefined) return
		let active = true
		const factory = plan.core.securityPoolFactory
		const recheck = async () => {
			if (document.hidden) return
			try {
				const code = await publicClient.getCode({ address: factory })
				if (!active || code === undefined || code === '0x') return
				const status = await loadTradingDeploymentStatus(publicClient, plan)
				if (!active) return
				setDeploymentStatus(status)
				setInspectionState('ready')
				if (isTradingDeploymentComplete(plan, status)) onComplete(deploymentConfigurationForPlan(plan, parseDeploymentSetupInput({ chainId, feeBps, rpcUrl: effectiveRpcUrl }).rpcUrl))
			} catch (error) {
				if (!isRecoverableContractReadError(error)) throw error
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
	const inspection = inspectionPresentation(inspectionState, { busy, deploymentComplete, inputError: inputError !== undefined, plan: plan !== undefined, registryError: registryError !== undefined, registryLoading })
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
		if (inspection !== undefined && inspection.label === availability.reason) externalReasonId = inspectionBadgeId
		else if (wrongNetworkNotice !== undefined && availability.reason === deploymentCopy.walletMustUseNetwork(selectedCore?.chainName ?? '')) externalReasonId = networkNoticeId
		return { availability, externalReasonId }
	}
	let standaloneWalletButton
	if (walletControlRequestNonce === undefined)
		standaloneWalletButton = walletConnected ? (
			<WalletConnectionControl disabled={busy} ariaLabel={appCopy.disconnectWalletLabel(walletAccount)} title={appCopy.disconnectWallet} onClick={disconnectDeploymentWallet} label={<ReadOnlyAddressValue address={walletAccount} responsiveAbbreviation />} />
		) : (
			<WalletConnectionControl disabled={busy || registryLoading || coreDeployments.length === 0} pending={walletConnecting} onClick={() => void connectDeploymentWallet()} pendingLabel={appCopy.connectingWallet} label={appCopy.connectWallet} />
		)
	let retryAction
	if (retryChecks)
		retryAction = (
			<button
				className='secondary'
				type='button'
				disabled={busy || registryLoading || inspectionState === 'loading'}
				onClick={() => {
					setRegistryLoading(true)
					setRegistryError(undefined)
					setRetryNonce(current => current + 1)
				}}
			>
				{deploymentCopy.retryChecks}
			</button>
		)
	async function deployStepNow(step: TradingDeploymentStep) {
		if (busy || registryLoading || registryError !== undefined || inspectedRevision !== inputRevision.current || plan === undefined || publicClient === undefined || deploymentStatus === undefined) return
		// Each button deploys only its own contract, and only once the contracts it depends on exist.
		if (deploymentStatus[step.id] || step.dependencies.some(dependency => !deploymentStatus[dependency])) return
		setBusyStepId(step.id)
		onWorkflowLockChange(true)
		setActionMessage(undefined)
		setActionError(false)
		let broadcastHash: Hash | undefined
		try {
			const deployStep = services.deployStep ?? defaultServices.deployStep
			if (deployStep === undefined) throw new Error(deploymentCopy.deploymentUnavailable)
			await deployStep(publicClient, plan, step, hash => {
				// A replacement broadcast takes over the row of the transaction it replaced.
				recordTransactionSubmitted({ hash, previousHash: broadcastHash, scope: tradingDeploymentScope, title: deploymentCopy.formatDeployStep(step.label) })
				broadcastHash = hash
			})
			if (broadcastHash !== undefined) recordTransactionSettled(broadcastHash, { status: 'confirmed' })
			const status = await loadTradingDeploymentStatus(publicClient, plan)
			setDeploymentStatus(status)
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
				setDeploymentStatus(status)
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
	return (
		<div className='route-view-flow'>
			<RouteHeader title={appCopy.deploy} description={appCopy.deployRouteDescription} actions={standaloneWalletButton} />
			<SectionBlock className='deployment-setup' title={deploymentCopy.tradingContracts}>
				<ErrorNotice message={registryError} />
				<ErrorNotice message={inputError} />
				{selectedCore === undefined ? null : (
					<DataGrid dense>
						<MetricField label={deploymentCopy.deployingTo}>{selectedCore.chainName}</MetricField>
						<MetricField label={deploymentCopy.securityPoolFactory}>
							<ReadOnlyAddressValue address={selectedCore.securityPoolFactory} responsiveAbbreviation />
						</MetricField>
					</DataGrid>
				)}
				{fallbackNotice === undefined ? null : <UserMessage className='detail' tone='warning' detail={fallbackNotice} />}
				{plan === undefined || deploymentComplete ? null : <UserMessage className='detail' detail={deploymentCopy.deploymentSequence(plan.factory.label, plan.router.label)} />}
				{plan === undefined ? null : (
					<DeploymentStepList
						steps={deploymentSteps.map(({ step, presentation }) => {
							const { availability, externalReasonId } = stepAvailability(step)
							return {
								// Every contract keeps its own deploy action in place; a deployed one stays, disabled, and says so.
								action: (
									<TransactionActionButton
										scope={tradingDeploymentScope}
										availability={availability}
										disabledReasonElementId={externalReasonId}
										idleLabel={deploymentCopy.formatDeployStep(step.label)}
										pendingLabel={deploymentCopy.formatDeployingStep(step.label)}
										pending={busyStepId === step.id}
										onClick={() => void deployStepNow(step)}
										showDisabledReason={externalReasonId === undefined}
									/>
								),
								address: step.address,
								badge: presentation,
								key: step.id,
								label: step.label,
							}
						})}
					/>
				)}
				<div className='deployment-setup__status' role='status' aria-live='polite'>
					<DataGrid dense>
						<MetricField label={deploymentCopy.deploymentProgress}>{deploymentProgress(deploymentStatus)}</MetricField>
					</DataGrid>
					{inspection === undefined ? null : (
						<Badge id={inspectionBadgeId} tone={inspection.tone}>
							{inspection.label}
						</Badge>
					)}
				</div>
				{inspectionState === 'blocked' && selectedCore !== undefined ? (
					<UserMessage
						placement='section'
						tone='warning'
						className='deployment-setup__prerequisite'
						detail={deploymentCopy.statoblastRequired(selectedCore.chainName)}
						actions={
							<a className='button-link secondary-link' href={deployContractsGuideHref} target='_blank' rel='noreferrer'>
								{deploymentCopy.deploymentGuide}
							</a>
						}
					/>
				) : null}
				<ErrorNotice id={networkNoticeId} message={wrongNetworkNotice} />
				{wrongNetworkNotice === undefined || selectedCore === undefined ? null : (
					<div className='actions'>
						<button type='button' className='secondary' disabled={busy || walletConnecting} aria-busy={walletConnecting} onClick={() => void connectDeploymentWallet()}>
							{walletConnecting ? deploymentCopy.switchingToNetwork(selectedCore.chainName) : coreAppCopy.formatSwitchToNetwork(selectedCore.chainName)}
						</button>
					</div>
				)}
				<ErrorNotice message={walletConnectionMessage} />
				<ErrorNotice message={inspectionError} />
				{actionMessage === undefined || actionError ? null : <UserMessage className='detail' announcement='polite' detail={actionMessage} />}
				<ErrorNotice message={actionError ? actionMessage : undefined} />
				{plan === undefined || retryAction !== undefined ? (
					<div className='actions'>
						{/* Until the network is known there are no contract rows; one disabled action keeps the place and explains what is missing. */}
						{plan === undefined ? <PlaceholderDeployAction {...stepAvailability(undefined)} /> : null}
						{retryAction}
					</div>
				) : null}
			</SectionBlock>
		</div>
	)
}
