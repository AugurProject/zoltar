import * as commonCopy from '../../../copy/common.js'
import * as forkAuctionCopy from '../../../copy/forkAuction.js'
import type { ComponentChildren } from 'preact'
import { CurrencyValue } from '../../../components/CurrencyValue.js'
import { MetricField } from '../../../components/MetricField.js'
import { SectionBlock } from '../../../components/SectionBlock.js'
import { AUCTIONED_BOND_ALLOWANCE_LABEL } from '../lib/forkAuction.js'

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
		<SectionBlock badge={badge} className='fork-workflow-summary-card truth-auction-summary-card' title={commonCopy.truthAuction}>
			<div className='fork-workflow-summary'>
				<div className='fork-workflow-summary-primary truth-auction-summary-primary'>
					<div className='fork-workflow-summary-stat-group truth-auction-progress-group'>
						<div className='fork-workflow-summary-stat-copy truth-auction-progress-copy'>
							<span>{forkAuctionCopy.ethRaised}</span>
							<strong>
								<CurrencyValue value={displayedEthRaised} suffix={commonCopy.eth} /> / <CurrencyValue value={ethRaiseCap} suffix={commonCopy.eth} />
							</strong>
						</div>
						<div className='truth-auction-progress-track'>
							<div className='truth-auction-progress-fill is-eth' style={{ width: `${ethRaisedProgress}%` }} />
						</div>
					</div>
					<div className='fork-workflow-summary-stat-group truth-auction-progress-group'>
						<div className='fork-workflow-summary-stat-copy truth-auction-progress-copy'>
							<span>{forkAuctionCopy.repSold}</span>
							<strong>
								<CurrencyValue value={displayedRepSold} suffix={commonCopy.rep} /> / <CurrencyValue value={maxRepBeingSold} suffix={commonCopy.rep} />
							</strong>
						</div>
						<div className='truth-auction-progress-track'>
							<div className='truth-auction-progress-fill is-rep' style={{ width: `${repSoldProgress}%` }} />
						</div>
					</div>
				</div>
				<div className='fork-workflow-summary-metrics'>
					<MetricField label={commonCopy.starts}>{startedDisplay}</MetricField>
					<MetricField label={forkAuctionCopy.clearingPrice}>{clearingPriceDisplay}</MetricField>
					{auctionedBondAllowanceDisplay === undefined ? undefined : <MetricField label={AUCTIONED_BOND_ALLOWANCE_LABEL}>{auctionedBondAllowanceDisplay}</MetricField>}
					<MetricField label={forkAuctionCopy.minBid}>{<CurrencyValue value={minBidSize} suffix={commonCopy.eth} />}</MetricField>
					<MetricField label={commonCopy.ends}>{endsDisplay}</MetricField>
					{winningThresholdPriceDisplay === undefined ? undefined : <MetricField label={forkAuctionCopy.winningThreshold}>{winningThresholdPriceDisplay}</MetricField>}
				</div>
			</div>
		</SectionBlock>
	)
}
