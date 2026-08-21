import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import type { PublicClient } from '@zoltar/shared/ethereum'
import { Help } from '../features/Help.js'
import { LiveTrading, type WalletSummaryState } from '../features/LiveTrading.js'
import { buildLiveUniverseOptions, routeOwnsLiveWallet, UniverseSelector, WalletSummary, walletSummaryAfterRouteChange, walletSummaryForUniverse, type UniverseOption } from '../components/WalletSummary.js'
export { buildLiveUniverseOptions, compactUniqueUniverseIds, routeOwnsLiveWallet, UniverseSelector, WalletSummary, walletSummaryAfterRouteChange, walletSummaryForUniverse } from '../components/WalletSummary.js'
export type { UniverseOption } from '../components/WalletSummary.js'
import { TradingDeploymentSetup, type DeploymentWalletState, type TradingDeploymentSetupServices } from '../features/TradingDeploymentSetup.js'
import type { DeploymentConfiguration } from '../protocol/config.js'
import { loadCoreDeployments } from '../protocol/coreDeployments.js'
import { deploymentConfigurationForPlan, getTradingDeploymentPlan, loadTradingDeploymentStatus, type CoreDeployment } from '../protocol/deployment.js'
import { createTradingPublicClient, publicErrorMessage, validateRpcChainId } from '../protocol/live.js'
import { shortAddress } from '../lib/format.js'
import { getActiveSimulationController } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { resolveRoute } from '@zoltar/ui-core-shared/lib/routing.js'
import * as commonCopy from '../copy/common.js'
import * as appCopy from '../copy/app.js'
import { AppHeaderShell } from '@zoltar/ui-core-shared/app/components/AppHeaderShell.js'
import { AppPageHeading } from '@zoltar/ui-core-shared/app/components/AppPageHeading.js'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { initializeTradingActiveEnvironment } from './activeEnvironment.js'
import { getTradingEnvironmentLocationKey, getTradingRouteHref, normalizeTradingRouteHash, TRADING_ROUTING_CONFIG, type TradingRoute } from '../lib/routing.js'

type ResolvedTradingRoute = TradingRoute | 'not-found'

export function currentRoute(): ResolvedTradingRoute {
	const normalizedHash = normalizeTradingRouteHash(window.location.hash)
	const routeHash = normalizedHash.split('?')[0] ?? ''
	if (routeHash.replace(/^#\/?/, '') === 'developer') return 'markets'
	return resolveRoute(TRADING_ROUTING_CONFIG, normalizedHash)
}

export function tradingDocumentTitle(route: ResolvedTradingRoute) {
	let label = `${route.charAt(0).toUpperCase()}${route.slice(1)}`
	if (route === 'not-found') label = appCopy.notFound
	if (route === 'market') label = appCopy.market
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
			<a class='primary-link' href={getTradingRouteHref('#/markets')}>
				{appCopy.returnToMarkets}
			</a>
		</main>
	)
}

type LiveDeploymentStatus = 'loading' | 'verified' | 'unavailable'

async function withDeploymentLoadTimeout<T>(label: string, operation: Promise<T>, milliseconds = 15_000): Promise<T> {
	let timeout: ReturnType<typeof setTimeout> | undefined
	try {
		return await Promise.race([
			operation,
			new Promise<T>((_resolve, reject) => {
				timeout = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds)
			}),
		])
	} finally {
		if (timeout !== undefined) clearTimeout(timeout)
	}
}

export async function resolveCanonicalLiveDeployment(coreDeployments: readonly CoreDeployment[], createPublicClient: (configuration: DeploymentConfiguration) => PublicClient = createTradingPublicClient) {
	const core = coreDeployments[0]
	if (core === undefined) throw new Error('No canonical network deployment is available')
	const plan = getTradingDeploymentPlan(core, 30)
	const configuration = deploymentConfigurationForPlan(plan, core.defaultRpcUrl)
	const client = createPublicClient(configuration)
	validateRpcChainId(await withDeploymentLoadTimeout('Trading RPC chain verification', client.getChainId()), core.chainId)
	const status = await withDeploymentLoadTimeout('Trading deployment verification', loadTradingDeploymentStatus(client, plan))
	if (!status.factory || !status.router) throw new Error('Trading contracts have not been deployed')
	return configuration
}

async function resolveLiveDeployment() {
	return await resolveCanonicalLiveDeployment(await loadCoreDeployments())
}

export function tradingNetworkLabel(liveDeploymentStatus: LiveDeploymentStatus) {
	if (liveDeploymentStatus === 'verified') return commonCopy.deploymentVerified
	if (liveDeploymentStatus === 'unavailable') return 'Deployment unavailable'
	return 'Checking deployment'
}

function networkToneClass(liveDeploymentStatus: LiveDeploymentStatus) {
	if (liveDeploymentStatus === 'unavailable') return ' network-pill--warn'
	if (liveDeploymentStatus !== 'verified') return ' network-pill--neutral'
	return ''
}

function deploymentWalletLabel(state: DeploymentWalletState) {
	if (state.connecting) return 'Connecting wallet…'
	if (state.account === undefined) return 'Connect wallet'
	return shortAddress(state.account)
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
	const [deploymentWalletState, setDeploymentWalletState] = useState<DeploymentWalletState>({ account: undefined, connecting: false, ready: false })
	const [deploymentSettingsHost, setDeploymentSettingsHost] = useState<HTMLElement>()
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
	const displayedRoute = deploymentSetupActive ? 'deploy' : route
	const refreshActiveEnvironment = useCallback(async () => {
		const previousLocationKey = activeEnvironmentLocationRef.current
		const nextLocationKey = getTradingEnvironmentLocationKey()
		if (nextLocationKey === previousLocationKey) return
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
	else if (route === 'deploy')
		content = (
			<TradingDeploymentSetup
				onComplete={completeWalletDeployment}
				onWorkflowLockChange={updateWorkflowLock}
				onWalletStateChange={updateDeploymentWalletState}
				{...(deploymentSettingsHost === undefined ? {} : { settingsHost: deploymentSettingsHost })}
				walletControlRequestNonce={deploymentWalletRequestNonce}
				{...(liveConfiguration === undefined ? {} : { currentConfiguration: liveConfiguration })}
				{...(deploymentSetupServices === undefined ? {} : { services: deploymentSetupServices })}
			/>
		)
	else if (liveDeploymentStatus === 'unavailable')
		content = (
			<TradingDeploymentSetup
				onComplete={completeWalletDeployment}
				onWorkflowLockChange={updateWorkflowLock}
				onWalletStateChange={updateDeploymentWalletState}
				{...(deploymentSettingsHost === undefined ? {} : { settingsHost: deploymentSettingsHost })}
				walletControlRequestNonce={deploymentWalletRequestNonce}
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
	return (
		<div class='app-shell'>
			<AppPageHeading mainElementId='main-content' formatDocumentTitle={appCopy.documentTitle} pageTitle={tradingPageTitle(displayedRoute)} />
			<AppHeaderShell
				mainElementId='main-content'
				simulationController={simulationController}
				onEnvironmentChanged={refreshActiveEnvironment}
				onRefresh={async () => window.location.reload()}
				renderHeader={simulationBanner => (
					<div class='site-chrome'>
						{simulationBanner}
						<header class={`site-header${deploymentSetupActive ? ' site-header--deployment' : ''}`}>
							<a class='brand' href={getTradingRouteHref('#/markets')} aria-label={appCopy.appHomeLabel} aria-disabled={workflowLocked} onClick={workflowLocked ? event => event.preventDefault() : undefined}>
								<span class='brand__mark'>{appCopy.brandMark}</span>
								<span>
									<strong>{appCopy.appName}</strong>
								</span>
							</a>
							<nav aria-label={appCopy.primaryNavigationLabel}>
								{liveDeploymentStatus !== 'verified' ? (
									<a aria-current={displayedRoute === 'deploy' ? 'page' : undefined} aria-disabled={workflowLocked} href={getTradingRouteHref('#/deploy')} onClick={workflowLocked ? event => event.preventDefault() : undefined}>
										{appCopy.deploy}
									</a>
								) : null}
								<a aria-current={displayedRoute === 'markets' ? 'page' : undefined} aria-disabled={workflowLocked} href={getTradingRouteHref('#/markets')} onClick={workflowLocked ? event => event.preventDefault() : undefined}>
									{appCopy.markets}
								</a>
								<a aria-current={displayedRoute === 'liquidity' ? 'page' : undefined} aria-disabled={workflowLocked} href={getTradingRouteHref('#/liquidity')} onClick={workflowLocked ? event => event.preventDefault() : undefined}>
									{appCopy.liquidity}
								</a>
								<a aria-current={displayedRoute === 'portfolio' ? 'page' : undefined} aria-disabled={workflowLocked} href={getTradingRouteHref('#/portfolio')} onClick={workflowLocked ? event => event.preventDefault() : undefined}>
									{appCopy.portfolio}
								</a>
								<a aria-current={displayedRoute === 'help' ? 'page' : undefined} aria-disabled={workflowLocked} href={getTradingRouteHref('#/help')} onClick={workflowLocked ? event => event.preventDefault() : undefined}>
									{appCopy.help}
								</a>
							</nav>
							<div class={`header-actions${deploymentSetupActive ? ' header-actions--deployment' : ''}`}>
								<span class={`network-pill${networkToneClass(liveDeploymentStatus)}`}>
									<span />
									{tradingNetworkLabel(liveDeploymentStatus)}
								</span>
								{showUniverseSelector ? <WalletSummary summary={walletSummary} onRetry={retryWalletSummary} /> : null}
								{showUniverseSelector ? <UniverseSelector options={liveUniverseOptions} selectedId={selectedUniverseId} disabled={workflowLocked} onChange={setSelectedUniverseId} /> : null}
								{deploymentSetupActive ? (
									<button
										class='wallet-button'
										type='button'
										disabled={workflowLocked || deploymentWalletState.connecting || !deploymentWalletState.ready}
										aria-busy={deploymentWalletState.connecting}
										aria-label={deploymentWalletState.account === undefined ? undefined : appCopy.disconnectWalletLabel(deploymentWalletState.account)}
										title={deploymentWalletState.account === undefined ? undefined : appCopy.disconnectWallet}
										onClick={() => setDeploymentWalletRequestNonce(current => current + 1)}
									>
										{deploymentWalletLabel(deploymentWalletState)}
									</button>
								) : null}
								{deploymentSetupActive ? <div class='deployment-settings-host' ref={element => setDeploymentSettingsHost(element ?? undefined)} /> : null}
								{liveDeploymentStatus === 'verified' && routeOwnsLiveWallet(route) ? (
									<button class='wallet-button' type='button' disabled={workflowLocked} onClick={() => setWalletConnectRequestNonce(current => current + 1)}>
										{walletSummary.account === undefined ? appCopy.connectWallet : shortAddress(walletSummary.account)}
									</button>
								) : null}
							</div>
						</header>
					</div>
				)}
			/>
			{content}
		</div>
	)
}
