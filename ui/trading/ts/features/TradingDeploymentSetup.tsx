import { WalletConnectionControl } from '@zoltar/ui-core-shared/components/WalletConnectionControl.js'
import { createPublicClient, http, type Hash, type PublicClient } from '@zoltar/core-shared/evm/ethereum'
import { getActiveBackend, getActiveNetworkProfile } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import type { ChainBackend } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import { resolveConfiguredRpcUrl } from '@zoltar/ui-core-shared/wallet/rpcConfig.js'
import { useEffect, useId, useRef, useState } from 'preact/hooks'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { DeploymentStepList } from '@zoltar/ui-core-shared/components/DeploymentStepList.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import type { ActionAvailability } from '@zoltar/ui-core-shared/types/components.js'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { ReadOnlyAddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { parseDeploymentSetupInput, type DeploymentConfiguration } from '../protocol/config.js'
import { loadCoreDeployments } from '../protocol/coreDeployments.js'
import { deployTradingStep, deploymentConfigurationForPlan, getTradingDeploymentPlan, isTradingDeploymentComplete, loadTradingDeploymentStatus, nextTradingDeploymentStep, type CoreDeployment, type TradingDeploymentPlan, type TradingDeploymentStep } from '../protocol/deployment.js'
import { createWalletContextSubscription, getInjectedEthereum, type InjectedEthereum } from '../protocol/injected.js'
import { readInjectedChainIdNumber, requestInjectedAccount, requireInjectedAccount, switchInjectedChain } from '@zoltar/ui-core-shared/wallet/injectedEthereum.js'
import { createTradingWalletClient, publicErrorMessage, validateRpcChainId, waitForActiveEnvironmentReady } from '../protocol/live.js'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import * as coreAppCopy from '@zoltar/ui-core-shared/copy/app.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as appCopy from '../copy/app.js'
import * as deploymentCopy from '../copy/deployment.js'

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
		const provider = getInjectedEthereum()
		if (provider === undefined) throw new Error(deploymentCopy.noInjectedWallet)
		const account = await requestInjectedAccount(provider)
		return { account, chainId: await readInjectedChainIdNumber(provider), provider }
	},
	getWalletProvider: getInjectedEthereum,
	deployStep: async (publicClient, plan, step, onSubmitted) => {
		const provider = getInjectedEthereum()
		if (provider === undefined) throw new Error(deploymentCopy.noInjectedWallet)
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
			if (getInjectedEthereum() !== provider || (await readInjectedChainIdNumber(provider)) !== plan.core.chainId || (await requestInjectedAccount(provider)) !== account) throw new Error(deploymentCopy.walletContextChangedBeforeDeployment)
		})
		if (getInjectedEthereum() !== provider || (await readInjectedChainIdNumber(provider)) !== plan.core.chainId || (await requestInjectedAccount(provider)) !== account) throw new Error(deploymentCopy.walletContextChangedDuringDeployment)
	},
	loadCoreDeployments,
}

type DeploymentStatus = Readonly<{ factory: boolean; router: boolean }>

function deploymentProgress(status: DeploymentStatus | undefined, total = 3) {
	if (status === undefined) return deploymentCopy.progressUnavailable
	return `${Number(status.factory) + Number(status.router)} / ${total.toString()}`
}

function inspectionPresentation(state: 'blocked' | 'idle' | 'loading' | 'ready' | 'error', { busy, deploymentComplete, inputError, plan, registryError, registryLoading }: Readonly<{ busy: boolean; deploymentComplete: boolean; inputError: boolean; plan: boolean; registryError: boolean; registryLoading: boolean }>) {
	if (registryLoading) return { label: deploymentCopy.loadingNetworks, tone: 'muted' as const }
	if (registryError) return { label: deploymentCopy.networksUnavailable, tone: 'warning' as const }
	if (inputError) return { label: appCopy.invalidDeploymentSettings, tone: 'warning' as const }
	if (busy) return { label: coreAppCopy.deploymentInProgress, tone: 'muted' as const }
	if (deploymentComplete) return { label: appCopy.deploymentComplete, tone: 'ok' as const }
	if (state === 'loading') return { label: deploymentCopy.checkingNetwork, tone: 'muted' as const }
	if (state === 'ready') return undefined
	if (state === 'blocked') return { label: appCopy.securityPoolFactoryNotDeployed, tone: 'warning' as const }
	if (state === 'error') return { label: deploymentCopy.configurationUnavailable, tone: 'warning' as const }
	if (plan) return { label: deploymentCopy.checkingNetwork, tone: 'muted' as const }
	return { label: appCopy.completeDeploymentSettings, tone: 'muted' as const }
}

function deploymentActionLabel(busy: boolean, nextStep: ReturnType<typeof nextTradingDeploymentStep>, plan: TradingDeploymentPlan | undefined, status: DeploymentStatus | undefined) {
	if (busy) return coreAppCopy.formatDeployingContract(nextStep?.label ?? deploymentCopy.contractFallbackLabel)
	if (plan !== undefined && status !== undefined && isTradingDeploymentComplete(plan, status)) return appCopy.deploymentComplete
	if (nextStep === undefined) return deploymentCopy.deployTradingContracts
	return coreAppCopy.formatDeployContract(nextStep.label)
}

/** Why the deploy action is unavailable, so the disabled control explains itself instead of silently ignoring clicks. */
function deploymentActionAvailability({
	inspectionIsCurrent,
	inspectionState,
	nextStep,
	registryError,
	registryLoading,
	selectedCoreChainName,
	walletConnected,
	walletReady,
}: Readonly<{ inspectionIsCurrent: boolean; inspectionState: 'blocked' | 'idle' | 'loading' | 'ready' | 'error'; nextStep: boolean; registryError: boolean; registryLoading: boolean; selectedCoreChainName: string | undefined; walletConnected: boolean; walletReady: boolean }>): ActionAvailability {
	if (registryLoading) return { disabled: true, loading: true, reason: deploymentCopy.loadingNetworks }
	if (registryError) return { disabled: true, reason: deploymentCopy.networksUnavailable }
	if (!inspectionIsCurrent || inspectionState === 'loading' || inspectionState === 'idle') return { disabled: true, loading: true, reason: deploymentCopy.checkingNetwork }
	if (inspectionState === 'blocked') return { disabled: true, reason: appCopy.securityPoolFactoryNotDeployed }
	if (inspectionState === 'error') return { disabled: true, reason: deploymentCopy.configurationUnavailable }
	if (!nextStep) return { disabled: true, reason: appCopy.deploymentComplete }
	if (!walletConnected) return { disabled: true, reason: commonCopy.walletConnectionRequired }
	if (!walletReady) return { disabled: true, reason: selectedCoreChainName === undefined ? deploymentCopy.configurationUnavailable : deploymentCopy.walletMustUseNetwork(selectedCoreChainName) }
	return { disabled: false, reason: undefined }
}

function contractStatusPresentation(deployed: boolean | undefined, isNext: boolean) {
	if (deployed === undefined) return { label: appCopy.checkingContract, tone: 'muted' as const }
	if (deployed) return { label: commonCopy.deployed, tone: 'ok' as const }
	if (isNext) return { label: deploymentCopy.nextToDeploy, tone: 'muted' as const }
	return { label: commonCopy.notDeployed, tone: 'warning' as const }
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
	const [busy, setBusy] = useState(false)
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
	if (walletContextSubscription.current === undefined)
		walletContextSubscription.current = createWalletContextSubscription(() => {
			walletContextEventRevision.current += 1
			if (walletConnectionPending.current) return
			walletConnectionRevision.current += 1
			setWalletAccount(undefined)
			setWalletChain(undefined)
			setWalletConnectionMessage(deploymentCopy.walletContextChanged)
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
			inputError = publicErrorMessage(error, deploymentCopy.deploymentSettingsInvalid)
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
				setRegistryError(publicErrorMessage(error, deploymentCopy.coreDeploymentsUnavailable))
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

	function bindWalletProvider(provider: InjectedEthereum | undefined) {
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
			if (initialProvider === undefined && services.connectWallet === undefined) throw new Error(deploymentCopy.noInjectedWallet)
			if (initialProvider !== undefined && selectedCore !== undefined) {
				const currentChain = await readInjectedChainIdNumber(initialProvider)
				if (currentChain !== selectedCore.chainId) {
					await switchInjectedChain(initialProvider, selectedCore.chainId)
					const switchedChain = await readInjectedChainIdNumber(initialProvider)
					if (switchedChain !== selectedCore.chainId) throw new Error(deploymentCopy.walletMustUseNetwork(selectedCore.chainName))
				}
			}
			const connectService = services.connectWallet
			if (connectService === undefined) throw new Error(deploymentCopy.walletConnectionServiceUnavailable)
			const connected = await connectService()
			if (!mounted.current || walletConnectionRevision.current !== revision) return
			const provider = initialProvider ?? connected.provider
			bindWalletProvider(provider)
			const contextRevision = walletContextEventRevision.current
			const account = provider === undefined ? connected.account : await requireInjectedAccount(provider)
			const connectedChain = provider === undefined ? connected.chainId : await readInjectedChainIdNumber(provider)
			if (walletContextEventRevision.current !== contextRevision) throw new Error(deploymentCopy.walletContextChangedDuringConnection)
			const currentProvider = services.getWalletProvider?.()
			if (provider !== undefined && currentProvider !== undefined && currentProvider !== provider) throw new Error(deploymentCopy.walletProviderChangedDuringConnection)
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
	const nextStep = plan === undefined || deploymentStatus === undefined ? undefined : nextTradingDeploymentStep(plan, deploymentStatus)
	const deploymentComplete = plan !== undefined && deploymentStatus !== undefined && isTradingDeploymentComplete(plan, deploymentStatus)
	const deploymentSteps =
		plan === undefined
			? []
			: [plan.factory, plan.router].map(step => {
					const deployed = deploymentStatus?.[step.id]
					const isNext = inspectionState === 'ready' && nextTradingDeploymentStep(plan, deploymentStatus ?? { factory: false, router: false })?.id === step.id && !deploymentComplete
					return { step, presentation: contractStatusPresentation(deployed, isNext) }
				})
	const inspectionIsCurrent = inspectedRevision === inputRevision.current
	const inspection = inspectionPresentation(inspectionState, { busy, deploymentComplete, inputError: inputError !== undefined, plan: plan !== undefined, registryError: registryError !== undefined, registryLoading })
	const retryChecks = registryError !== undefined || inspectionState === 'error'
	const inspectionBadgeId = useId()
	const networkNoticeId = useId()
	const deployAvailability = deploymentActionAvailability({ inspectionIsCurrent, inspectionState, nextStep: nextStep !== undefined, registryError: registryError !== undefined, registryLoading, selectedCoreChainName: selectedCore?.chainName, walletConnected, walletReady })
	// The inspection badge or the network notice already states the blocked reason; the action references it instead of repeating it.
	const reasonShownByInspectionBadge = inspection !== undefined && inspection.label === deployAvailability.reason
	const wrongNetworkNotice = walletConnected && !walletReady && selectedCore !== undefined ? deploymentCopy.connectedWalletMustUseNetwork(selectedCore.chainName) : undefined
	const reasonShownByNetworkNotice = wrongNetworkNotice !== undefined && deployAvailability.reason === deploymentCopy.walletMustUseNetwork(selectedCore?.chainName ?? '')
	let externalReasonId: string | undefined
	if (reasonShownByInspectionBadge) externalReasonId = inspectionBadgeId
	else if (reasonShownByNetworkNotice) externalReasonId = networkNoticeId
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
	async function deployNext() {
		if (busy || registryLoading || registryError !== undefined || inspectedRevision !== inputRevision.current || plan === undefined || publicClient === undefined || deploymentStatus === undefined || nextStep === undefined) return
		setBusy(true)
		onWorkflowLockChange(true)
		setActionMessage(undefined)
		setActionError(false)
		let broadcastHash: Hash | undefined
		try {
			const deployStep = services.deployStep ?? defaultServices.deployStep
			if (deployStep === undefined) throw new Error(deploymentCopy.deploymentServiceUnavailable)
			await deployStep(publicClient, plan, nextStep, hash => {
				broadcastHash = hash
			})
			const status = await loadTradingDeploymentStatus(publicClient, plan)
			setDeploymentStatus(status)
			if (isTradingDeploymentComplete(plan, status)) {
				const input = parseDeploymentSetupInput({ chainId, feeBps, rpcUrl: effectiveRpcUrl })
				const configuration = deploymentConfigurationForPlan(plan, input.rpcUrl)
				onComplete(configuration)
				return
			}
			setActionMessage(deploymentCopy.contractDeployedContinue(nextStep.label, nextTradingDeploymentStep(plan, status)?.label ?? deploymentCopy.nextContractFallbackLabel))
		} catch (error) {
			setActionError(true)
			let detail = publicErrorMessage(error, deploymentCopy.deployFailed(nextStep.label))
			try {
				const status = await loadTradingDeploymentStatus(publicClient, plan)
				setDeploymentStatus(status)
				if (status[nextStep.id]) {
					if (isTradingDeploymentComplete(plan, status)) {
						const input = parseDeploymentSetupInput({ chainId, feeBps, rpcUrl: effectiveRpcUrl })
						const configuration = deploymentConfigurationForPlan(plan, input.rpcUrl)
						onComplete(configuration)
						return
					}
					setActionError(false)
					setActionMessage(deploymentCopy.contractAlreadyInstalledContinue(nextStep.label, nextTradingDeploymentStep(plan, status)?.label ?? deploymentCopy.nextContractFallbackLabel))
					return
				}
			} catch (recoveryError) {
				detail = deploymentCopy.deploymentStatusUnverified(detail, publicErrorMessage(recoveryError, deploymentCopy.unknownRecoveryFallback))
			}
			setActionMessage(broadcastHash === undefined ? detail : deploymentCopy.broadcastWithoutCompletion(broadcastHash, detail))
		} finally {
			setBusy(false)
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
						<MetricField label={deploymentCopy.securityPoolFactory}>
							<ReadOnlyAddressValue address={selectedCore.securityPoolFactory} responsiveAbbreviation />
						</MetricField>
					</DataGrid>
				)}
				{plan === undefined ? null : <DeploymentStepList steps={deploymentSteps.map(({ step, presentation }) => ({ address: step.address, badge: presentation, key: step.id, label: step.label }))} />}
				<div className='deployment-setup__status' role='status' aria-live='polite'>
					<DataGrid dense>
						<MetricField label={deploymentCopy.deploymentProgress}>{deploymentProgress(deploymentStatus, 2)}</MetricField>
					</DataGrid>
					{inspection === undefined ? null : (
						<Badge id={inspectionBadgeId} tone={inspection.tone}>
							{inspection.label}
						</Badge>
					)}
				</div>
				<ErrorNotice id={networkNoticeId} message={wrongNetworkNotice} />
				<ErrorNotice message={walletConnectionMessage} />
				<ErrorNotice message={inspectionError} />
				{actionMessage === undefined || actionError ? null : (
					<p className='detail' role='status'>
						{actionMessage}
					</p>
				)}
				<ErrorNotice message={actionError ? actionMessage : undefined} />
				<div className='actions'>
					{deploymentComplete ? null : (
						<TransactionActionButton
							availability={deployAvailability}
							disabledReasonElementId={externalReasonId}
							idleLabel={deploymentActionLabel(false, nextStep, plan, deploymentStatus)}
							pendingLabel={deploymentActionLabel(true, nextStep, plan, deploymentStatus)}
							pending={busy}
							onClick={() => void deployNext()}
							showDisabledReason={externalReasonId === undefined}
						/>
					)}
					{retryAction}
				</div>
			</SectionBlock>
		</div>
	)
}
