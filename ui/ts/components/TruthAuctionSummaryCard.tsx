import type { ComponentChildren } from 'preact'
import { CurrencyValue } from './CurrencyValue.js'
import { MetricField } from './MetricField.js'
import { SectionBlock } from './SectionBlock.js'

type TruthAuctionSummaryCardProps = {
	badge: ComponentChildren
	clearingPriceDisplay: ComponentChildren
	displayedEthRaised: bigint
	displayedRepSold: bigint
	endsDisplay: ComponentChildren
	ethRaiseCap: bigint
	ethRaisedProgress: number
	maxRepBeingSold: bigint
	minBidSize: bigint
	repSoldProgress: number
	startedDisplay: ComponentChildren
	winningThresholdPriceDisplay?: ComponentChildren | undefined
}

export function TruthAuctionSummaryCard({ badge, clearingPriceDisplay, displayedEthRaised, displayedRepSold, endsDisplay, ethRaiseCap, ethRaisedProgress, maxRepBeingSold, minBidSize, repSoldProgress, startedDisplay, winningThresholdPriceDisplay }: TruthAuctionSummaryCardProps) {
	return (
		<SectionBlock badge={badge} className='fork-workflow-summary-card truth-auction-summary-card' title='Truth Auction'>
			<div className='fork-workflow-summary'>
				<div className='fork-workflow-summary-primary truth-auction-summary-primary'>
					<div className='fork-workflow-summary-stat-group truth-auction-progress-group'>
						<div className='fork-workflow-summary-stat-copy truth-auction-progress-copy'>
							<span>ETH Raised</span>
							<strong>
								<CurrencyValue value={displayedEthRaised} suffix='ETH' /> / <CurrencyValue value={ethRaiseCap} suffix='ETH' />
							</strong>
						</div>
						<div className='truth-auction-progress-track'>
							<div className='truth-auction-progress-fill is-eth' style={{ width: `${ethRaisedProgress}%` }} />
						</div>
					</div>
					<div className='fork-workflow-summary-stat-group truth-auction-progress-group'>
						<div className='fork-workflow-summary-stat-copy truth-auction-progress-copy'>
							<span>REP Sold</span>
							<strong>
								<CurrencyValue value={displayedRepSold} suffix='REP' /> / <CurrencyValue value={maxRepBeingSold} suffix='REP' />
							</strong>
						</div>
						<div className='truth-auction-progress-track'>
							<div className='truth-auction-progress-fill is-rep' style={{ width: `${repSoldProgress}%` }} />
						</div>
					</div>
				</div>
				<div className='fork-workflow-summary-metrics'>
					<MetricField label='Starts'>{startedDisplay}</MetricField>
					<MetricField label='Clearing Price'>{clearingPriceDisplay}</MetricField>
					<MetricField label='Min Bid'>{<CurrencyValue value={minBidSize} suffix='ETH' />}</MetricField>
					<MetricField label='Ends'>{endsDisplay}</MetricField>
					{winningThresholdPriceDisplay === undefined ? undefined : <MetricField label='Winning Threshold'>{winningThresholdPriceDisplay}</MetricField>}
				</div>
			</div>
		</SectionBlock>
	)
}
