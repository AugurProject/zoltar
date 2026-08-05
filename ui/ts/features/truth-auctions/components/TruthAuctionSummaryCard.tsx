import * as commonCopy from '../../../copy/common.js'
import * as forkAuctionCopy from '../../../copy/forkAuction.js'
import type { ComponentChildren } from 'preact'
import { CurrencyValue } from '../../../components/CurrencyValue.js'
import { MetricField } from '../../../components/MetricField.js'
import { SectionBlock } from '../../../components/SectionBlock.js'
import { AUCTIONED_COVERAGE_COMMITMENT_ATTO_ETH_LABEL } from '../lib/forkAuction.js'

type TruthAuctionSummaryCardProps = {
	auctionedCoverageCommitmentAttoEthDisplay?: ComponentChildren | undefined
	badge: ComponentChildren
	clearingPriceDisplay: ComponentChildren
	displayedEthRaisedAttoEth: bigint
	displayedRepSoldAttoRep: bigint
	endsDisplay: ComponentChildren
	ethRaiseCapAttoEth: bigint
	ethRaisedProgress: number
	maxRepBeingSoldAttoRep: bigint
	minBidSizeAttoEth: bigint
	repSoldProgress: number
	startedDisplay: ComponentChildren
	winningThresholdPriceDisplay?: ComponentChildren | undefined
}

export function TruthAuctionSummaryCard({
	auctionedCoverageCommitmentAttoEthDisplay,
	badge,
	clearingPriceDisplay,
	displayedEthRaisedAttoEth,
	displayedRepSoldAttoRep,
	endsDisplay,
	ethRaiseCapAttoEth,
	ethRaisedProgress,
	maxRepBeingSoldAttoRep,
	minBidSizeAttoEth,
	repSoldProgress,
	startedDisplay,
	winningThresholdPriceDisplay,
}: TruthAuctionSummaryCardProps) {
	return (
		<SectionBlock badge={badge} className='fork-workflow-summary-card truth-auction-summary-card' title={commonCopy.truthAuction} variant='embedded'>
			<div className='fork-workflow-summary'>
				<div className='fork-workflow-summary-primary truth-auction-summary-primary'>
					<div className='fork-workflow-summary-stat-group truth-auction-progress-group'>
						<div className='fork-workflow-summary-stat-copy truth-auction-progress-copy'>
							<span>{forkAuctionCopy.ethRaisedAttoEth}</span>
							<strong>
								<CurrencyValue value={displayedEthRaisedAttoEth} suffix={commonCopy.eth} /> / <CurrencyValue value={ethRaiseCapAttoEth} suffix={commonCopy.eth} />
							</strong>
						</div>
						<div className='truth-auction-progress-track'>
							<div className='truth-auction-progress-fill is-eth' style={{ width: `${ethRaisedProgress}%` }} />
						</div>
					</div>
					<div className='fork-workflow-summary-stat-group truth-auction-progress-group'>
						<div className='fork-workflow-summary-stat-copy truth-auction-progress-copy'>
							<span>{forkAuctionCopy.repSoldAttoRep}</span>
							<strong>
								<CurrencyValue value={displayedRepSoldAttoRep} suffix={commonCopy.rep} /> / <CurrencyValue value={maxRepBeingSoldAttoRep} suffix={commonCopy.rep} />
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
					{auctionedCoverageCommitmentAttoEthDisplay === undefined ? undefined : <MetricField label={AUCTIONED_COVERAGE_COMMITMENT_ATTO_ETH_LABEL}>{auctionedCoverageCommitmentAttoEthDisplay}</MetricField>}
					<MetricField label={forkAuctionCopy.minBid}>{<CurrencyValue value={minBidSizeAttoEth} suffix={commonCopy.eth} />}</MetricField>
					<MetricField label={commonCopy.ends}>{endsDisplay}</MetricField>
					{winningThresholdPriceDisplay === undefined ? undefined : <MetricField label={forkAuctionCopy.winningThreshold}>{winningThresholdPriceDisplay}</MetricField>}
				</div>
			</div>
		</SectionBlock>
	)
}
