import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { demoMarket, demoWalletAccount, demoWalletEthAttoEth, demoWalletRepAttoRep } from '../demo/markets.ts'
import { MarketDetail } from '../features/MarketDetail.tsx'
import { Help, Liquidity, MarketList, Portfolio, SecurityPoolDetails } from '../features/Routes.tsx'
import { LiveTrading, type WalletSummaryState } from '../features/LiveTrading.tsx'
import { TradingDeploymentSetup, type DeploymentWalletState, type TradingDeploymentSetupServices } from '../features/TradingDeploymentSetup.tsx'
import { loadDeploymentConfiguration, type DeploymentConfiguration } from '../protocol/config.ts'
import { loadCoreDeployments } from '../protocol/coreDeployments.ts'
import { validateStoredTradingDeployment } from '../protocol/deployment.ts'
import { createTradingPublicClient, publicErrorMessage, validateLiveDeployment } from '../protocol/live.ts'
import { formatUnits, shortAddress } from './format.ts'

const tradingRoutes = ['markets', 'market', 'liquidity', 'portfolio', 'deploy', 'help'] as const
type TradingRoute = (typeof tradingRoutes)[number] | `security-pool/${string}` | 'not-found'

export function currentRoute(): TradingRoute {
	const route = window.location.hash.replace(/^#\/?/, '') || 'markets'
	if (route === 'developer') return 'markets'
	return tradingRoutes.find(candidate => candidate === route) ?? (/^security-pool\/0x[0-9a-f]{40}$/i.test(route) ? `security-pool/${route.slice('security-pool/'.length)}` : 'not-found')
}

export function tradingDocumentTitle(route: TradingRoute) {
	let label = `${route.charAt(0).toUpperCase()}${route.slice(1)}`
	if (route === 'not-found') label = 'Not found'
	if (route === 'market') label = 'Market'
	if (route.startsWith('security-pool/')) label = 'Security pool'
	return `${label} · Statoblast trading`
}

function DemoSecurityPoolUnavailable() {
	return (
		<main class='route' id='main-content'>
			<header class='route-header'>
				<div>
					<a class='eyebrow' href='#/markets'>
						← Markets
					</a>
					<h1>Security pool</h1>
				</div>
			</header>
			<section class='section'>
				<p class='error' role='alert'>
					This security pool is not available in the selected universe.
				</p>
			</section>
		</main>
	)
}

function renderRoute(route: string, scenario: string, market: ReturnType<typeof demoMarket>, onWorkflowLockChange: (locked: boolean) => void) {
	if (route.toLowerCase() === `security-pool/${market.pool}`.toLowerCase()) return <SecurityPoolDetails market={market} />
	if (/^security-pool\/0x[0-9a-f]{40}$/i.test(route)) return <DemoSecurityPoolUnavailable />
	if (route === 'market') return <MarketDetail market={market} scenario={scenario} onWorkflowLockChange={onWorkflowLockChange} />
	if (route === 'liquidity') return <Liquidity market={market} />
	if (route === 'portfolio') return <Portfolio market={market} />
	if (route === 'help') return <Help />
	if (route === 'markets') return <MarketList market={market} />
	return (
		<main class='route' id='main-content'>
			<header class='route-header'>
				<div>
					<h1>Page not found</h1>
				</div>
			</header>
			<a class='primary-link' href='#/markets'>
				Return to markets
			</a>
		</main>
	)
}

function renderBanner(scenario: string, demo: boolean) {
	let runtimeBanner
	if (scenario === 'wrong-network')
		runtimeBanner = (
			<div class='runtime-banner' role='alert'>
				<strong>Unsupported network</strong>
				<span>Switch to the configured chain before simulating or submitting.</span>
			</div>
		)
	return (
		<>
			{demo ? (
				<div class='demo-banner' role='status'>
					<strong>SIMULATED DATA</strong>
					<span>Demo mode · no live chain claims or transactions</span>
				</div>
			) : null}
			{runtimeBanner}
		</>
	)
}

type LiveDeploymentStatus = 'loading' | 'verified' | 'unavailable'

async function resolveLiveDeployment() {
	const loaded = await loadDeploymentConfiguration()
	if (loaded === undefined) throw new Error('No bundled or wallet-deployed trading configuration was found.')
	const client = createTradingPublicClient(loaded.configuration)
	if (loaded.source === 'stored') await validateStoredTradingDeployment(client, loaded.configuration, await loadCoreDeployments())
	else await validateLiveDeployment(client, loaded.configuration)
	return loaded.configuration
}

function networkLabel(scenario: string, demo: boolean, liveDeploymentStatus: LiveDeploymentStatus) {
	if (scenario === 'wrong-network') return 'Unsupported · requires Anvil 31337'
	if (demo) return 'Anvil 31337'
	if (liveDeploymentStatus === 'verified') return 'Verified live deployment'
	if (liveDeploymentStatus === 'unavailable') return 'Deployment unavailable'
	return 'Checking deployment'
}

function networkToneClass(scenario: string, demo: boolean, liveDeploymentStatus: LiveDeploymentStatus) {
	if (scenario === 'wrong-network' || (!demo && liveDeploymentStatus === 'unavailable')) return ' network-pill--warn'
	if (!demo && liveDeploymentStatus !== 'verified') return ' network-pill--neutral'
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

function demoUniverseChoices(scenario: string) {
	const choices = scenario === 'max-token-ids' ? [demoMarket(scenario), demoMarket('max-token-ids-alt'), demoMarket('baseline'), demoMarket('truth-auction')] : [demoMarket(scenario), demoMarket('baseline'), demoMarket('truth-auction')]
	return choices.filter((market, index) => choices.findIndex(candidate => candidate.universeId === market.universeId) === index)
}

function demoWalletSummary(scenario: string, universeId: bigint, retrySucceeded: boolean): WalletSummaryState {
	const selectedUniverseId = universeId.toString()
	if (scenario === 'wallet-balance-loading') return { account: demoWalletAccount, ethAttoEth: undefined, repAttoRep: undefined, status: 'loading', error: undefined, errorLabel: undefined, universeId: selectedUniverseId }
	if (scenario === 'wallet-balance-error' && !retrySucceeded) return { account: demoWalletAccount, ethAttoEth: undefined, repAttoRep: undefined, status: 'error', error: 'Wallet balance RPC request failed', errorLabel: 'Wallet balance read failed', universeId: selectedUniverseId }
	if (scenario === 'wallet-discovery-error' && !retrySucceeded) return { account: demoWalletAccount, ethAttoEth: undefined, repAttoRep: undefined, status: 'error', error: 'No SecurityPool is available in the selected universe', errorLabel: 'No SecurityPool in this universe', universeId: selectedUniverseId }
	if (scenario === 'wallet-pool-error' && !retrySucceeded) return { account: demoWalletAccount, ethAttoEth: undefined, repAttoRep: undefined, status: 'error', error: 'The selected SecurityPool could not be read', errorLabel: 'SecurityPool unavailable', universeId: selectedUniverseId }
	if (scenario === 'wallet-max-balances') return { account: demoWalletAccount, ethAttoEth: 2n ** 256n - 1n, repAttoRep: 2n ** 256n - 1n, status: 'ready', error: undefined, errorLabel: undefined, universeId: selectedUniverseId }
	if (scenario === 'wallet-small-balances') return { account: demoWalletAccount, ethAttoEth: 1n, repAttoRep: 1n, status: 'ready', error: undefined, errorLabel: undefined, universeId: selectedUniverseId }
	return { account: demoWalletAccount, ethAttoEth: demoWalletEthAttoEth, repAttoRep: demoWalletRepAttoRep(universeId), status: 'ready', error: undefined, errorLabel: undefined, universeId: selectedUniverseId }
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

export function compactUniverseId(universeId: string) {
	if (universeId.length <= 18) return universeId
	return `${universeId.slice(0, 3)}…${universeId.slice(-3)}`
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

function demoUniverseLabel(market: ReturnType<typeof demoMarket>, compactId: string) {
	if (market.universeId === 1n && market.universe === 'Genesis universe') return 'Genesis universe'
	if (market.universeId === 1n && market.universe === 'Parent universe · forked') return 'Universe 1 · forked'
	if (market.universeId === 2n && market.universe === 'Child universe · YES branch') return 'Universe 2 · YES branch'
	return `Universe ${compactId}`
}

function deploymentWalletLabel(state: DeploymentWalletState) {
	if (state.connecting) return 'Connecting wallet…'
	if (state.account === undefined) return 'Connect wallet'
	return shortAddress(state.account)
}

export function App({ deploymentSetupServices, loadLiveDeployment = resolveLiveDeployment }: { deploymentSetupServices?: TradingDeploymentSetupServices; loadLiveDeployment?: () => Promise<DeploymentConfiguration> } = {}) {
	const query = new URLSearchParams(window.location.search)
	const demo = query.get('demo') === '1'
	const scenario = query.get('scenario') ?? 'baseline'
	const initialDemoMarket = demoMarket(scenario)
	const [route, setRoute] = useState(currentRoute)
	const [liveDeploymentStatus, setLiveDeploymentStatus] = useState<LiveDeploymentStatus>('loading')
	const [liveConfiguration, setLiveConfiguration] = useState<DeploymentConfiguration>()
	const [liveConfigurationError, setLiveConfigurationError] = useState<string>()
	const [workflowLocked, setWorkflowLocked] = useState(false)
	const [selectedUniverseId, setSelectedUniverseId] = useState<string | undefined>(demo ? initialDemoMarket.universeId.toString() : undefined)
	const [liveUniverseOptions, setLiveUniverseOptions] = useState<readonly UniverseOption[]>([])
	const [liveWalletSummary, setLiveWalletSummary] = useState<WalletSummaryState>({ account: undefined, ethAttoEth: undefined, repAttoRep: undefined, status: 'disconnected', error: undefined, errorLabel: undefined, universeId: undefined })
	const [walletSummaryRetryNonce, setWalletSummaryRetryNonce] = useState(0)
	const [walletConnectRequestNonce, setWalletConnectRequestNonce] = useState(0)
	const [deploymentWalletRequestNonce, setDeploymentWalletRequestNonce] = useState(0)
	const [deploymentWalletState, setDeploymentWalletState] = useState<DeploymentWalletState>({ account: undefined, connecting: false, ready: false })
	const [deploymentRetryNonce, setDeploymentRetryNonce] = useState(0)
	const [demoWalletRetrySucceeded, setDemoWalletRetrySucceeded] = useState(false)
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
	const demoMarkets = demoUniverseChoices(scenario)
	const demoCompactUniverseIds = compactUniqueUniverseIds(demoMarkets.map(choice => choice.universeId.toString()))
	const demoUniverseOptions = demoMarkets.map((choice, index) => {
		const id = choice.universeId.toString()
		const compactId = demoCompactUniverseIds[index]
		if (compactId === undefined) throw new Error('Demo universe label generation failed')
		const label = demoUniverseLabel(choice, compactId)
		return { id, label, accessibleLabel: label.includes('…') ? `Universe ${id}` : label }
	})
	const market = demoMarkets.find(choice => choice.universeId.toString() === selectedUniverseId) ?? initialDemoMarket
	const universeOptions = demo ? demoUniverseOptions : liveUniverseOptions
	const showUniverseSelector = route !== 'deploy' && route !== 'help' && (demo || liveDeploymentStatus !== 'unavailable')
	const walletSummary = demo ? demoWalletSummary(scenario, market.universeId, demoWalletRetrySucceeded) : walletSummaryForUniverse(liveWalletSummary, selectedUniverseId)
	const retryWalletSummary = () => {
		if (demo) setDemoWalletRetrySucceeded(true)
		else {
			setLiveWalletSummary(current => ({ account: current.account, ethAttoEth: undefined, repAttoRep: undefined, status: current.account === undefined ? 'disconnected' : 'loading', error: undefined, errorLabel: undefined, universeId: selectedUniverseId }))
			setWalletSummaryRetryNonce(current => current + 1)
		}
	}
	const retryDeployment = () => {
		setLiveConfiguration(undefined)
		setLiveConfigurationError(undefined)
		setLiveDeploymentStatus('loading')
		setDeploymentRetryNonce(current => current + 1)
	}
	const completeWalletDeployment = useCallback((configuration: DeploymentConfiguration) => {
		setLiveConfiguration(configuration)
		setLiveConfigurationError(undefined)
		setLiveDeploymentStatus('verified')
	}, [])
	const updateDeploymentWalletState = useCallback((state: DeploymentWalletState) => setDeploymentWalletState(state), [])
	useEffect(() => {
		const update = () => {
			if (workflowLockedRef.current) {
				window.history.replaceState(undefined, '', `${window.location.pathname}${window.location.search}#/${routeRef.current}`)
				return
			}
			const nextRoute = currentRoute()
			if (!demo) setLiveWalletSummary(current => walletSummaryAfterRouteChange(current, routeRef.current, nextRoute, selectedUniverseId))
			routeRef.current = nextRoute
			setRoute(nextRoute)
		}
		window.addEventListener('hashchange', update)
		return () => window.removeEventListener('hashchange', update)
	}, [demo, selectedUniverseId])
	useEffect(() => {
		window.scrollTo(0, 0)
		document.title = tradingDocumentTitle(route)
	}, [route])
	useEffect(() => {
		if (demo) return
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
	}, [demo, deploymentRetryNonce, loadLiveDeployment])
	const resolvedContent = renderRoute(route, scenario, market, updateWorkflowLock)
	let content = resolvedContent
	const deploymentSetupActive = !demo && route !== 'not-found' && route !== 'help' && (route === 'deploy' || liveDeploymentStatus === 'unavailable')
	if (!demo) {
		if (route === 'not-found') content = resolvedContent
		else if (route === 'help') content = <Help />
		else if (route === 'deploy')
			content = (
				<TradingDeploymentSetup
					configurationError={liveConfigurationError}
					onComplete={completeWalletDeployment}
					onRetryConfiguration={retryDeployment}
					onWorkflowLockChange={updateWorkflowLock}
					onWalletStateChange={updateDeploymentWalletState}
					walletControlRequestNonce={deploymentWalletRequestNonce}
					{...(liveConfiguration === undefined ? {} : { currentConfiguration: liveConfiguration })}
					{...(deploymentSetupServices === undefined ? {} : { services: deploymentSetupServices })}
				/>
			)
		else if (liveDeploymentStatus === 'unavailable')
			content = (
				<TradingDeploymentSetup
					configurationError={liveConfigurationError}
					onComplete={completeWalletDeployment}
					onRetryConfiguration={retryDeployment}
					onWorkflowLockChange={updateWorkflowLock}
					onWalletStateChange={updateDeploymentWalletState}
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
					onDeploymentRetry={retryDeployment}
				/>
			)
	} else if (route !== 'not-found' && scenario === 'loading')
		content = (
			<main class='route' id='main-content'>
				<header class='route-header'>
					<div>
						<h1>Loading markets</h1>
						<p>Reading the current factory index, lifecycle state, and pair reserves…</p>
					</div>
				</header>
				<section class='section' aria-busy='true'>
					<div class='loading-line' />
					<div class='loading-line loading-line--short' />
				</section>
			</main>
		)
	const banner = renderBanner(scenario, demo)
	return (
		<div class='app-shell'>
			<a
				class='skip-link'
				href='#main-content'
				onClick={event => {
					event.preventDefault()
					const main = document.getElementById('main-content')
					if (!(main instanceof HTMLElement)) return
					main.tabIndex = -1
					main.focus()
				}}
			>
				Skip to content
			</a>
			<div class='site-chrome'>
				{banner}
				<header class='site-header'>
					<a class='brand' href='#/markets' aria-label='Statoblast trading home' aria-disabled={workflowLocked} onClick={workflowLocked ? event => event.preventDefault() : undefined}>
						<span class='brand__mark'>S</span>
						<span>
							<strong>Statoblast trading</strong>
						</span>
					</a>
					<nav aria-label='Primary'>
						<a aria-current={route === 'markets' ? 'page' : undefined} aria-disabled={workflowLocked} href='#/markets' onClick={workflowLocked ? event => event.preventDefault() : undefined}>
							Markets
						</a>
						<a aria-current={route === 'liquidity' ? 'page' : undefined} aria-disabled={workflowLocked} href='#/liquidity' onClick={workflowLocked ? event => event.preventDefault() : undefined}>
							Liquidity
						</a>
						<a aria-current={route === 'portfolio' ? 'page' : undefined} aria-disabled={workflowLocked} href='#/portfolio' onClick={workflowLocked ? event => event.preventDefault() : undefined}>
							Portfolio
						</a>
						{demo ? null : (
							<a aria-current={route === 'deploy' ? 'page' : undefined} aria-disabled={workflowLocked} href='#/deploy' onClick={workflowLocked ? event => event.preventDefault() : undefined}>
								Deploy
							</a>
						)}
						<a aria-current={route === 'help' ? 'page' : undefined} aria-disabled={workflowLocked} href='#/help' onClick={workflowLocked ? event => event.preventDefault() : undefined}>
							Help
						</a>
					</nav>
					<div class='header-actions'>
						<span class={`network-pill${networkToneClass(scenario, demo, liveDeploymentStatus)}`}>
							<span />
							{networkLabel(scenario, demo, liveDeploymentStatus)}
						</span>
						{demo || showUniverseSelector ? <WalletSummary summary={walletSummary} onRetry={retryWalletSummary} /> : null}
						{showUniverseSelector ? <UniverseSelector options={universeOptions} selectedId={selectedUniverseId} disabled={workflowLocked} onChange={setSelectedUniverseId} /> : null}
						{deploymentSetupActive ? (
							<button
								class='wallet-button'
								type='button'
								disabled={workflowLocked || deploymentWalletState.connecting || !deploymentWalletState.ready}
								aria-busy={deploymentWalletState.connecting}
								aria-label={deploymentWalletState.account === undefined ? undefined : `Disconnect wallet ${deploymentWalletState.account}`}
								title={deploymentWalletState.account === undefined ? undefined : 'Disconnect wallet'}
								onClick={() => setDeploymentWalletRequestNonce(current => current + 1)}
							>
								{deploymentWalletLabel(deploymentWalletState)}
							</button>
						) : null}
						{!demo && liveDeploymentStatus === 'verified' && routeOwnsLiveWallet(route) ? (
							<button class='wallet-button' type='button' disabled={workflowLocked} onClick={() => setWalletConnectRequestNonce(current => current + 1)}>
								{walletSummary.account === undefined ? 'Connect wallet' : shortAddress(walletSummary.account)}
							</button>
						) : null}
					</div>
				</header>
			</div>
			{content}
		</div>
	)
}
