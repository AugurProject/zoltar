import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { EntityCard } from '@zoltar/ui-core-shared/components/EntityCard.js'
import { FavoriteToggle } from '@zoltar/ui-core-shared/components/FavoriteToggle.js'
import { RetryAction, RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { PaginationControls } from '@zoltar/ui-core-shared/components/PaginationControls.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { ReadOnlyAddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { liveCopy } from '../copy/live.js'
import { formatTrimmedUnits } from '@zoltar/ui-core-shared/lib/formatters.js'
import { getTradingRouteHref, tradingListKindFor, type TradingListKind, type TradingLookupRoute } from '../lib/routing.js'
import { marketAcceptsNewRisk, marketNewRiskBlocker, type LiveMarket } from '../protocol/live.js'
import { livePairInitialized } from './liveTradingControllerHelpers.js'
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

function listPresentation(listKind: TradingListKind) {
	if (listKind === 'security-pools') return { title: liveCopy.securityPoolList, description: liveCopy.securityPoolListDescription, empty: liveCopy.noEligiblePools }
	return { title: liveCopy.marketList, description: undefined, empty: liveCopy.noMarketsOnPage }
}

function marketRowActions(listKind: TradingListKind, lookupRoute: TradingLookupRoute, pool: string) {
	if (listKind === 'security-pools') return { primary: { href: `#/create-market/${pool}`, label: liveCopy.createMarketAction }, secondary: { href: `#/security-pool/${pool}`, label: liveCopy.poolDetails } }
	const trade = { href: `#/market/${pool}`, label: liveCopy.trade }
	const liquidity = { href: `#/liquidity/${pool}`, label: liveCopy.manageLiquidity }
	return lookupRoute === 'liquidity' ? { primary: liquidity, secondary: trade } : { primary: trade, secondary: liquidity }
}

function MarketRow({ listKind, lookupRoute, market, nowSeconds }: { listKind: TradingListKind; lookupRoute: TradingLookupRoute; market: LiveMarket; nowSeconds: bigint }) {
	// The primary action follows the workflow the landing names: liquidity lists lead with liquidity, market lists with trading.
	const actions = marketRowActions(listKind, lookupRoute, market.pool)
	const primaryHref = actions.primary.href
	const secondaryHref = actions.secondary.href
	const primaryLabel = actions.primary.label
	const secondaryLabel = actions.secondary.label
	return (
		<EntityCard
			className='market-record directory-record'
			surface='flat'
			variant='compact'
			title={<a href={getTradingRouteHref(primaryHref)}>{market.title}</a>}
			badge={
				listKind === 'markets' ? (
					<>
						<Badge tone={marketStatusTone(market, nowSeconds)}>{marketStatusLabel(market, nowSeconds)}</Badge>
						{market.loadError === undefined ? <FavoriteToggle app='trading' entityLabel={market.title} id={market.pool} kind='market' /> : undefined}
					</>
				) : undefined
			}
			actions={
				<>
					<a className='button-link primary' href={getTradingRouteHref(primaryHref)}>
						{primaryLabel}
					</a>
					<a className='button-link' href={getTradingRouteHref(secondaryHref)}>
						{secondaryLabel}
					</a>
				</>
			}
		>
			<DataGrid dense>
				<MetricField label={liveCopy.securityPoolLabel}>
					<ReadOnlyAddressValue address={market.pool} responsiveAbbreviation />
				</MetricField>
				{market.loadError === undefined ? (
					<MetricField label={liveCopy.questionEnd}>
						<TimestampValue timestamp={market.endTime} relative={false} />
					</MetricField>
				) : undefined}
				{market.loadError === undefined && listKind === 'markets' ? <MetricField label={liveCopy.ammFee}>{formatTrimmedUnits(market.feeBps, 2, 2)}%</MetricField> : undefined}
			</DataGrid>
		</EntityCard>
	)
}

/** List-first landing for a workflow: the address lookup sits above the pageable candidate list, and the lookup route decides where an opened address goes. */
export function LiveMarketBrowser({
	lookupRoute,
	markets,
	favoriteMarkets = [],
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
	/** Favorites come from the browser cache, so they show before (and independently of) the paged chain scan. */
	favoriteMarkets?: readonly LiveMarket[]
	pageMarketCount: number
	discoveryState: 'loading' | 'ready' | 'error'
	discoveryError: string | undefined
	marketPage: Readonly<{ start: bigint; total: bigint; previousStart: bigint | undefined; nextStart: bigint | undefined }>
	workflowLocked: boolean
	nowSeconds: bigint
	retry(): void
	loadMarketPage(start: bigint | undefined): void
}) {
	const listKind = tradingListKindFor(lookupRoute) ?? 'markets'
	const presentation = listPresentation(listKind)
	const initialLoad = discoveryState === 'loading' && pageMarketCount === 0
	const retryAction = <RetryAction label={liveCopy.retryDiscovery} disabled={workflowLocked} onRetry={retry} />
	let content
	if (initialLoad) content = <EmptyState live title={liveCopy.discoveringSecurityPoolsFromFactory} />
	else if (discoveryState === 'error' && pageMarketCount === 0) content = <EmptyState title={liveCopy.securityPoolFactoryDiscoveryFailed(discoveryError)} actions={retryAction} />
	else
		content = (
			<>
				{discoveryState === 'error' ? <RetryableNotice message={liveCopy.securityPoolRefreshFailed(discoveryError ?? liveCopy.unknownDiscovery)} retryLabel={liveCopy.retryDiscovery} disabled={workflowLocked} onRetry={retry} /> : undefined}
				{markets.length === 0 ? (
					<EmptyState title={presentation.empty} />
				) : (
					<div className='entity-card-list market-list'>
						{markets.map(market => (
							<MarketRow key={market.pool} listKind={listKind} lookupRoute={lookupRoute} market={market} nowSeconds={nowSeconds} />
						))}
					</div>
				)}
			</>
		)
	return (
		<SectionBlock className='market-browser' title={listKind === 'security-pools' ? presentation.title : undefined} description={presentation.description} variant='plain' busy={discoveryState === 'loading'}>
			<OpenPoolForm disabled={workflowLocked} target={lookupRoute} />
			{listKind === 'markets' && favoriteMarkets.length > 0 ? (
				<>
					<h3 className='eyebrow market-list-heading'>{liveCopy.favoriteMarkets}</h3>
					<div className='entity-card-list market-list'>
						{favoriteMarkets.map(market => (
							<MarketRow key={market.pool} listKind={listKind} lookupRoute={lookupRoute} market={market} nowSeconds={nowSeconds} />
						))}
					</div>
					<h3 className='eyebrow market-list-heading'>{liveCopy.discoveredMarkets}</h3>
				</>
			) : undefined}
			{content}
			<PaginationControls
				hasNextPage={marketPage.nextStart !== undefined}
				hasPreviousPage={marketPage.previousStart !== undefined}
				loading={discoveryState === 'loading' || workflowLocked}
				summary={pageMarketCount === 0 ? undefined : liveCopy.poolPageRange(marketPage.start + 1n, marketPage.start + BigInt(pageMarketCount), marketPage.total)}
				onPreviousPage={() => loadMarketPage(marketPage.previousStart)}
				onNextPage={() => loadMarketPage(marketPage.nextStart)}
			/>
		</SectionBlock>
	)
}
