import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import type { PublicClient } from '@zoltar/shared/ethereum'
import { Help } from '../features/Help.js'
import { LiveTrading, type WalletSummaryState } from '../features/LiveTrading.js'
import { TradingDeploymentSetup, type DeploymentWalletState, type TradingDeploymentSetupServices } from '../features/TradingDeploymentSetup.js'
import type { DeploymentConfiguration } from '../protocol/config.js'
import { loadCoreDeployments } from '../protocol/coreDeployments.js'
import { deploymentConfigurationForPlan, getTradingDeploymentPlan, loadTradingDeploymentStatus, type CoreDeployment } from '../protocol/deployment.js'
import { createTradingPublicClient, publicErrorMessage, validateRpcChainId } from '../protocol/live.js'
import { formatUnits, shortAddress } from '../lib/format.js'
import { getActiveSimulationController } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import * as commonCopy from '../copy/common.js'
import * as appCopy from '../copy/app.js'
import { AppHeaderShell } from '@zoltar/ui-core-shared/app/components/AppHeaderShell.js'
import { AppPageHeading } from '@zoltar/ui-core-shared/app/components/AppPageHeading.js'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'

const tradingRoutes = ['markets', 'market', 'liquidity', 'portfolio', 'deploy', 'help'] as const
type TradingRoute = (typeof tradingRoutes)[number] | `security-pool/${string}` | 'not-found'

export function currentRoute(): TradingRoute {
	const route = window.location.hash.replace(/^#\/?/, '') || 'markets'
	if (route === 'developer') return 'markets'
	return tradingRoutes.find(candidate => candidate === route) ?? (/^security-pool\/0x[0-9a-f]{40}$/i.test(route) ? `security-pool/${route.slice('security-pool/'.length)}` : 'not-found')
}

export function tradingDocumentTitle(route: TradingRoute) {
	let label = `${route.charAt(0).toUpperCase()}${route.slice(1)}`
	if (route === 'not-found') label = appCopy.notFound
	if (route === 'market') label = appCopy.market
	if (route.startsWith('security-pool/')) label = appCopy.securityPool
	return appCopy.documentTitle(label)
}

function tradingPageTitle(route: TradingRoute) {
	return tradingDocumentTitle(route).replace(` · ${appCopy.appName}`, '')
}

function renderNotFoundRoute() {
	return (
		<main class='route' id='main-content'>
			<RouteHeader title={appCopy.pageNotFound} />
			<a class='primary-link' href='#/markets'>
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

export type UniverseOption = Readonly<{ id: string; label: string; accessibleLabel?: string }>

export function UniverseSelector({ options, selectedId, disabled, onChange }: { options: readonly UniverseOption[]; selectedId: string | undefined; disabled: boolean; onChange(selectedId: string): void }) {
	const selected = options.find(option => option.id === selectedId)
	return (
		<label class='universe-selector'>
			<select aria-label='Select universe' title={selected?.accessibleLabel ?? selected?.label} value={selectedId ?? ''} disabled={disabled || options.length === 0} onChange={event => onChange(event.currentTarget.value)}>
				{options.length === 0 ? (
					<option value=''>Unavailable</option>
				) : (
					options.map(option => (
						<option key={option.id} value={option.id} aria-label={option.accessibleLabel ?? option.label} title={option.accessibleLabel ?? option.label}>
							{option.label}
						</option>
					))
				)}
			</select>
		</label>
	)
}

export function WalletSummary({ summary, onRetry }: { summary: WalletSummaryState; onRetry?(): void }) {
	if (summary.account === undefined) return null
	let ethDisplay = '…'
	let repBalance = '…'
	if (summary.status === 'error') {
		ethDisplay = '—'
		repBalance = '—'
	} else if (summary.status === 'ready') {
		if (summary.ethAttoEth !== undefined) ethDisplay = formatUnits(summary.ethAttoEth, 18, 18)
		if (summary.repAttoRep !== undefined) repBalance = formatUnits(summary.repAttoRep, 18, 18)
	}
	return (
		<details class={`wallet-summary wallet-summary--${summary.status}`} aria-label='Connected wallet balances' aria-busy={summary.status === 'loading'} open={summary.status === 'error'}>
			<summary class='wallet-summary__trigger'>
				<code class='wallet-summary__address wallet-summary__address--full'>{summary.account}</code>
				<code class='wallet-summary__address wallet-summary__address--compact'>{shortAddress(summary.account)}</code>
				<span class='wallet-summary__compact-loading'>Loading balances…</span>
				<div class='wallet-summary__balances'>
					<span data-wallet-asset='ETH'>
						<small>ETH</small>
						<strong>{ethDisplay}</strong>
					</span>
					<span data-wallet-asset='REP'>
						<small>REP</small>
						<strong>{repBalance}</strong>
					</span>
				</div>
			</summary>
			<div class='wallet-summary__details'>
				<div class='wallet-summary__identity'>
					<span>Connected account</span>
					<code>{summary.account}</code>
				</div>
				<div class='wallet-summary__detail-balances' aria-label='Wallet balances'>
					<span>
						<small>ETH</small>
						<strong>{ethDisplay}</strong>
					</span>
					<span>
						<small>REP</small>
						<strong>{repBalance}</strong>
					</span>
				</div>
				{summary.status === 'error' ? (
					<span class='wallet-summary__failure'>
						<span class='wallet-summary__error' role='alert' title={summary.error} aria-label={`${summary.errorLabel ?? 'Balances unavailable'}: ${summary.error ?? 'wallet balance read failed'}`}>
							{summary.errorLabel ?? 'Balances unavailable'}
						</span>
						{onRetry === undefined ? null : (
							<button class='wallet-summary__retry' type='button' onClick={onRetry}>
								Retry
							</button>
						)}
					</span>
				) : null}
			</div>
			{summary.status === 'loading' ? (
				<span class='visually-hidden' role='status'>
					Loading wallet ETH and current-universe REP balances
				</span>
			) : null}
		</details>
	)
}

export function walletSummaryForUniverse(summary: WalletSummaryState, selectedUniverseId: string | undefined): WalletSummaryState {
	if (summary.universeId === selectedUniverseId) return summary
	return { account: summary.account, ethAttoEth: undefined, repAttoRep: undefined, status: summary.account === undefined ? 'disconnected' : 'loading', error: undefined, errorLabel: undefined, universeId: selectedUniverseId }
}

export function routeOwnsLiveWallet(route: string) {
	return route !== 'deploy' && route !== 'help' && route !== 'not-found'
}

export function walletSummaryAfterRouteChange(summary: WalletSummaryState, previousRoute: string, nextRoute: string, selectedUniverseId: string | undefined): WalletSummaryState {
	if (routeOwnsLiveWallet(previousRoute) === routeOwnsLiveWallet(nextRoute)) return summary
	return { account: undefined, ethAttoEth: undefined, repAttoRep: undefined, status: 'disconnected', error: undefined, errorLabel: undefined, universeId: selectedUniverseId }
}

export function compactUniqueUniverseIds(universeIds: readonly string[]) {
	if (new Set(universeIds).size !== universeIds.length) throw new Error('Universe IDs must be unique')
	let edgeLength = 3
	while (true) {
		const labels = universeIds.map(universeId => (universeId.length <= edgeLength * 2 + 1 ? universeId : `${universeId.slice(0, edgeLength)}…${universeId.slice(-edgeLength)}`))
		if (new Set(labels).size === labels.length) return labels
		edgeLength++
	}
}

export function buildLiveUniverseOptions(universeIds: readonly bigint[]): readonly UniverseOption[] {
	const ids = universeIds.map(universeId => universeId.toString())
	const compactIds = compactUniqueUniverseIds(ids)
	return universeIds.map((universeId, index) => {
		const id = ids[index]
		const compactId = compactIds[index]
		if (id === undefined || compactId === undefined) throw new Error('Universe label generation failed')
		return universeId === 0n ? { id, label: 'Genesis universe', accessibleLabel: 'Genesis universe' } : { id, label: `Universe ${compactId}`, accessibleLabel: `Universe ${id}` }
	})
}

function deploymentWalletLabel(state: DeploymentWalletState) {
	if (state.connecting) return 'Connecting wallet…'
	if (state.account === undefined) return 'Connect wallet'
	return shortAddress(state.account)
}

export function App({ deploymentSetupServices, loadLiveDeployment = resolveLiveDeployment }: { deploymentSetupServices?: TradingDeploymentSetupServices; loadLiveDeployment?: () => Promise<DeploymentConfiguration> } = {}) {
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
	useEffect(() => {
		const update = () => {
			if (workflowLockedRef.current) {
				window.history.replaceState(undefined, '', `${window.location.pathname}${window.location.search}#/${routeRef.current}`)
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
	}, [loadLiveDeployment])
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
				onRefresh={async () => window.location.reload()}
				renderHeader={simulationBanner => (
					<div class='site-chrome'>
						{simulationBanner}
						<header class={`site-header${deploymentSetupActive ? ' site-header--deployment' : ''}`}>
							<a class='brand' href='#/markets' aria-label={appCopy.appHomeLabel} aria-disabled={workflowLocked} onClick={workflowLocked ? event => event.preventDefault() : undefined}>
								<span class='brand__mark'>{appCopy.brandMark}</span>
								<span>
									<strong>{appCopy.appName}</strong>
								</span>
							</a>
							<nav aria-label={appCopy.primaryNavigationLabel}>
								{liveDeploymentStatus !== 'verified' ? (
									<a aria-current={displayedRoute === 'deploy' ? 'page' : undefined} aria-disabled={workflowLocked} href='#/deploy' onClick={workflowLocked ? event => event.preventDefault() : undefined}>
										{appCopy.deploy}
									</a>
								) : null}
								<a aria-current={displayedRoute === 'markets' ? 'page' : undefined} aria-disabled={workflowLocked} href='#/markets' onClick={workflowLocked ? event => event.preventDefault() : undefined}>
									{appCopy.markets}
								</a>
								<a aria-current={displayedRoute === 'liquidity' ? 'page' : undefined} aria-disabled={workflowLocked} href='#/liquidity' onClick={workflowLocked ? event => event.preventDefault() : undefined}>
									{appCopy.liquidity}
								</a>
								<a aria-current={displayedRoute === 'portfolio' ? 'page' : undefined} aria-disabled={workflowLocked} href='#/portfolio' onClick={workflowLocked ? event => event.preventDefault() : undefined}>
									{appCopy.portfolio}
								</a>
								<a aria-current={displayedRoute === 'help' ? 'page' : undefined} aria-disabled={workflowLocked} href='#/help' onClick={workflowLocked ? event => event.preventDefault() : undefined}>
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
