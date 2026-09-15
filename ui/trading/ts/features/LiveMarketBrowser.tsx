import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { EntityCard } from '@zoltar/ui-core-shared/components/EntityCard.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { PaginationControls } from '@zoltar/ui-core-shared/components/PaginationControls.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { ReadOnlyAddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { liveCopy } from '../copy/live.js'
import { formatUnits } from '../lib/format.js'
import { getTradingRouteHref, tradingBrowseRouteFor, type TradingBrowseRoute, type TradingLookupRoute } from '../lib/routing.js'
import { marketAcceptsNewRisk, marketNewRiskBlocker, type LiveMarket } from '../protocol/live.js'
import { livePairInitialized } from './liveTradingControllerHelpers.js'
import { formatTimestamp } from './LiveTradingTransactionUi.js'
import { OpenPoolForm } from './OpenPoolForm.js'

export function marketStatusLabel(market: LiveMarket, nowSeconds: bigint) {
	if (market.loadError !== undefined) return liveCopy.marketDataUnavailable
	const blocker = marketNewRiskBlocker(market, nowSeconds)
	if (blocker !== undefined) return blocker
	if (market.pair === undefined) return liveCopy.pairNotCreated
	return livePairInitialized(market) ? liveCopy.tradingOpen : liveCopy.pairUninitialized
}

export function marketStatusTone(market: LiveMarket, nowSeconds: bigint) {
	return market.loadError === undefined && marketAcceptsNewRisk(market, nowSeconds) ? ('ok' as const) : ('warning' as const)
}

function browsePresentation(route: TradingBrowseRoute) {
	if (route === 'security-pools') return { title: liveCopy.browseSecurityPools, description: liveCopy.browseSecurityPoolsDescription, empty: liveCopy.noEligiblePools }
	return { title: liveCopy.browseMarkets, description: undefined, empty: liveCopy.noMarketsOnPage }
}

function marketRowActions(route: TradingBrowseRoute, lookupRoute: TradingLookupRoute, pool: string) {
	if (route === 'security-pools') return { primary: { href: `#/create-market/${pool}`, label: liveCopy.createMarketAction }, secondary: { href: `#/security-pool/${pool}`, label: liveCopy.poolDetails } }
	const trade = { href: `#/market/${pool}`, label: liveCopy.trade }
	const liquidity = { href: `#/liquidity/${pool}`, label: liveCopy.manageLiquidity }
	return lookupRoute === 'liquidity' ? { primary: liquidity, secondary: trade } : { primary: trade, secondary: liquidity }
}

function MarketRow({ route, lookupRoute, market, nowSeconds }: { route: TradingBrowseRoute; lookupRoute: TradingLookupRoute; market: LiveMarket; nowSeconds: bigint }) {
	// The primary action follows the workflow the landing names: liquidity lists lead with liquidity, market lists with trading.
	const actions = marketRowActions(route, lookupRoute, market.pool)
	const primaryHref = actions.primary.href
	const secondaryHref = actions.secondary.href
	const primaryLabel = actions.primary.label
	const secondaryLabel = actions.secondary.label
	return (
		<EntityCard
			className='market-record'
			title={<a href={getTradingRouteHref(primaryHref)}>{market.title}</a>}
			badge={route === 'markets' ? <Badge tone={marketStatusTone(market, nowSeconds)}>{marketStatusLabel(market, nowSeconds)}</Badge> : undefined}
			actions={
				<>
					<a class='button-link primary' href={getTradingRouteHref(primaryHref)}>
						{primaryLabel}
					</a>
					<a class='button-link' href={getTradingRouteHref(secondaryHref)}>
						{secondaryLabel}
					</a>
				</>
			}
		>
			<DataGrid dense>
				<MetricField label={liveCopy.securityPoolLabel}>
					<ReadOnlyAddressValue address={market.pool} responsiveAbbreviation />
				</MetricField>
				{market.loadError === undefined ? <MetricField label={liveCopy.questionEnd}>{formatTimestamp(market.endTime)}</MetricField> : undefined}
				{market.loadError === undefined && route === 'markets' ? <MetricField label={liveCopy.ammFee}>{formatUnits(market.feeBps, 2, 2)}%</MetricField> : undefined}
			</DataGrid>
		</EntityCard>
	)
}

/**
 * List-first landing for a workflow: the address lookup sits above the pageable candidate list. Both the lookup route
 * (`#/market`) and its browse alias (`#/markets`) render this content, so the lookup target decides where an opened
 * address goes.
 */
export function LiveMarketBrowser({
	lookupRoute,
	markets,
	pageMarketCount,
	discoveryState,
	discoveryError,
	marketPage,
	workflowLocked,
	nowSeconds,
	retry,
	loadMarketPage,
}: {
	lookupRoute: TradingLookupRoute
	markets: readonly LiveMarket[]
	pageMarketCount: number
	discoveryState: 'loading' | 'ready' | 'error'
	discoveryError: string | undefined
	marketPage: Readonly<{ start: bigint; total: bigint; previousStart: bigint | undefined; nextStart: bigint | undefined }>
	workflowLocked: boolean
	nowSeconds: bigint
	retry(): void
	loadMarketPage(start: bigint | undefined): void
}) {
	const route = tradingBrowseRouteFor(lookupRoute)
	const presentation = browsePresentation(route)
	const initialLoad = discoveryState === 'loading' && pageMarketCount === 0
	const retryAction = (
		<button class='secondary' type='button' disabled={workflowLocked} onClick={retry}>
			{liveCopy.retryDiscovery}
		</button>
	)
	let content
	if (initialLoad) content = <EmptyState live title={liveCopy.discoveringSecurityPoolsFromFactory} />
	else if (discoveryState === 'error' && pageMarketCount === 0) content = <EmptyState title={liveCopy.securityPoolFactoryDiscoveryFailed(discoveryError)} actions={retryAction} />
	else
		content = (
			<>
				{discoveryState === 'error' ? (
					<>
						<ErrorNotice message={liveCopy.securityPoolRefreshFailed(discoveryError ?? liveCopy.unknownDiscovery)} />
						<div class='actions'>{retryAction}</div>
					</>
				) : undefined}
				{markets.length === 0 ? (
					<EmptyState title={presentation.empty} />
				) : (
					<div class='entity-card-list market-list'>
						{markets.map(market => (
							<MarketRow key={market.pool} route={route} lookupRoute={lookupRoute} market={market} nowSeconds={nowSeconds} />
						))}
					</div>
				)}
			</>
		)
	return (
		<SectionBlock
			className='market-browser'
			title={presentation.title}
			description={presentation.description}
			variant='plain'
			actions={
				<PaginationControls
					hasNextPage={marketPage.nextStart !== undefined}
					hasPreviousPage={marketPage.previousStart !== undefined}
					loading={(discoveryState === 'loading' && pageMarketCount === 0) || workflowLocked}
					summary={pageMarketCount === 0 ? undefined : liveCopy.poolPageRange(marketPage.start + 1n, marketPage.start + BigInt(pageMarketCount), marketPage.total)}
					onPreviousPage={() => loadMarketPage(marketPage.previousStart)}
					onNextPage={() => loadMarketPage(marketPage.nextStart)}
				/>
			}
		>
			<OpenPoolForm disabled={workflowLocked} target={lookupRoute} />
			<div aria-busy={discoveryState === 'loading'}>{content}</div>
		</SectionBlock>
	)
}
