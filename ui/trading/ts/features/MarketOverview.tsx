import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import type { ComponentChildren, RefObject } from 'preact'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { FavoriteToggle } from '@zoltar/ui-core-shared/components/FavoriteToggle.js'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { ReadOnlyAddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js'
import { StickyObjectContext } from '@zoltar/ui-core-shared/components/StickyObjectContext.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { formatScaledPercentage } from '@zoltar/ui-core-shared/lib/formatters.js'
import { ProbabilityBar } from '../components/ProbabilityBar.js'
import { TradingSecurityPoolLink } from '../components/TradingSecurityPoolLink.js'
import { liveCopy } from '../copy/live.js'
import { getTradingRouteHref } from '../lib/routing.js'
import { marketsCopy } from '../copy/markets.js'
import { marketYesTenths } from '../lib/marketListing.js'
import type { LiveMarket } from '../protocol/live.js'
import { formatMarketLiquidity } from './MarketCard.js'
import { marketStatusLabel, marketStatusTone } from './marketStatus.js'

/** Question, status, pool, and the facts that decide a trade, for the states without the market page's reading column: an existing pair on the create route, a market that failed to load, and market creation. */
export function MarketFacts({ market, nowSeconds, headingRef }: { market: LiveMarket; nowSeconds: bigint; headingRef: RefObject<HTMLHeadingElement> }) {
	const liquidity = formatMarketLiquidity(market)
	return (
		<StickyObjectContext
			variant='embedded-context-strip'
			sticky={false}
			title={market.title}
			titleRef={headingRef}
			badge={
				<>
					{market.loadError === undefined ? <FavoriteToggle app='trading' entityLabel={market.title} id={market.pool} kind='market' /> : undefined}
					<Badge tone={marketStatusTone(market, nowSeconds)}>{marketStatusLabel(market, nowSeconds)}</Badge>
				</>
			}
			items={[
				{ label: liveCopy.securityPoolLabel, value: <TradingSecurityPoolLink value={market.pool} /> },
				...(market.loadError === undefined
					? [{ label: liveCopy.questionEnd, value: <TimestampValue timestamp={market.endTime} relative={false} /> }, ...(liquidity === undefined ? [] : [{ label: marketsCopy.liquidity, value: liquidity }]), { label: liveCopy.ammFee, value: formatScaledPercentage(market.feeBps, 2) }]
					: []),
			]}
		/>
	)
}

/** Contract addresses stay reachable for verification without competing with the question for attention. */
export function MarketContracts({ market }: { market: LiveMarket }) {
	return (
		<ReadOnlyDetailAccordion title={marketsCopy.contracts}>
			<DataGrid dense>
				<MetricField label={liveCopy.securityPoolLabel}>
					<TradingSecurityPoolLink value={market.pool} />
				</MetricField>
				<MetricField label={liveCopy.pair}>{market.pair === undefined ? liveCopy.notDeployed : <ReadOnlyAddressValue address={market.pair} responsiveAbbreviation />}</MetricField>
				<MetricField label={marketsCopy.shareToken}>
					<ReadOnlyAddressValue address={market.shareToken} responsiveAbbreviation />
				</MetricField>
			</DataGrid>
		</ReadOnlyDetailAccordion>
	)
}

/** The market page's title row: back to the list, the question as the page title, and its favorite and status beside it. */
export function MarketPageHeader({ market, nowSeconds, headingRef, actions }: { market: LiveMarket; nowSeconds: bigint; headingRef: RefObject<HTMLHeadingElement>; actions?: ComponentChildren }) {
	return (
		<RouteHeader
			className='market-page-header'
			eyebrow={
				<a className='route-back-link' href={getTradingRouteHref('#/market')}>
					<span aria-hidden='true'>←</span> {marketsCopy.allMarkets}
				</a>
			}
			title={market.title}
			titleRef={headingRef}
			titleAside={
				<>
					<FavoriteToggle app='trading' entityLabel={market.title} id={market.pool} kind='market' />
					<Badge tone={marketStatusTone(market, nowSeconds)}>{marketStatusLabel(market, nowSeconds)}</Badge>
				</>
			}
			actions={actions}
		/>
	)
}

/** The market page's reading column: conditional odds, the facts that decide a trade, the wallet's position, the question's own description, and contracts. */
export function MarketOverview({ market, position }: { market: LiveMarket; position: ComponentChildren }) {
	const yesTenths = marketYesTenths(market)
	const description = market.description.trim()
	const liquidity = formatMarketLiquidity(market)
	return (
		<div className='market-overview'>
			{yesTenths === undefined ? <UserMessage className='detail' detail={marketsCopy.oddsUnavailable} /> : <ProbabilityBar yesPercent={yesTenths / 10} />}
			<DataGrid className='market-facts'>
				<MetricField label={liveCopy.questionEnd}>
					<TimestampValue timestamp={market.endTime} relative={false} />
				</MetricField>
				{liquidity === undefined ? undefined : <MetricField label={marketsCopy.liquidity}>{liquidity}</MetricField>}
				<MetricField label={liveCopy.ammFee}>{formatScaledPercentage(market.feeBps, 2)}</MetricField>
			</DataGrid>
			{position}
			<section className='market-description' aria-labelledby='market-description-heading'>
				<h3 id='market-description-heading'>{marketsCopy.questionDescription}</h3>
				{/* Rendered as plain text: the description is creator-supplied and never interpreted as markup. */}
				{description === '' ? <UserMessage className='detail' detail={marketsCopy.noQuestionDescription} /> : <p className='market-description__text'>{description}</p>}
			</section>
			<MarketContracts market={market} />
		</div>
	)
}
