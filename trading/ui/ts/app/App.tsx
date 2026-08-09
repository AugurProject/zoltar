import { useEffect, useState } from 'preact/hooks'
import { demoMarket } from '../demo/markets.ts'
import { MarketDetail } from '../features/MarketDetail.tsx'
import { Developer, Help, Liquidity, MarketList, Portfolio } from '../features/Routes.tsx'
import { LiveTrading } from '../features/LiveTrading.tsx'

function currentRoute() {
	return window.location.hash.replace(/^#\/?/, '') || 'markets'
}

function renderRoute(route: string, scenario: string, market: ReturnType<typeof demoMarket>) {
	if (route === 'market') return <MarketDetail market={market} scenario={scenario} />
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

function networkLabel(scenario: string, demo: boolean) {
	if (scenario === 'wrong-network') return 'Unsupported · requires Anvil 31337'
	return demo ? 'Anvil 31337' : 'Configured live network'
}

export function App() {
	const [route, setRoute] = useState(currentRoute)
	const query = new URLSearchParams(window.location.search)
	const demo = query.get('demo') === '1'
	const scenario = query.get('scenario') ?? 'baseline'
	const market = demoMarket(scenario)
	useEffect(() => {
		const update = () => setRoute(currentRoute())
		window.addEventListener('hashchange', update)
		return () => window.removeEventListener('hashchange', update)
	}, [])
	const resolvedContent = renderRoute(route, scenario, market)
	let content = resolvedContent
	if (!demo) {
		if (route === 'help') content = <Help />
		else if (route === 'developer') content = <Developer demo={false} />
		else content = <LiveTrading route={route} />
	} else if (scenario === 'loading')
		content = (
			<main class='route' id='main-content'>
				<header class='route-header'>
					<div>
						<span class='eyebrow'>Canonical SecurityPools</span>
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
			<a class='skip-link' href='#main-content'>
				Skip to content
			</a>
			<div class='site-chrome'>
				{banner}
				<header class='site-header'>
					<a class='brand' href='#/markets' aria-label='Zoltar Trading home'>
						<span class='brand__mark'>Z</span>
						<span>
							<strong>Zoltar</strong>
							<small>Two-way trading</small>
						</span>
					</a>
					<nav aria-label='Primary'>
						<a aria-current={route === 'markets' ? 'page' : undefined} href='#/markets'>
							Markets
						</a>
						<a aria-current={route === 'liquidity' ? 'page' : undefined} href='#/liquidity'>
							Liquidity
						</a>
						<a aria-current={route === 'portfolio' ? 'page' : undefined} href='#/portfolio'>
							Portfolio
						</a>
						<a aria-current={route === 'help' ? 'page' : undefined} href='#/help'>
							Help
						</a>
						<a aria-current={route === 'developer' ? 'page' : undefined} href='#/developer'>
							Developer
						</a>
					</nav>
					<div class='header-actions'>
						<a class={`network-pill${scenario === 'wrong-network' ? ' network-pill--warn' : ''}`} href='#/developer'>
							<span />
							{networkLabel(scenario, demo)}
						</a>
						<button class='wallet-button' disabled>
							{demo ? '0x8ba1…ba72' : 'Connect in market view'}
						</button>
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
