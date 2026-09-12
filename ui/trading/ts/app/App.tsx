import { securityPoolAddressFromRoute } from '../features/liveTradingControllerHelpers.js'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import type { PublicClient } from '@zoltar/core-shared/evm/ethereum'
import { Help } from '../features/Help.js'
import { LiveTrading } from '../features/LiveTrading.js'
import { UniverseSelector } from '../components/UniverseSelector.js'
import { WalletSummary } from '../components/WalletSummary.js'
import { buildLiveUniverseOptions, type UniverseOption } from '../lib/universeOptions.js'
import { routeOwnsLiveWallet, walletSummaryAfterRouteChange, walletSummaryForUniverse, type WalletSummaryState } from '../lib/walletSummaryState.js'
import { TradingDeploymentSetup, type DeploymentWalletState, type TradingDeploymentSetupServices } from '../features/TradingDeploymentSetup.js'
import type { DeploymentConfiguration } from '../protocol/config.js'
import { loadCoreDeployments } from '../protocol/coreDeployments.js'
import { resolveInstalledTradingDeployment, type CoreDeployment } from '../protocol/deployment.js'
import { createTradingPublicClient, publicErrorMessage, validateRpcChainId, waitForActiveEnvironmentReady } from '../protocol/live.js'
import { getActiveNetworkProfile, getActiveSimulationController } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { withTimeout } from '@zoltar/ui-core-shared/lib/promise.js'
import * as appCopy from '../copy/app.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { AppHeaderShell } from '@zoltar/ui-core-shared/app/components/AppHeaderShell.js'
import { AppPageHeading } from '@zoltar/ui-core-shared/app/components/AppPageHeading.js'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { HeaderToolbar } from '@zoltar/ui-core-shared/components/HeaderToolbar.js'
import { ToolbarField } from '@zoltar/ui-core-shared/components/ToolbarField.js'
import { hasTradingWalletControls, TradingWalletControls } from '../components/TradingWalletControls.js'
import { initializeTradingActiveEnvironment } from './activeEnvironment.js'
import { getTradingEnvironmentLocationKey, getTradingRouteHref, tradingRouting, tradingWorkflowRoute, type TradingRoute } from '../lib/routing.js'

type ResolvedTradingRoute = TradingRoute | 'not-found'

/** Browse routes highlight the workflow tab they feed: markets serve trading, SecurityPools serve market creation. */
function tradingNavigationRoute(workflowRoute: ReturnType<typeof tradingWorkflowRoute<ResolvedTradingRoute>>) {
	if (workflowRoute === 'markets') return 'market'
	if (workflowRoute === 'security-pools') return 'create-market'
	return workflowRoute
}

function currentRoute(): ResolvedTradingRoute {
	return tradingRouting.resolve(window.location.hash)
}

function tradingDocumentTitle(route: ResolvedTradingRoute) {
	let label = `${route.charAt(0).toUpperCase()}${route.slice(1)}`
	if (route === 'not-found') label = appCopy.notFound
	if (route === 'create-market' || route.startsWith('create-market/')) label = appCopy.createMarket
	if (route === 'market' || route.startsWith('market/')) label = appCopy.market
	if (route === 'markets') label = appCopy.browseMarkets
	if (route === 'security-pools') label = appCopy.browseSecurityPools
	if (route.startsWith('liquidity/')) label = appCopy.liquidity
	if (route.startsWith('security-pool/')) label = appCopy.securityPool
	return appCopy.documentTitle(label)
}

function tradingPageTitle(route: ResolvedTradingRoute) {
	return tradingDocumentTitle(route).replace(` · ${appCopy.appName}`, '')
}

function renderNotFoundRoute() {
	return (
		<main class='route' id='main-content'>
			<RouteHeader title={appCopy.pageNotFound} />
			<a class='primary-link' href={getTradingRouteHref('#/market')}>
				{appCopy.returnToMarket}
			</a>
		</main>
	)
}

type LiveDeploymentStatus = 'loading' | 'verified' | 'unavailable'

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
	loadLiveDeployment = resolveLiveDeployment,
}: {
	deploymentSetupServices?: TradingDeploymentSetupServices
	initializeEnvironment?: () => Promise<unknown>
	loadLiveDeployment?: () => Promise<DeploymentConfiguration>
} = {}) {
	const [route, setRoute] = useState(currentRoute)
	const [liveDeploymentStatus, setLiveDeploymentStatus] = useState<LiveDeploymentStatus>('loading')
	const [liveConfiguration, setLiveConfiguration] = useState<DeploymentConfiguration>()
	const [liveConfigurationError, setLiveConfigurationError] = useState<string>()
	const [workflowLocked, setWorkflowLocked] = useState(false)
	const [selectedUniverseId, setSelectedUniverseId] = useState<string>()
	const [liveUniverseOptions, setLiveUniverseOptions] = useState<readonly UniverseOption[]>([])
	const [liveWalletSummary, setLiveWalletSummary] = useState<WalletSummaryState>({ account: undefined, ethAttoEth: undefined, repAttoRep: undefined, status: 'disconnected', error: undefined, errorLabel: undefined, universeId: undefined })
	const [walletSummaryRetryNonce, setWalletSummaryRetryNonce] = useState(0)
	const [walletConnectRequestNonce, setWalletConnectRequestNonce] = useState(0)
	const [deploymentWalletRequestNonce, setDeploymentWalletRequestNonce] = useState(0)
	const [deploymentWalletState, setDeploymentWalletState] = useState<DeploymentWalletState>({ account: undefined, connecting: false, networkName: undefined, ready: false })
	const [activeEnvironmentNonce, setActiveEnvironmentNonce] = useState(0)
	const activeEnvironmentLocationRef = useRef(getTradingEnvironmentLocationKey())
	const routeRef = useRef(route)
	const workflowLockedRef = useRef(workflowLocked)
	routeRef.current = route
	workflowLockedRef.current = workflowLocked
	const updateWorkflowLock = useCallback((locked: boolean) => {
		workflowLockedRef.current = locked
		setWorkflowLocked(locked)
	}, [])
	const updateLiveUniverses = useCallback((universeIds: readonly bigint[], authoritativeSelection: bigint | undefined) => {
		const options = buildLiveUniverseOptions(universeIds)
		setLiveUniverseOptions(options)
		setSelectedUniverseId(current => {
			if (current !== undefined && options.some(option => option.id === current)) return current
			return authoritativeSelection?.toString()
		})
	}, [])
	const showUniverseSelector = route !== 'deploy' && route !== 'help' && liveDeploymentStatus !== 'unavailable'
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
	const addressedPool = securityPoolAddressFromRoute(route)
	const workflowRoute = tradingWorkflowRoute(route)
	const navigationRoute = tradingNavigationRoute(workflowRoute)
	const displayedRoute = deploymentSetupActive ? 'deploy' : navigationRoute
	const refreshActiveEnvironment = useCallback(async () => {
		const previousLocationKey = activeEnvironmentLocationRef.current
		const nextLocationKey = getTradingEnvironmentLocationKey()
		activeEnvironmentLocationRef.current = nextLocationKey
		setLiveDeploymentStatus('loading')
		setLiveConfiguration(undefined)
		setLiveConfigurationError(undefined)
		setSelectedUniverseId(undefined)
		setLiveUniverseOptions([])
		setLiveWalletSummary({ account: undefined, ethAttoEth: undefined, repAttoRep: undefined, status: 'disconnected', error: undefined, errorLabel: undefined, universeId: undefined })
		try {
			await initializeEnvironment()
		} catch (error) {
			activeEnvironmentLocationRef.current = previousLocationKey
			throw error
		}
		setActiveEnvironmentNonce(current => current + 1)
	}, [initializeEnvironment])
	useEffect(() => {
		const update = () => {
			if (workflowLockedRef.current) {
				window.history.replaceState(undefined, '', getTradingRouteHref(`#/${routeRef.current}`))
				return
			}
			const nextRoute = currentRoute()
			setLiveWalletSummary(current => walletSummaryAfterRouteChange(current, routeRef.current, nextRoute, selectedUniverseId))
			routeRef.current = nextRoute
			setRoute(nextRoute)
		}
		window.addEventListener('hashchange', update)
		return () => window.removeEventListener('hashchange', update)
	}, [selectedUniverseId])
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
	if (route === 'not-found') content = renderNotFoundRoute()
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
		<div class='app-shell'>
			<AppPageHeading mainElementId='main-content' formatDocumentTitle={appCopy.documentTitle} pageTitle={tradingPageTitle(deploymentSetupActive ? 'deploy' : route)} />
			<AppHeaderShell
				mainElementId='main-content'
				simulationController={simulationController}
				onEnvironmentChanged={refreshActiveEnvironment}
				onRefresh={async () => window.location.reload()}
				tabNavigation={{
					route: displayedRoute,
					showProtocolGuide: false,
					tabs: [
						...(liveDeploymentStatus !== 'verified' ? [{ route: 'deploy', hash: '#/deploy', label: appCopy.deploy }] : []),
						{ route: 'market', hash: addressedPool === undefined ? '#/market' : `#/market/${addressedPool}`, label: appCopy.market },
						{ route: 'liquidity', hash: addressedPool === undefined ? '#/liquidity' : `#/liquidity/${addressedPool}`, label: appCopy.liquidity },
						{ route: 'portfolio', hash: '#/portfolio', label: appCopy.portfolio },
						{ route: 'create-market', hash: '#/create-market', label: appCopy.createMarket },
						{ route: 'help', hash: '#/help', label: appCopy.help },
					].map(tab => ({ ...tab, disabled: workflowLocked })),
					onRouteChange: nextRoute => {
						if (workflowLocked) return
						const hash = (nextRoute === 'liquidity' || nextRoute === 'market') && addressedPool !== undefined ? `#/${nextRoute}/${addressedPool}` : `#/${nextRoute}`
						window.location.hash = getTradingRouteHref(hash)
					},
				}}
				renderOverview={settingsMenu => (
					<section class='overview-shell'>
						<article class={`overview-panel overview-wallet-panel trading-overview${simulationController === undefined ? '' : ' is-simulation'}`}>
							<HeaderToolbar
								brand={
									<>
										<img src='./favicon.svg' alt='' width='28' height='28' />
										{appCopy.appName}
									</>
								}
								badges={<Badge tone={liveDeploymentStatus === 'unavailable' ? 'warning' : 'muted'}>{tradingNetworkLabel(liveDeploymentStatus, liveConfiguration, deploymentWalletState)}</Badge>}
								controls={
									!showWalletControls && !showUniverseSelector ? undefined : (
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
												/>
											) : null}
											{showUniverseSelector ? (
												<ToolbarField label={appCopy.universe}>
													<UniverseSelector options={liveUniverseOptions} selectedId={selectedUniverseId} disabled={workflowLocked} loading={liveDeploymentStatus === 'loading'} onChange={setSelectedUniverseId} />
												</ToolbarField>
											) : null}
										</>
									)
								}
								settings={settingsMenu}
							/>
							{showUniverseSelector ? <WalletSummary simulation={simulationController !== undefined} summary={walletSummary} onRetry={retryWalletSummary} /> : null}
						</article>
					</section>
				)}
			/>
			{content}
		</div>
	)
}
