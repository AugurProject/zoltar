import type { RefObject } from 'preact'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { ReadOnlyAddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js'
import { StickyObjectContext } from '@zoltar/ui-core-shared/components/StickyObjectContext.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { formatTrimmedUnits } from '@zoltar/ui-core-shared/lib/formatters.js'
import { ProbabilityBar } from '../components/ProbabilityBar.js'
import { SecurityPoolLink } from '../components/SecurityPoolLink.js'
import { liveCopy } from '../copy/live.js'
import { marketsCopy } from '../copy/markets.js'
import { marketYesTenths } from '../lib/marketListing.js'
import type { LiveMarket } from '../protocol/live.js'
import { formatMarketLiquidity } from './MarketCard.js'
import { marketStatusLabel, marketStatusTone } from './marketStatus.js'

/** Question, status, and the facts that decide a trade: when the question ends, how deep the pair is, and its fee. The market page moves the pool into its contracts disclosure. */
export function MarketFacts({ market, nowSeconds, workflowLocked, headingRef, showPool = true }: { market: LiveMarket; nowSeconds: bigint; workflowLocked: boolean; headingRef: RefObject<HTMLHeadingElement>; showPool?: boolean }) {
	const liquidity = formatMarketLiquidity(market)
	return (
		<StickyObjectContext
			variant='embedded-context-strip'
			sticky={false}
			title={market.title}
			titleRef={headingRef}
			badge={<Badge tone={marketStatusTone(market, nowSeconds)}>{marketStatusLabel(market, nowSeconds)}</Badge>}
			items={[
				...(showPool ? [{ label: liveCopy.securityPoolLabel, value: <SecurityPoolLink value={market.pool} disabled={workflowLocked} /> }] : []),
				...(market.loadError === undefined
					? [{ label: liveCopy.questionEnd, value: <TimestampValue timestamp={market.endTime} relative={false} /> }, ...(liquidity === undefined ? [] : [{ label: marketsCopy.liquidity, value: liquidity }]), { label: liveCopy.ammFee, value: `${formatTrimmedUnits(market.feeBps, 2, 2)}%` }]
					: []),
			]}
		/>
	)
}

/** Contract addresses stay reachable for verification without competing with the question for attention. */
export function MarketContracts({ market, workflowLocked }: { market: LiveMarket; workflowLocked: boolean }) {
	return (
		<ReadOnlyDetailAccordion title={marketsCopy.contracts}>
			<DataGrid dense>
				<MetricField label={liveCopy.securityPoolLabel}>
					<SecurityPoolLink value={market.pool} disabled={workflowLocked} />
				</MetricField>
				<MetricField label={liveCopy.pair}>{market.pair === undefined ? liveCopy.notDeployed : <ReadOnlyAddressValue address={market.pair} responsiveAbbreviation />}</MetricField>
				<MetricField label={marketsCopy.shareToken}>
					<ReadOnlyAddressValue address={market.shareToken} responsiveAbbreviation />
				</MetricField>
			</DataGrid>
		</ReadOnlyDetailAccordion>
	)
}

/** The market page's reading column: question and facts, conditional odds, the question's own description, and contracts. */
export function MarketOverview({ market, nowSeconds, workflowLocked, headingRef }: { market: LiveMarket; nowSeconds: bigint; workflowLocked: boolean; headingRef: RefObject<HTMLHeadingElement> }) {
	const yesTenths = marketYesTenths(market)
	const description = market.description.trim()
	return (
		<div className='market-overview'>
			<MarketFacts market={market} nowSeconds={nowSeconds} workflowLocked={workflowLocked} headingRef={headingRef} showPool={false} />
			{yesTenths === undefined ? <p className='detail'>{marketsCopy.oddsUnavailable}</p> : <ProbabilityBar yesPercent={yesTenths / 10} />}
			<section className='market-description' aria-labelledby='market-description-heading'>
				<h4 id='market-description-heading'>{marketsCopy.questionDescription}</h4>
				{/* Rendered as plain text: the description is creator-supplied and never interpreted as markup. */}
				{description === '' ? <p className='detail'>{marketsCopy.noQuestionDescription}</p> : <p className='market-description__text'>{description}</p>}
			</section>
			<MarketContracts market={market} workflowLocked={workflowLocked} />
		</div>
	)
}
