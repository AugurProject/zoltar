import type { ComponentChildren } from 'preact'
import { CurrencyValue } from './CurrencyValue.js'
import { MetricField } from './MetricField.js'
import { SectionBlock } from './SectionBlock.js'
import { AUCTIONED_BOND_ALLOWANCE_LABEL } from '../lib/forkAuction.js'
import { UI_STRING_CLEARING_PRICE, UI_STRING_ENDS, UI_STRING_ETH, UI_STRING_ETH_RAISED, UI_STRING_MIN_BID, UI_STRING_REP, UI_STRING_REP_SOLD, UI_STRING_STARTS, UI_STRING_TRUTH_AUCTION, UI_STRING_WINNING_THRESHOLD } from '../lib/uiStrings.js'

type TruthAuctionSummaryCardProps = {
	auctionedBondAllowanceDisplay?: ComponentChildren | undefined
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

export function TruthAuctionSummaryCard({ auctionedBondAllowanceDisplay, badge, clearingPriceDisplay, displayedEthRaised, displayedRepSold, endsDisplay, ethRaiseCap, ethRaisedProgress, maxRepBeingSold, minBidSize, repSoldProgress, startedDisplay, winningThresholdPriceDisplay }: TruthAuctionSummaryCardProps) {
	return (
		<SectionBlock badge={badge} className='fork-workflow-summary-card truth-auction-summary-card' title={UI_STRING_TRUTH_AUCTION}>
			<div className='fork-workflow-summary'>
				<div className='fork-workflow-summary-primary truth-auction-summary-primary'>
					<div className='fork-workflow-summary-stat-group truth-auction-progress-group'>
						<div className='fork-workflow-summary-stat-copy truth-auction-progress-copy'>
							<span>{UI_STRING_ETH_RAISED}</span>
							<strong>
								<CurrencyValue value={displayedEthRaised} suffix={UI_STRING_ETH} /> / <CurrencyValue value={ethRaiseCap} suffix={UI_STRING_ETH} />
							</strong>
						</div>
						<div className='truth-auction-progress-track'>
							<div className='truth-auction-progress-fill is-eth' style={{ width: `${ethRaisedProgress}%` }} />
						</div>
					</div>
					<div className='fork-workflow-summary-stat-group truth-auction-progress-group'>
						<div className='fork-workflow-summary-stat-copy truth-auction-progress-copy'>
							<span>{UI_STRING_REP_SOLD}</span>
							<strong>
								<CurrencyValue value={displayedRepSold} suffix={UI_STRING_REP} /> / <CurrencyValue value={maxRepBeingSold} suffix={UI_STRING_REP} />
							</strong>
						</div>
						<div className='truth-auction-progress-track'>
							<div className='truth-auction-progress-fill is-rep' style={{ width: `${repSoldProgress}%` }} />
						</div>
					</div>
				</div>
				<div className='fork-workflow-summary-metrics'>
					<MetricField label={UI_STRING_STARTS}>{startedDisplay}</MetricField>
					<MetricField label={UI_STRING_CLEARING_PRICE}>{clearingPriceDisplay}</MetricField>
					{auctionedBondAllowanceDisplay === undefined ? undefined : <MetricField label={AUCTIONED_BOND_ALLOWANCE_LABEL}>{auctionedBondAllowanceDisplay}</MetricField>}
					<MetricField label={UI_STRING_MIN_BID}>{<CurrencyValue value={minBidSize} suffix={UI_STRING_ETH} />}</MetricField>
					<MetricField label={UI_STRING_ENDS}>{endsDisplay}</MetricField>
					{winningThresholdPriceDisplay === undefined ? undefined : <MetricField label={UI_STRING_WINNING_THRESHOLD}>{winningThresholdPriceDisplay}</MetricField>}
				</div>
			</div>
		</SectionBlock>
	)
}
