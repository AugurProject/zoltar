import { useEnvironmentRevision } from '@zoltar/ui-core-shared/app/hooks/useEnvironmentRevision.js'
import { useRouteSignal } from '@zoltar/ui-core-shared/app/hooks/useHashRoute.js'
import { securityPoolAddressFromRoute } from '../features/liveTradingControllerHelpers.js'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import type { PublicClient } from '@zoltar/core-shared/evm/ethereum'
import type { LiveTradingControllerServices } from '../features/live/liveTradingTypes.js'
import type { ComponentChildren } from 'preact'
import { Help } from '../features/Help.js'
import { LiveTrading } from '../features/LiveTrading.js'
import { TradingOverviewPanel } from '../components/TradingOverviewPanel.js'
import { useUrlSearchState } from '@zoltar/ui-core-shared/app/hooks/useUrlSearchState.js'
import { readStringQueryParam, readUniverseQueryParam, writeUniverseQueryParam } from '@zoltar/ui-core-shared/navigation/urlParams.js'
import { resolveUniverseSelection, type LiveUniverses, type UniverseDiscoveryScope } from '../lib/universeSelection.js'
import { UniverseSwitcher } from '@zoltar/ui-core-shared/components/UniverseSwitcher.js'
import { useUniverseSummary, type LoadUniverseSummary } from '../features/useUniverseSummary.js'
import { routeOwnsLiveWallet, walletSummaryAfterRouteChange, walletSummaryForUniverse, type WalletSummaryState } from '../lib/walletSummaryState.js'
import { TradingDeploymentSetup, type DeploymentWalletState, type TradingDeploymentSetupServices } from '../features/TradingDeploymentSetup.js'
import type { DeploymentConfiguration } from '../protocol/config.js'
import { loadCoreDeployments } from '../protocol/coreDeployments.js'
import { resolveInstalledTradingDeployment, type CoreDeployment } from '../protocol/deployment.js'
import { createTradingPublicClient, publicErrorMessage, validateRpcChainId, waitForActiveEnvironmentReady } from '../protocol/live.js'
import { getActiveNetworkProfile, getActiveSimulationController } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { withTimeout } from '@zoltar/ui-core-shared/lib/promise.js'
import * as appCopy from '../copy/app.js'
import * as availabilityCopy from '../copy/availability.js'
import * as sharedAppCopy from '@zoltar/ui-core-shared/copy/app.js'
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
import { withDeploymentTab } from '@zoltar/ui-core-shared/navigation/appNavigation.js'

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
	{ href: '#/market', label: appCopy.market },
	{ href: '#/portfolio', label: appCopy.portfolio },
	{ href: '#/help', label: appCopy.help },
]

type LiveDeploymentStatus = 'loading' | 'verified' | 'unavailable'

function readTradingUrlState(search: string) {
	return { universeId: readUniverseQueryParam(search), present: readStringQueryParam(search, 'universe') !== undefined }
}

async function resolveCanonicalLiveDeployment(coreDeployments: readonly CoreDeployment[], createPublicClient: (configuration: DeploymentConfiguration) => PublicClient = createTradingPublicClient) {
	const activeChainId = getActiveNetworkProfile().chain.id
	const core = coreDeployments.find(deployment => deployment.chainId === activeChainId)
	if (core === undefined) throw new Error('No canonical deployment is available for the active network')
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
	if (liveDeploymentStatus === 'unavailable') return appCopy.networkUnavailable
	return appCopy.checkingDeployment
}

export function App({
	deploymentSetupServices,
	initializeEnvironment = initializeTradingActiveEnvironment,
	liveTradingServices,
	loadLiveDeployment = resolveLiveDeployment,
	loadUniverseSummary,
}: {
	deploymentSetupServices?: TradingDeploymentSetupServices
	initializeEnvironment?: () => Promise<unknown>
	/** Test seam for the live routes' chain reads. */
	liveTradingServices?: LiveTradingControllerServices
	loadLiveDeployment?: () => Promise<DeploymentConfiguration>
	/** Test seam for the header universe switcher's summary read. */
	loadUniverseSummary?: LoadUniverseSummary
}) {
	const [liveDeploymentStatus, setLiveDeploymentStatus] = useState<LiveDeploymentStatus>('loading')
	const [liveConfiguration, setLiveConfiguration] = useState<DeploymentConfiguration>()
	const [liveConfigurationError, setLiveConfigurationError] = useState<string>()
	const [workflowLocked, setWorkflowLocked] = useState(false)
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
	const showUniverseField = routeOwnsLiveWallet(route) && liveDeploymentStatus !== 'unavailable'
	// The header names the universe the routes follow, like the other applications; it is chosen on the universe route and shown once discovery confirms it.
	const headerUniverse = useUniverseSummary(showUniverseField ? liveConfiguration : undefined, confirmedUniverseId === undefined ? undefined : BigInt(confirmedUniverseId), loadUniverseSummary)
	let universeValue: ComponentChildren = <LoadingText announce={false}>{appCopy.loadingWithEllipsis}</LoadingText>
	if (confirmedUniverseId !== undefined) universeValue = <UniverseSwitcher activeUniverseId={BigInt(confirmedUniverseId)} browseHref={getTradingRouteHref('#/universe')} universe={headerUniverse.state.kind === 'ready' ? headerUniverse.state.universe : undefined} />
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
	const deploymentSetupActive = route !== 'not-found' && route !== 'help' && (route === 'deploy' || liveDeploymentStatus === 'unavailable')
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

	useEffect(() => {
		const synchronizeEnvironment = () => {
			queueMicrotask(() => {
				if (getTradingEnvironmentLocationKey() === activeEnvironmentLocationRef.current) return
				void refreshActiveEnvironment().catch(error => {
					setLiveConfiguration(undefined)
					setLiveConfigurationError(publicErrorMessage(error, 'Unable to load the trading environment'))
					setLiveDeploymentStatus('unavailable')
				})
			})
		}
		window.addEventListener('popstate', synchronizeEnvironment)
		return () => window.removeEventListener('popstate', synchronizeEnvironment)
	}, [refreshActiveEnvironment])
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
				setLiveDeploymentStatus('unavailable')
			}
		})()
		return () => {
			active = false
		}
	}, [activeEnvironmentNonce, loadLiveDeployment])
	let content
	if (route === 'not-found') content = <NotFoundSection links={TRADING_NOT_FOUND_LINKS.map(link => ({ ...link, href: getTradingRouteHref(link.href) }))} />
	else if (route === 'help') content = <Help />
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
						tabs: withDeploymentTab({
							deploymentTab: { route: 'deploy', hash: '#/deploy', label: appCopy.deploy },
							deploymentIncomplete: liveDeploymentStatus === 'unavailable',
							route: displayedRoute,
							tabs: [
								{ route: 'market', hash: addressedPool === undefined ? '#/market' : `#/market/${addressedPool}`, label: appCopy.market },
								{ route: 'liquidity', hash: addressedPool === undefined ? '#/liquidity' : `#/liquidity/${addressedPool}`, label: appCopy.liquidity },
								{ route: 'portfolio', hash: '#/portfolio', label: appCopy.portfolio },
								{ route: 'universe', hash: '#/universe', label: appCopy.universe },
								{ route: 'create-market', hash: '#/create-market', label: appCopy.createMarket },
								{ route: 'help', hash: '#/help', label: appCopy.help },
							],
						}).map(tab => (workflowLocked ? { ...tab, disabled: true, disabledReason: availabilityCopy.transactionInProgressReason } : tab)),
						onRouteChange: nextRoute => {
							if (workflowLocked) return
							const hash = (nextRoute === 'liquidity' || nextRoute === 'market') && addressedPool !== undefined ? `#/${nextRoute}/${addressedPool}` : `#/${nextRoute}`
							window.location.hash = getTradingRouteHref(hash)
						},
					}}
					renderOverview={settingsMenu => (
						<TradingOverviewPanel
							settingsMenu={settingsMenu}
							simulation={simulationController !== undefined}
							badges={simulationController === undefined ? <Badge tone={liveDeploymentStatus === 'unavailable' ? 'warning' : 'muted'}>{tradingNetworkLabel(liveDeploymentStatus, liveConfiguration, deploymentWalletState)}</Badge> : <Badge tone='warning'>{sharedAppCopy.simulation}</Badge>}
							controls={
								!showWalletControls && !showUniverseField ? undefined : (
									<>
										{showWalletControls ? (
											<TradingWalletControls
												{...walletSlot}
												account={walletSummary.account}
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
										{showUniverseField ? <ToolbarField label={appCopy.universe}>{universeValue}</ToolbarField> : undefined}
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
