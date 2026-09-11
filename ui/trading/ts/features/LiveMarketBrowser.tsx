import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { liveCopy } from '../copy/live.js'
import { formatUnits } from '../lib/format.js'
import { getTradingRouteHref, type TradingBrowseRoute } from '../lib/routing.js'
import { marketAcceptsNewRisk, marketNewRiskBlocker, type LiveMarket } from '../protocol/live.js'
import { Status } from '../components/Status.js'
import { TradingAddressValue } from '../components/TradingAddress.js'
import { livePairInitialized } from './liveTradingControllerHelpers.js'
import { formatTimestamp } from './LiveTradingTransactionUi.js'

export function marketStatusLabel(market: LiveMarket, nowSeconds: bigint) {
	if (market.loadError !== undefined) return liveCopy.marketDataUnavailable
	const blocker = marketNewRiskBlocker(market, nowSeconds)
	if (blocker !== undefined) return blocker
	if (market.pair === undefined) return liveCopy.pairNotCreated
	return livePairInitialized(market) ? liveCopy.tradingOpen : liveCopy.pairUninitialized
}

function browsePresentation(route: TradingBrowseRoute) {
	if (route === 'security-pools') return { back: { href: '#/create-market', label: liveCopy.backToCreateMarket }, title: liveCopy.browseSecurityPools, description: liveCopy.browseSecurityPoolsDescription, empty: liveCopy.noEligiblePools }
	return { back: { href: '#/market', label: liveCopy.backToMarket }, title: liveCopy.browseMarkets, description: undefined, empty: liveCopy.noMarketsOnPage }
}

function MarketRow({ route, market, nowSeconds }: { route: TradingBrowseRoute; market: LiveMarket; nowSeconds: bigint }) {
	const primaryHref = route === 'security-pools' ? `#/create-market/${market.pool}` : `#/market/${market.pool}`
	const secondaryHref = route === 'security-pools' ? `#/security-pool/${market.pool}` : `#/liquidity/${market.pool}`
	return (
		<article class='market-row'>
			<div class='market-row__main'>
				<h2>
					<a href={getTradingRouteHref(primaryHref)}>{market.title}</a>
				</h2>
				{route === 'markets' ? (
					<p>
						<Status tone={market.loadError === undefined && marketAcceptsNewRisk(market, nowSeconds) ? 'good' : 'warn'}>{marketStatusLabel(market, nowSeconds)}</Status>
					</p>
				) : null}
			</div>
			<dl class='market-row__metrics'>
				<div>
					<dt>{liveCopy.securityPoolLabel}</dt>
					<dd>
						<TradingAddressValue value={market.pool} />
					</dd>
				</div>
				{market.loadError === undefined ? (
					<div>
						<dt>{liveCopy.questionEnd}</dt>
						<dd>{formatTimestamp(market.endTime)}</dd>
					</div>
				) : null}
				{market.loadError === undefined && route === 'markets' ? (
					<div>
						<dt>{liveCopy.ammFee}</dt>
						<dd>{formatUnits(market.feeBps, 2, 2)}%</dd>
					</div>
				) : null}
			</dl>
			<div class='market-row__actions'>
				<a class='primary-action' href={getTradingRouteHref(primaryHref)}>
					{route === 'security-pools' ? liveCopy.createMarketAction : liveCopy.trade}
				</a>
				<a class='row-action' href={getTradingRouteHref(secondaryHref)}>
					{route === 'security-pools' ? liveCopy.poolDetails : liveCopy.manageLiquidity}
				</a>
			</div>
		</article>
	)
}

export function LiveMarketBrowser({
	route,
	markets,
	pageMarketCount,
	discoveryState,
	discoveryError,
	marketPage,
	workflowLocked,
	nowSeconds,
	connectionMessage,
	retry,
	loadMarketPage,
}: {
	route: TradingBrowseRoute
	markets: readonly LiveMarket[]
	pageMarketCount: number
	discoveryState: 'loading' | 'ready' | 'error'
	discoveryError: string | undefined
	marketPage: Readonly<{ start: bigint; total: bigint; previousStart: bigint | undefined; nextStart: bigint | undefined }>
	workflowLocked: boolean
	nowSeconds: bigint
	connectionMessage?: string | undefined
	retry(): void
	loadMarketPage(start: bigint | undefined): void
}) {
	const presentation = browsePresentation(route)
	const initialLoad = discoveryState === 'loading' && pageMarketCount === 0
	let content
	if (initialLoad) content = <p role='status'>{liveCopy.discoveringSecurityPoolsFromFactory}</p>
	else if (discoveryState === 'error' && pageMarketCount === 0)
		content = (
			<div>
				<p class='error' role='alert'>
					{liveCopy.securityPoolFactoryDiscoveryFailed(discoveryError)}
				</p>
				<button class='secondary-action' disabled={workflowLocked} onClick={retry}>
					{liveCopy.retryDiscovery}
				</button>
			</div>
		)
	else
		content = (
			<>
				{discoveryState === 'error' ? (
					<div>
						<p class='error' role='alert'>
							{liveCopy.securityPoolRefreshFailed(discoveryError ?? liveCopy.unknownDiscovery)}
						</p>
						<button class='secondary-action' disabled={workflowLocked} onClick={retry}>
							{liveCopy.retryDiscovery}
						</button>
					</div>
				) : null}
				{markets.length === 0 ? <p>{presentation.empty}</p> : markets.map(market => <MarketRow key={market.pool} route={route} market={market} nowSeconds={nowSeconds} />)}
			</>
		)
	return (
		<main class='route' id='main-content'>
			<RouteHeader eyebrow={<a href={getTradingRouteHref(presentation.back.href)}>{presentation.back.label}</a>} title={presentation.title} description={presentation.description} />
			{connectionMessage === undefined ? null : (
				<p class='error' role='alert'>
					{connectionMessage}
				</p>
			)}
			<section class='section market-list' aria-busy={discoveryState === 'loading'}>
				{content}
				{marketPage.previousStart === undefined && marketPage.nextStart === undefined ? null : (
					<nav class='market-pagination' aria-label={liveCopy.securityPoolPages}>
						<button class='secondary-action' disabled={marketPage.previousStart === undefined || discoveryState === 'loading' || workflowLocked} onClick={() => loadMarketPage(marketPage.previousStart)}>
							{liveCopy.previousPools}
						</button>
						<span>{liveCopy.poolPageRange(marketPage.start + 1n, marketPage.start + BigInt(pageMarketCount), marketPage.total)}</span>
						<button class='secondary-action' disabled={marketPage.nextStart === undefined || discoveryState === 'loading' || workflowLocked} onClick={() => loadMarketPage(marketPage.nextStart)}>
							{liveCopy.nextPools}
						</button>
					</nav>
				)}
			</section>
		</main>
	)
}
