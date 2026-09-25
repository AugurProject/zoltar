import { useEnvironmentRevision } from '@zoltar/ui-core-shared/app/hooks/useEnvironmentRevision.js'
import { useRouteSignal } from '@zoltar/ui-core-shared/app/hooks/useHashRoute.js'
import { securityPoolAddressFromRoute } from '../features/liveTradingControllerHelpers.js'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import type { PublicClient } from '@zoltar/core-shared/evm/ethereum'
import type { LiveTradingControllerServices } from '../features/live/liveTradingTypes.js'
import type { ComponentChildren } from 'preact'
import { Help } from '../features/Help.js'
import { LiveTrading } from '../features/LiveTrading.js'
import { TradingBalanceGroup, TradingOverviewPanel } from '../components/TradingOverviewPanel.js'
import { TradingConnectionError } from '../features/TradingConnectionError.js'
import { useUrlSearchState } from '@zoltar/ui-core-shared/app/hooks/useUrlSearchState.js'
import { readStringQueryParam, readUniverseQueryParam, writeUniverseQueryParam } from '@zoltar/ui-core-shared/navigation/urlParams.js'
import { resolveUniverseSelection, type LiveUniverses, type UniverseDiscoveryScope } from '../lib/universeSelection.js'
import { formatUniverseDisplayLabel, formatUniverseLabel } from '@zoltar/ui-core-shared/lib/universeLabels.js'
import { routeOwnsLiveWallet, walletSummaryAfterRouteChange, walletSummaryForUniverse, type WalletSummaryState } from '../lib/walletSummaryState.js'
import { TradingDeploymentSetup, type DeploymentWalletState, type TradingDeploymentSetupServices } from '../features/TradingDeploymentSetup.js'
import type { DeploymentConfiguration } from '../protocol/config.js'
import { loadCoreDeployments } from '../protocol/coreDeployments.js'
import { isTradingDeploymentMissingError, resolveInstalledTradingDeployment, tradingDeploymentMissingError, type CoreDeployment } from '../protocol/deployment.js'
import { createTradingPublicClient, publicErrorMessage, validateRpcChainId, waitForActiveEnvironmentReady } from '../protocol/live.js'
import { getActiveNetworkProfile, getActiveSimulationController } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { withTimeout } from '@zoltar/ui-core-shared/lib/promise.js'
import * as appCopy from '../copy/app.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { AppHeaderShell } from '@zoltar/ui-core-shared/app/components/AppHeaderShell.js'
import { AppPageHeading } from '@zoltar/ui-core-shared/app/components/AppPageHeading.js'
import { NotFoundSection } from '@zoltar/ui-core-shared/app/components/NotFoundSection.js'
import { ProtocolAppFrame } from '@zoltar/ui-core-shared/app/components/ProtocolAppFrame.js'
import { ToolbarField } from '@zoltar/ui-core-shared/components/ToolbarField.js'
import { hasTradingWalletControls, TradingWalletControls } from '../components/TradingWalletControls.js'
import { initializeTradingActiveEnvironment } from './activeEnvironment.js'
import { getTradingEnvironmentLocationKey, getTradingRouteHref, tradingRouting, tradingWorkflowRoute, type TradingRoute } from '../lib/routing.js'
import { tradingNavigationTabs } from '../lib/tradingNavigation.js'

type ResolvedTradingRoute = TradingRoute | 'not-found'

function currentRoute(): ResolvedTradingRoute {
	return tradingRouting.resolve(window.location.hash)
}

function tradingDocumentTitle(route: ResolvedTradingRoute) {
	let label = `${route.charAt(0).toUpperCase()}${route.slice(1)}`
	if (route === 'not-found') label = appCopy.notFound
	if (route === 'create-market' || route.startsWith('create-market/')) label = appCopy.createMarket
	if (route === 'market' || route.startsWith('market/')) label = appCopy.market
	if (route.startsWith('liquidity/')) label = appCopy.liquidity
	if (route.startsWith('security-pool/')) label = appCopy.securityPool
	return appCopy.documentTitle(label)
}

function tradingPageTitle(route: ResolvedTradingRoute) {
	return tradingDocumentTitle(route).replace(` · ${appCopy.appName}`, '')
}

const TRADING_NOT_FOUND_LINKS = [
	{ href: '#/market', label: appCopy.markets },
	{ href: '#/portfolio', label: appCopy.portfolio },
	{ href: '#/help', label: appCopy.help },
]

/** `missing`: the chain answered and the trading contracts are not installed. `unreachable`: the check itself failed, so a retry may succeed. */
type LiveDeploymentStatus = 'loading' | 'verified' | 'missing' | 'unreachable'

function failedDeploymentStatus(error: unknown): LiveDeploymentStatus {
	return isTradingDeploymentMissingError(error) ? 'missing' : 'unreachable'
}

function readTradingUrlState(search: string) {
	return { universeId: readUniverseQueryParam(search), present: readStringQueryParam(search, 'universe') !== undefined }
}

async function resolveCanonicalLiveDeployment(coreDeployments: readonly CoreDeployment[], createPublicClient: (configuration: DeploymentConfiguration) => PublicClient = createTradingPublicClient) {
	const activeChainId = getActiveNetworkProfile().chain.id
	const core = coreDeployments.find(deployment => deployment.chainId === activeChainId)
	if (core === undefined) throw tradingDeploymentMissingError('No canonical deployment is available for the active network')
	const bootstrapConfiguration: DeploymentConfiguration = { chainId: core.chainId, chainName: core.chainName, factory: core.securityPoolFactory, feeBps: 30, router: core.securityPoolFactory, rpcUrl: core.defaultRpcUrl, securityPoolFactory: core.securityPoolFactory, zoltar: core.zoltar }
	const client = createPublicClient(bootstrapConfiguration)
	validateRpcChainId(await withTimeout(client.getChainId(), 15_000, 'Trading RPC chain verification timed out'), core.chainId)
	return await withTimeout(resolveInstalledTradingDeployment(client, core, 30, core.defaultRpcUrl), 15_000, 'Trading deployment verification timed out')
}

async function resolveLiveDeployment() {
	await waitForActiveEnvironmentReady()
	return await resolveCanonicalLiveDeployment(await loadCoreDeployments())
}

function tradingNetworkLabel(liveDeploymentStatus: LiveDeploymentStatus, liveConfiguration: DeploymentConfiguration | undefined, deploymentWalletState: DeploymentWalletState) {
	const networkName = deploymentWalletState.networkName ?? liveConfiguration?.chainName
	if (networkName !== undefined) return networkName
	if (liveDeploymentStatus === 'unreachable') return appCopy.deploymentUnverified
	if (liveDeploymentStatus === 'missing') return appCopy.contractsNotDeployed
	return appCopy.checkingDeployment
}

export function App({
	deploymentSetupServices,
	initializeEnvironment = initializeTradingActiveEnvironment,
	liveTradingServices,
	loadLiveDeployment = resolveLiveDeployment,
}: {
	deploymentSetupServices?: TradingDeploymentSetupServices
	initializeEnvironment?: () => Promise<unknown>
	/** Test seam for the live routes' chain reads. */
	liveTradingServices?: LiveTradingControllerServices
	loadLiveDeployment?: () => Promise<DeploymentConfiguration>
}) {
	const [liveDeploymentStatus, setLiveDeploymentStatus] = useState<LiveDeploymentStatus>('loading')
	const [liveConfiguration, setLiveConfiguration] = useState<DeploymentConfiguration>()
	const [liveConfigurationError, setLiveConfigurationError] = useState<string>()
	const [workflowLocked, setWorkflowLocked] = useState(false)
	const [deploymentCheckNonce, setDeploymentCheckNonce] = useState(0)
	// Set when switching to another environment failed, so Retry repeats the switch instead of rechecking the previous environment.
	const [environmentSwitchFailed, setEnvironmentSwitchFailed] = useState(false)
	// The universe is chosen on the universe route through the shared `universe` query parameter; discovery confirms it exists.
	const { applyUrlStateUpdate, getOwnedSearch, state: urlState } = useUrlSearchState(readTradingUrlState)
	const [liveUniverses, setLiveUniverses] = useState<LiveUniverses>({ ids: [], selected: undefined, forRequest: undefined, forPool: undefined })
	const [discoveryState, setDiscoveryState] = useState<'loading' | 'ready' | 'error'>('loading')
	const [liveWalletSummary, setLiveWalletSummary] = useState<WalletSummaryState>({ account: undefined, ethAttoEth: undefined, repAttoRep: undefined, status: 'disconnected', error: undefined, errorLabel: undefined, universeId: undefined })
	const [walletSummaryRetryNonce, setWalletSummaryRetryNonce] = useState(0)
	const [walletConnectRequestNonce, setWalletConnectRequestNonce] = useState(0)
	const [deploymentWalletRequestNonce, setDeploymentWalletRequestNonce] = useState(0)
	const [deploymentWalletState, setDeploymentWalletState] = useState<DeploymentWalletState>({ account: undefined, connecting: false, networkName: undefined, ready: false })
	const environment = useEnvironmentRevision()
	const activeEnvironmentNonce = environment.revision.value
	const activeEnvironmentLocationRef = useRef(getTradingEnvironmentLocationKey())
	const workflowLockedRef = useRef(workflowLocked)
	const route = useRouteSignal(currentRoute, (next, previous) => {
		if (workflowLockedRef.current) {
			window.history.replaceState(undefined, '', getTradingRouteHref(`#/${previous}`))
			return false
		}
		setLiveWalletSummary(current => walletSummaryAfterRouteChange(current, previous, next, selectedUniverseId))
		return true
	}).value
	workflowLockedRef.current = workflowLocked
	const addressedPool = securityPoolAddressFromRoute(route)
	const universeSelection = resolveUniverseSelection({ ...urlState, addressedPool: addressedPool?.toLowerCase() }, liveUniverses)
	const selectedUniverseId = universeSelection.requestedUniverseId
	const confirmedUniverseId = universeSelection.confirmedUniverseId
	useEffect(() => {
		// An unknown request is replaced by the universe that discovery chose, so the URL, header, and routes agree.
		if (universeSelection.replaceUrlUniverseId !== undefined) applyUrlStateUpdate(writeUniverseQueryParam(getOwnedSearch(), universeSelection.replaceUrlUniverseId), 'replace')
	}, [applyUrlStateUpdate, getOwnedSearch, universeSelection.replaceUrlUniverseId])
	const updateWorkflowLock = useCallback((locked: boolean) => {
		workflowLockedRef.current = locked
		setWorkflowLocked(locked)
	}, [])
	const updateLiveUniverses = useCallback((universeIds: readonly bigint[], authoritativeSelection: bigint | undefined, scope: UniverseDiscoveryScope) => setLiveUniverses({ ids: universeIds, selected: authoritativeSelection, forRequest: scope.requestedUniverseId, forPool: scope.addressedPool }), [])
	const liveDeploymentUsable = liveDeploymentStatus === 'loading' || liveDeploymentStatus === 'verified'
	const showUniverseField = routeOwnsLiveWallet(route) && liveDeploymentUsable
	// The header names the universe the routes follow, like the other applications; it is chosen on the universe route and shown once discovery confirms it.
	let universeValue: ComponentChildren = <LoadingText announce={false}>{appCopy.loadingWithEllipsis}</LoadingText>
	if (confirmedUniverseId !== undefined) universeValue = <span title={formatUniverseLabel(BigInt(confirmedUniverseId))}>{formatUniverseDisplayLabel(BigInt(confirmedUniverseId))}</span>
	else if (discoveryState === 'error') universeValue = <span>{appCopy.unavailable}</span>
	const walletSummary = walletSummaryForUniverse(liveWalletSummary, selectedUniverseId)
	const retryWalletSummary = () => {
		setLiveWalletSummary(current => ({ account: current.account, ethAttoEth: undefined, repAttoRep: undefined, status: current.account === undefined ? 'disconnected' : 'loading', error: undefined, errorLabel: undefined, universeId: selectedUniverseId }))
		setWalletSummaryRetryNonce(current => current + 1)
	}
	const completeWalletDeployment = useCallback((configuration: DeploymentConfiguration) => {
		setLiveConfiguration(configuration)
		setLiveConfigurationError(undefined)
		setLiveDeploymentStatus('verified')
	}, [])
	const updateDeploymentWalletState = useCallback((state: DeploymentWalletState) => setDeploymentWalletState(state), [])
	// Only confirmed-missing contracts open the deployment wizard; an unreachable RPC keeps the route and offers a retry.
	const deploymentSetupActive = route !== 'not-found' && route !== 'help' && (route === 'deploy' || liveDeploymentStatus === 'missing')
	const connectionErrorActive = route !== 'not-found' && route !== 'help' && !deploymentSetupActive && liveDeploymentStatus === 'unreachable'
	const workflowRoute = tradingWorkflowRoute(route)
	const displayedRoute = deploymentSetupActive ? 'deploy' : workflowRoute
	const refreshActiveEnvironment = useCallback(async () => {
		const previousLocationKey = activeEnvironmentLocationRef.current
		const nextLocationKey = getTradingEnvironmentLocationKey()
		activeEnvironmentLocationRef.current = nextLocationKey
		setLiveDeploymentStatus('loading')
		setLiveConfiguration(undefined)
		setLiveConfigurationError(undefined)
		setLiveUniverses({ ids: [], selected: undefined, forRequest: undefined, forPool: undefined })
		setDiscoveryState('loading')
		setLiveWalletSummary({ account: undefined, ethAttoEth: undefined, repAttoRep: undefined, status: 'disconnected', error: undefined, errorLabel: undefined, universeId: undefined })
		try {
			await initializeEnvironment()
		} catch (error) {
			activeEnvironmentLocationRef.current = previousLocationKey
			throw error
		}
		environment.setRevision(current => current + 1)
	}, [initializeEnvironment])

	const switchActiveEnvironment = useCallback(async () => {
		setEnvironmentSwitchFailed(false)
		try {
			await refreshActiveEnvironment()
		} catch (error) {
			setEnvironmentSwitchFailed(true)
			setLiveConfiguration(undefined)
			setLiveConfigurationError(publicErrorMessage(error, 'Unable to load the trading environment'))
			setLiveDeploymentStatus(failedDeploymentStatus(error))
		}
	}, [refreshActiveEnvironment])

	useEffect(() => {
		const synchronizeEnvironment = () => {
			queueMicrotask(() => {
				if (getTradingEnvironmentLocationKey() === activeEnvironmentLocationRef.current) return
				void switchActiveEnvironment()
			})
		}
		window.addEventListener('popstate', synchronizeEnvironment)
		return () => window.removeEventListener('popstate', synchronizeEnvironment)
	}, [switchActiveEnvironment])
	useEffect(() => {
		let active = true
		setLiveDeploymentStatus('loading')
		void (async () => {
			try {
				const loaded = await loadLiveDeployment()
				if (!active) return
				setLiveConfiguration(loaded)
				setLiveConfigurationError(undefined)
				setLiveDeploymentStatus('verified')
			} catch (error) {
				if (!active) return
				setLiveConfiguration(undefined)
				setLiveConfigurationError(publicErrorMessage(error, 'Unable to load the trading deployment'))
				setLiveDeploymentStatus(failedDeploymentStatus(error))
			}
		})()
		return () => {
			active = false
		}
	}, [activeEnvironmentNonce, deploymentCheckNonce, loadLiveDeployment])
	let content
	if (route === 'not-found') content = <NotFoundSection links={TRADING_NOT_FOUND_LINKS.map(link => ({ ...link, href: getTradingRouteHref(link.href) }))} />
	else if (route === 'help') content = <Help />
	else if (connectionErrorActive) content = <TradingConnectionError message={liveConfigurationError} route={route} onRetry={() => (environmentSwitchFailed ? void switchActiveEnvironment() : setDeploymentCheckNonce(current => current + 1))} />
	else if (deploymentSetupActive)
		content = (
			<TradingDeploymentSetup
				onComplete={completeWalletDeployment}
				onWorkflowLockChange={updateWorkflowLock}
				onWalletStateChange={updateDeploymentWalletState}
				walletControlRequestNonce={deploymentWalletRequestNonce}
				{...(liveConfiguration === undefined ? {} : { currentConfiguration: liveConfiguration })}
				{...(deploymentSetupServices === undefined ? {} : { services: deploymentSetupServices })}
			/>
		)
	else
		content = (
			<LiveTrading
				key={activeEnvironmentNonce}
				route={route}
				configuration={liveConfiguration}
				configurationError={liveConfigurationError}
				selectedUniverseId={selectedUniverseId}
				urlUniverseId={urlState.universeId}
				confirmedUniverseId={confirmedUniverseId}
				onDiscoveryStateChange={setDiscoveryState}
				{...(liveTradingServices === undefined ? {} : { controllerServices: liveTradingServices })}
				onUniversesChange={updateLiveUniverses}
				onWorkflowLockChange={updateWorkflowLock}
				onWalletSummaryChange={setLiveWalletSummary}
				walletSummaryRetryNonce={walletSummaryRetryNonce}
				walletConnectRequestNonce={walletConnectRequestNonce}
			/>
		)
	const simulationController = getActiveSimulationController()
	const walletSlot = { deploymentSetupActive, liveDeploymentStatus, routeOwnsLiveWallet: routeOwnsLiveWallet(route) }
	const showWalletControls = hasTradingWalletControls(walletSlot)
	return (
		<ProtocolAppFrame
			actionsLocked={workflowLocked}
			currentBlockNumber={undefined}
			currentTimestamp={undefined}
			heading={<AppPageHeading formatDocumentTitle={appCopy.documentTitle} pageTitle={tradingPageTitle(deploymentSetupActive ? 'deploy' : route)} />}
			notices={undefined}
			header={
				<AppHeaderShell
					simulationController={simulationController}
					onEnvironmentChanged={refreshActiveEnvironment}
					onRefresh={async () => window.location.reload()}
					tabNavigation={{
						route: displayedRoute,
						showProtocolGuide: false,
						...tradingNavigationTabs({ addressedPool, displayedRoute, liveDeploymentStatus, workflowLocked }),
						onRouteChange: nextRoute => {
							if (workflowLocked) return
							const hash = (nextRoute === 'liquidity' || nextRoute === 'market') && addressedPool !== undefined ? `#/${nextRoute}/${addressedPool}` : `#/${nextRoute}`
							window.location.hash = getTradingRouteHref(hash)
						},
					}}
					renderOverview={({ navigation, settingsMenu }) => (
						<TradingOverviewPanel
							navigation={navigation}
							settingsMenu={settingsMenu}
							badges={simulationController === undefined ? <Badge tone={liveDeploymentUsable ? 'muted' : 'warning'}>{tradingNetworkLabel(liveDeploymentStatus, liveConfiguration, deploymentWalletState)}</Badge> : undefined}
							controls={
								!showWalletControls && !showUniverseField ? undefined : (
									<>
										{showUniverseField ? <ToolbarField label={appCopy.universe}>{universeValue}</ToolbarField> : undefined}
										{showWalletControls ? (
											<TradingWalletControls
												{...walletSlot}
												account={walletSummary.account}
												accountMetrics={showUniverseField ? <TradingBalanceGroup walletSummary={walletSummary} /> : undefined}
												networkName={liveConfiguration?.chainName}
												deploymentWalletState={deploymentWalletState}
												onDeploymentWalletRequest={() => setDeploymentWalletRequestNonce(current => current + 1)}
												onWalletConnectRequest={() => setWalletConnectRequestNonce(current => current + 1)}
												simulation={simulationController !== undefined}
												workflowLocked={workflowLocked}
												requiredNetworkName={walletSummary.networkMismatchReason === undefined ? undefined : liveConfiguration?.chainName}
												walletChainId={walletSummary.networkMismatchReason === undefined ? undefined : walletSummary.walletChainId}
												onSwitchNetwork={() => setWalletConnectRequestNonce(current => current + 1)}
											/>
										) : undefined}
									</>
								)
							}
							walletSummary={showUniverseField ? walletSummary : undefined}
							onRetryWalletSummary={retryWalletSummary}
						/>
					)}
				/>
			}
			routeContentDisabled={false}
			transactionRouteKey={route}
		>
			{content}
		</ProtocolAppFrame>
	)
}
