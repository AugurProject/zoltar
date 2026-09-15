import { createPublicClient, http, type Hash, type PublicClient } from '@zoltar/core-shared/evm/ethereum'
import { getActiveBackend, getActiveNetworkProfile } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import type { ChainBackend } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import { resolveConfiguredRpcUrl } from '@zoltar/ui-core-shared/wallet/rpcConfig.js'
import { useEffect, useRef, useState } from 'preact/hooks'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { ReadOnlyAddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { parseDeploymentSetupInput, type DeploymentConfiguration } from '../protocol/config.js'
import { loadCoreDeployments } from '../protocol/coreDeployments.js'
import { deployTradingStep, deploymentConfigurationForPlan, getTradingDeploymentPlan, isTradingDeploymentComplete, loadTradingDeploymentStatus, nextTradingDeploymentStep, type CoreDeployment, type TradingDeploymentPlan, type TradingDeploymentStep } from '../protocol/deployment.js'
import { createWalletContextSubscription, getInjectedEthereum, type InjectedEthereum } from '../protocol/injected.js'
import { connectedWalletAccount, connectWallet, createTradingWalletClient, publicErrorMessage, switchWalletChain, validateRpcChainId, waitForActiveEnvironmentReady, walletChainId } from '../protocol/live.js'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
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
		const account = await connectWallet(provider)
		return { account, chainId: await walletChainId(provider), provider }
	},
	getWalletProvider: getInjectedEthereum,
	deployStep: async (publicClient, plan, step, onSubmitted) => {
		const provider = getInjectedEthereum()
		if (provider === undefined) throw new Error(deploymentCopy.noInjectedWallet)
		let currentChainId = await walletChainId(provider)
		if (currentChainId !== plan.core.chainId) {
			await switchWalletChain(provider, plan.core.chainId)
			currentChainId = await walletChainId(provider)
		}
		if (currentChainId !== plan.core.chainId) throw new Error(deploymentCopy.walletMustUseNetwork(plan.core.chainName))
		const account = await connectWallet(provider)
		const walletClient = createTradingWalletClient(provider, account)
		await deployTradingStep(walletClient, publicClient, plan, step, onSubmitted, async () => {
			validateRpcChainId(await publicClient.getChainId(), plan.core.chainId)
			if (getInjectedEthereum() !== provider || (await walletChainId(provider)) !== plan.core.chainId || (await connectWallet(provider)) !== account) throw new Error(deploymentCopy.walletContextChangedBeforeDeployment)
		})
		if (getInjectedEthereum() !== provider || (await walletChainId(provider)) !== plan.core.chainId || (await connectWallet(provider)) !== account) throw new Error(deploymentCopy.walletContextChangedDuringDeployment)
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
	if (busy) return { label: deploymentCopy.deploymentInProgress, tone: 'muted' as const }
	if (deploymentComplete) return { label: appCopy.deploymentComplete, tone: 'ok' as const }
	if (state === 'loading') return { label: deploymentCopy.checkingNetwork, tone: 'muted' as const }
	if (state === 'ready') return undefined
	if (state === 'blocked') return { label: appCopy.securityPoolFactoryNotDeployed, tone: 'warning' as const }
	if (state === 'error') return { label: deploymentCopy.configurationUnavailable, tone: 'warning' as const }
	if (plan) return { label: deploymentCopy.checkingNetwork, tone: 'muted' as const }
	return { label: appCopy.completeDeploymentSettings, tone: 'muted' as const }
}

function deploymentActionLabel(busy: boolean, nextStep: ReturnType<typeof nextTradingDeploymentStep>, plan: TradingDeploymentPlan | undefined, status: DeploymentStatus | undefined) {
	if (busy) return deploymentCopy.deployingContract(nextStep?.label ?? deploymentCopy.contractFallbackLabel)
	if (plan !== undefined && status !== undefined && isTradingDeploymentComplete(plan, status)) return appCopy.deploymentComplete
	if (nextStep === undefined) return deploymentCopy.deployTradingContracts
	return deploymentCopy.deployContract(nextStep.label)
}

function contractStatusPresentation(deployed: boolean | undefined, isNext: boolean) {
	if (deployed === undefined) return { label: appCopy.checkingContract, tone: 'muted' as const }
	if (deployed) return { label: deploymentCopy.deployed, tone: 'ok' as const }
	if (isNext) return { label: deploymentCopy.nextToDeploy, tone: 'muted' as const }
	return { label: deploymentCopy.notDeployed, tone: 'warning' as const }
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
				const currentChain = await walletChainId(initialProvider)
				if (currentChain !== selectedCore.chainId) {
					await switchWalletChain(initialProvider, selectedCore.chainId)
					const switchedChain = await walletChainId(initialProvider)
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
			const account = provider === undefined ? connected.account : await connectedWalletAccount(provider)
			const connectedChain = provider === undefined ? connected.chainId : await walletChainId(provider)
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
	let standaloneWalletButton
	if (walletControlRequestNonce === undefined)
		standaloneWalletButton = walletConnected ? (
			<button class='secondary wallet-button' type='button' disabled={busy} aria-label={appCopy.disconnectWalletLabel(walletAccount)} title={appCopy.disconnectWallet} onClick={disconnectDeploymentWallet}>
				<ReadOnlyAddressValue address={walletAccount} responsiveAbbreviation />
			</button>
		) : (
			<button class='secondary wallet-button' type='button' disabled={busy || walletConnecting || registryLoading || coreDeployments.length === 0} aria-busy={walletConnecting} onClick={() => void connectDeploymentWallet()}>
				{walletConnecting ? appCopy.connectingWallet : appCopy.connectWallet}
			</button>
		)
	let retryAction
	if (retryChecks)
		retryAction = (
			<button
				class='secondary'
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
		<div class='route'>
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
				{plan === undefined ? null : (
					<ul class='deployment-setup__steps'>
						{deploymentSteps.map(({ step, presentation }) => (
							<li class='deployment-step' key={step.id}>
								<Badge tone={presentation.tone}>{presentation.label}</Badge>
								<div class='deployment-step__details'>
									<strong>{step.label}</strong>
									<ReadOnlyAddressValue address={step.address} responsiveAbbreviation />
								</div>
							</li>
						))}
					</ul>
				)}
				<div class='deployment-setup__status' role='status' aria-live='polite'>
					<MetricField label={deploymentCopy.deploymentProgress}>{deploymentProgress(deploymentStatus, 2)}</MetricField>
					{inspection === undefined ? null : <Badge tone={inspection.tone}>{inspection.label}</Badge>}
				</div>
				<ErrorNotice message={walletConnected && !walletReady && selectedCore !== undefined ? deploymentCopy.connectedWalletMustUseNetwork(selectedCore.chainName) : undefined} />
				<ErrorNotice message={walletConnectionMessage} />
				<ErrorNotice message={inspectionError} />
				{actionMessage === undefined || actionError ? null : (
					<p class='detail' role='status'>
						{actionMessage}
					</p>
				)}
				<ErrorNotice message={actionError ? actionMessage : undefined} />
				<div class='actions'>
					{deploymentComplete ? null : (
						<button class='primary' type='button' disabled={busy || registryLoading || registryError !== undefined || !inspectionIsCurrent || inspectionState !== 'ready' || nextStep === undefined || !walletReady} aria-busy={busy} onClick={() => void deployNext()}>
							{deploymentActionLabel(busy, nextStep, plan, deploymentStatus)}
						</button>
					)}
					{retryAction}
				</div>
			</SectionBlock>
		</div>
	)
}
