import type { ComponentChildren } from 'preact'
import { CurrencyValue } from './CurrencyValue.js'
import { MetricField } from './MetricField.js'
import { SectionBlock } from './SectionBlock.js'
import { AUCTIONED_BOND_ALLOWANCE_LABEL } from '../lib/forkAuction.js'
import { TSX_STRINGS } from '../lib/uiStrings.js'

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
		<SectionBlock badge={badge} className='fork-workflow-summary-card truth-auction-summary-card' title={TSX_STRINGS.componentsTruthAuctionSummaryCard.copy001}>
			<div className='fork-workflow-summary'>
				<div className='fork-workflow-summary-primary truth-auction-summary-primary'>
					<div className='fork-workflow-summary-stat-group truth-auction-progress-group'>
						<div className='fork-workflow-summary-stat-copy truth-auction-progress-copy'>
							<span>{TSX_STRINGS.componentsTruthAuctionSummaryCard.copy002}</span>
							<strong>
								<CurrencyValue value={displayedEthRaised} suffix={TSX_STRINGS.componentsTruthAuctionSummaryCard.copy003} /> / <CurrencyValue value={ethRaiseCap} suffix={TSX_STRINGS.componentsTruthAuctionSummaryCard.copy004} />
							</strong>
						</div>
						<div className='truth-auction-progress-track'>
							<div className='truth-auction-progress-fill is-eth' style={{ width: `${ethRaisedProgress}%` }} />
						</div>
					</div>
					<div className='fork-workflow-summary-stat-group truth-auction-progress-group'>
						<div className='fork-workflow-summary-stat-copy truth-auction-progress-copy'>
							<span>{TSX_STRINGS.componentsTruthAuctionSummaryCard.copy005}</span>
							<strong>
								<CurrencyValue value={displayedRepSold} suffix={TSX_STRINGS.componentsTruthAuctionSummaryCard.copy006} /> / <CurrencyValue value={maxRepBeingSold} suffix={TSX_STRINGS.componentsTruthAuctionSummaryCard.copy007} />
							</strong>
						</div>
						<div className='truth-auction-progress-track'>
							<div className='truth-auction-progress-fill is-rep' style={{ width: `${repSoldProgress}%` }} />
						</div>
					</div>
				</div>
				<div className='fork-workflow-summary-metrics'>
					<MetricField label={TSX_STRINGS.componentsTruthAuctionSummaryCard.copy008}>{startedDisplay}</MetricField>
					<MetricField label={TSX_STRINGS.componentsTruthAuctionSummaryCard.copy009}>{clearingPriceDisplay}</MetricField>
					{auctionedBondAllowanceDisplay === undefined ? undefined : <MetricField label={AUCTIONED_BOND_ALLOWANCE_LABEL}>{auctionedBondAllowanceDisplay}</MetricField>}
					<MetricField label={TSX_STRINGS.componentsTruthAuctionSummaryCard.copy010}>{<CurrencyValue value={minBidSize} suffix={TSX_STRINGS.componentsTruthAuctionSummaryCard.copy011} />}</MetricField>
					<MetricField label={TSX_STRINGS.componentsTruthAuctionSummaryCard.copy012}>{endsDisplay}</MetricField>
					{winningThresholdPriceDisplay === undefined ? undefined : <MetricField label={TSX_STRINGS.componentsTruthAuctionSummaryCard.copy013}>{winningThresholdPriceDisplay}</MetricField>}
				</div>
			</div>
		</SectionBlock>
	)
}
