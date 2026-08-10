import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { demoMarket } from '../demo/markets.ts'
import { MarketDetail } from '../features/MarketDetail.tsx'
import { Developer, Help, Liquidity, MarketList, Portfolio } from '../features/Routes.tsx'
import { LiveTrading } from '../features/LiveTrading.tsx'
import { loadDeploymentConfiguration, type DeploymentConfiguration } from '../protocol/config.ts'
import { createTradingPublicClient, validateLiveDeployment } from '../protocol/live.ts'

function currentRoute() {
	return window.location.hash.replace(/^#\/?/, '') || 'markets'
}

function renderRoute(route: string, scenario: string, market: ReturnType<typeof demoMarket>, onWorkflowLockChange: (locked: boolean) => void) {
	if (route === 'market') return <MarketDetail market={market} scenario={scenario} onWorkflowLockChange={onWorkflowLockChange} />
	if (route === 'liquidity') return <Liquidity market={market} />
	if (route === 'portfolio') return <Portfolio market={market} />
	if (route === 'help') return <Help />
	if (route === 'developer') return <Developer />
	return <MarketList market={market} />
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
			<span>Universe</span>
			<select aria-label='Universe' title={selected?.accessibleLabel ?? selected?.label} value={selectedId ?? ''} disabled={disabled || options.length === 0} onChange={event => onChange(event.currentTarget.value)}>
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

function demoUniverseChoices(scenario: string) {
	const choices = scenario === 'max-token-ids' ? [demoMarket(scenario), demoMarket('max-token-ids-alt'), demoMarket('baseline'), demoMarket('truth-auction')] : [demoMarket(scenario), demoMarket('baseline'), demoMarket('truth-auction')]
	return choices.filter((market, index) => choices.findIndex(candidate => candidate.universeId === market.universeId) === index)
}

export function compactUniverseId(universeId: string) {
	if (universeId.length <= 18) return universeId
	return `${universeId.slice(0, 3)}…${universeId.slice(-3)}`
}

function demoUniverseLabel(market: ReturnType<typeof demoMarket>) {
	if (market.universeId === 1n && market.universe === 'Genesis universe') return 'Genesis'
	if (market.universeId === 1n && market.universe === 'Parent universe · forked') return 'Parent · forked'
	if (market.universeId === 2n && market.universe === 'Child universe · YES branch') return 'YES child'
	return `ID ${compactUniverseId(market.universeId.toString())}`
}

export function App() {
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
	const routeRef = useRef(route)
	const workflowLockedRef = useRef(workflowLocked)
	routeRef.current = route
	workflowLockedRef.current = workflowLocked
	const updateWorkflowLock = useCallback((locked: boolean) => {
		workflowLockedRef.current = locked
		setWorkflowLocked(locked)
	}, [])
	const updateLiveUniverses = useCallback((universeIds: readonly bigint[], authoritativeSelection: bigint | undefined) => {
		const options = universeIds.map(universeId => {
			const id = universeId.toString()
			return { id, label: `ID ${compactUniverseId(id)}`, accessibleLabel: `Universe ID ${id}` }
		})
		setLiveUniverseOptions(options)
		setSelectedUniverseId(current => {
			if (current !== undefined && options.some(option => option.id === current)) return current
			return authoritativeSelection?.toString()
		})
	}, [])
	const demoMarkets = demoUniverseChoices(scenario)
	const demoUniverseOptions = demoMarkets.map(choice => {
		const id = choice.universeId.toString()
		return { id, label: demoUniverseLabel(choice), accessibleLabel: choice.universeId === 1n || choice.universeId === 2n ? choice.universe : `Universe ID ${id}` }
	})
	const market = demoMarkets.find(choice => choice.universeId.toString() === selectedUniverseId) ?? initialDemoMarket
	const universeOptions = demo ? demoUniverseOptions : liveUniverseOptions
	const showUniverseSelector = route !== 'help' && route !== 'developer'
	useEffect(() => {
		const update = () => {
			if (workflowLockedRef.current) {
				window.history.replaceState(undefined, '', `${window.location.pathname}${window.location.search}#/${routeRef.current}`)
				return
			}
			const nextRoute = currentRoute()
			routeRef.current = nextRoute
			setRoute(nextRoute)
		}
		window.addEventListener('hashchange', update)
		return () => window.removeEventListener('hashchange', update)
	}, [])
	useEffect(() => {
		window.scrollTo(0, 0)
	}, [route])
	useEffect(() => {
		if (demo) return
		let active = true
		setLiveDeploymentStatus('loading')
		void (async () => {
			try {
				const loaded = await loadDeploymentConfiguration()
				if (!active) return
				if (loaded === undefined) throw new Error('Missing deployment.json. Build with a reviewed trading deployment manifest.')
				await validateLiveDeployment(createTradingPublicClient(loaded), loaded)
				if (!active) return
				setLiveConfiguration(loaded)
				setLiveConfigurationError(undefined)
				setLiveDeploymentStatus('verified')
			} catch (error) {
				if (!active) return
				setLiveConfiguration(undefined)
				setLiveConfigurationError(error instanceof Error ? error.message : 'Unable to load the trading deployment')
				setLiveDeploymentStatus('unavailable')
			}
		})()
		return () => {
			active = false
		}
	}, [demo])
	const resolvedContent = renderRoute(route, scenario, market, updateWorkflowLock)
	let content = resolvedContent
	if (!demo) {
		if (route === 'help') content = <Help />
		else if (route === 'developer') content = <Developer demo={false} deploymentStatus={liveDeploymentStatus} />
		else content = <LiveTrading route={route} configuration={liveConfiguration} configurationError={liveConfigurationError} selectedUniverseId={selectedUniverseId} onUniversesChange={updateLiveUniverses} onWorkflowLockChange={updateWorkflowLock} />
	} else if (scenario === 'loading')
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
					<a class='brand' href='#/markets' aria-label='Zoltar Trading home' aria-disabled={workflowLocked} onClick={workflowLocked ? event => event.preventDefault() : undefined}>
						<span class='brand__mark'>Z</span>
						<span>
							<strong>Zoltar</strong>
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
						<a aria-current={route === 'help' ? 'page' : undefined} aria-disabled={workflowLocked} href='#/help' onClick={workflowLocked ? event => event.preventDefault() : undefined}>
							Help
						</a>
						<a aria-current={route === 'developer' ? 'page' : undefined} aria-disabled={workflowLocked} href='#/developer' onClick={workflowLocked ? event => event.preventDefault() : undefined}>
							Developer
						</a>
					</nav>
					<div class='header-actions'>
						<a class={`network-pill${networkToneClass(scenario, demo, liveDeploymentStatus)}`} href='#/developer' aria-disabled={workflowLocked} onClick={workflowLocked ? event => event.preventDefault() : undefined}>
							<span />
							{networkLabel(scenario, demo, liveDeploymentStatus)}
						</a>
						{demo ? <span class='wallet-context'>0x8ba1…ba72</span> : null}
						{showUniverseSelector ? <UniverseSelector options={universeOptions} selectedId={selectedUniverseId} disabled={workflowLocked} onChange={setSelectedUniverseId} /> : null}
					</div>
				</header>
			</div>
			{content}
			<footer>
				<span>Zoltar two-way AMM · unaudited MVP</span>
				<span>Spot prices are not manipulation-resistant oracles.</span>
			</footer>
		</div>
	)
}
