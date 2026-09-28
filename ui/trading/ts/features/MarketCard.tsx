import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { EntityCard } from '@zoltar/ui-core-shared/components/EntityCard.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { MarketOddsBar } from '../components/MarketOddsBar.js'
import { liveCopy } from '../copy/live.js'
import { marketsCopy } from '../copy/markets.js'
import { formatRoundedUnits } from '../lib/format.js'
import { coarseDuration, marketLiquidityAttoEth, marketOddsPercent } from '../lib/marketListing.js'
import { getTradingRouteHref, type TradingListKind, type TradingLookupRoute } from '../lib/routing.js'
import { marketTicketHref } from '../lib/ticketSide.js'
import { marketAcceptsNewRisk, type LiveMarket } from '../protocol/live.js'
import { livePairInitialized } from './liveTradingControllerHelpers.js'
import { marketStatusLabel, marketStatusTone } from './marketStatus.js'

type RowLink = Readonly<{ href: string; label: string }>

function marketRowActions(listKind: TradingListKind, lookupRoute: TradingLookupRoute, pool: string): Readonly<{ primary: RowLink; secondary: RowLink }> {
	if (listKind === 'security-pools') return { primary: { href: `#/create-market/${pool}`, label: liveCopy.createMarketAction }, secondary: { href: `#/security-pool/${pool}`, label: liveCopy.poolDetails } }
	const trade = { href: `#/market/${pool}`, label: liveCopy.trade }
	const liquidity = { href: `#/liquidity/${pool}`, label: liveCopy.manageLiquidity }
	return lookupRoute === 'liquidity' ? { primary: liquidity, secondary: trade } : { primary: trade, secondary: liquidity }
}

export function formatMarketLiquidity(market: LiveMarket) {
	const liquidity = marketLiquidityAttoEth(market)
	return liquidity === undefined ? undefined : marketsCopy.liquidityValue(formatRoundedUnits(liquidity, 18, 4))
}

function MarketCardOdds({ market, tradeable }: { market: LiveMarket; tradeable: boolean }) {
	const odds = marketOddsPercent(market)
	if (odds === undefined) return <p className='detail market-card__odds-note'>{marketsCopy.oddsUnavailable}</p>
	return (
		<div className='market-card__odds'>
			<MarketOddsBar yesPercent={odds.yes} noPercent={odds.no} showValues={!tradeable} />
			{tradeable ? (
				<div className='market-card__outcomes'>
					<a className='button-link outcome-button outcome-button--yes' href={marketTicketHref(market.pool, 'YES')} aria-label={marketsCopy.buyOutcomeAt(marketsCopy.yes, odds.yes)}>
						{marketsCopy.outcomeOdds(marketsCopy.yes, odds.yes)}
					</a>
					<a className='button-link outcome-button outcome-button--no' href={marketTicketHref(market.pool, 'NO')} aria-label={marketsCopy.buyOutcomeAt(marketsCopy.no, odds.no)}>
						{marketsCopy.outcomeOdds(marketsCopy.no, odds.no)}
					</a>
				</div>
			) : undefined}
		</div>
	)
}

/**
 * One market in a list. Market lists lead with the conditional odds and, on the trade landing, one-click YES / NO
 * buttons that open the ticket on that side; contract addresses live on the market page, not here.
 */
export function MarketCard({ listKind, lookupRoute, market, nowSeconds }: { listKind: TradingListKind; lookupRoute: TradingLookupRoute; market: LiveMarket; nowSeconds: bigint }) {
	// The primary action follows the workflow the landing names: liquidity lists lead with liquidity, market lists with trading.
	const actions = marketRowActions(listKind, lookupRoute, market.pool)
	const loaded = market.loadError === undefined
	const open = loaded && marketAcceptsNewRisk(market, nowSeconds)
	// The outcome buttons replace the generic trade link on the trade landing whenever the pair can take a trade.
	const outcomeButtons = listKind === 'markets' && lookupRoute === 'market' && open && livePairInitialized(market)
	const liquidity = listKind === 'markets' ? formatMarketLiquidity(market) : undefined
	const upcoming = market.endTime > nowSeconds
	return (
		<EntityCard
			className={listKind === 'markets' ? 'market-record market-card' : 'market-record directory-record'}
			surface={listKind === 'markets' ? 'card' : 'flat'}
			variant='compact'
			title={<a href={getTradingRouteHref(actions.primary.href)}>{market.title}</a>}
			badge={listKind === 'markets' ? <Badge tone={marketStatusTone(market, nowSeconds)}>{marketStatusLabel(market, nowSeconds)}</Badge> : undefined}
			actions={
				<>
					{outcomeButtons ? undefined : (
						<a className='button-link primary' href={getTradingRouteHref(actions.primary.href)}>
							{actions.primary.label}
						</a>
					)}
					<a className='button-link' href={getTradingRouteHref(actions.secondary.href)}>
						{actions.secondary.label}
					</a>
				</>
			}
		>
			{listKind === 'markets' && loaded ? <MarketCardOdds market={market} tradeable={outcomeButtons} /> : undefined}
			{loaded ? (
				<DataGrid dense>
					{liquidity === undefined ? undefined : <MetricField label={marketsCopy.liquidity}>{liquidity}</MetricField>}
					<MetricField label={upcoming ? marketsCopy.closes : marketsCopy.ended}>
						{upcoming ? marketsCopy.closesIn(coarseDuration(market.endTime - nowSeconds)) : marketsCopy.endedAgo(coarseDuration(nowSeconds - market.endTime))}
						<TimestampValue className='market-card__end-date' timestamp={market.endTime} relative={false} />
					</MetricField>
				</DataGrid>
			) : undefined}
		</EntityCard>
	)
}
