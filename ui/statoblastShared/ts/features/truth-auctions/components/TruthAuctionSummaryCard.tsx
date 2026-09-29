import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as forkAuctionCopy from '../../../copy/forkAuction.js'
import type { ComponentChildren } from 'preact'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { AUCTIONED_UNDERWRITING_LIMIT_ATTO_ETH_LABEL } from '../lib/forkAuction.js'

type TruthAuctionSummaryCardProps = {
	auctionedUnderwritingLimitAttoEthDisplay?: ComponentChildren | undefined
	badge: ComponentChildren
	clearingPriceDisplay: ComponentChildren
	displayedEthRaisedAttoEth: bigint
	displayedRepSoldAttoRep: bigint
	/** Bidding has closed, so the end time reads in the past tense. */
	ended: boolean
	endsDisplay: ComponentChildren
	attoEthRaiseCap: bigint
	ethRaisedProgress: number
	maxAttoRepBeingSold: bigint
	minBidSizeAttoEth: bigint
	pendingRefundDisplay: ComponentChildren | undefined
	progressDetail: string | undefined
	repSoldProgress: number
	reservePriceDisplay?: ComponentChildren | undefined
	startedDisplay: ComponentChildren
	winningThresholdPriceDisplay?: ComponentChildren | undefined
}

export function TruthAuctionSummaryCard({
	auctionedUnderwritingLimitAttoEthDisplay,
	badge,
	clearingPriceDisplay,
	displayedEthRaisedAttoEth,
	displayedRepSoldAttoRep,
	ended,
	endsDisplay,
	attoEthRaiseCap,
	ethRaisedProgress,
	maxAttoRepBeingSold,
	minBidSizeAttoEth,
	pendingRefundDisplay,
	progressDetail,
	repSoldProgress,
	reservePriceDisplay,
	startedDisplay,
	winningThresholdPriceDisplay,
}: TruthAuctionSummaryCardProps) {
	return (
		<SectionBlock badge={badge} className='fork-workflow-summary-card truth-auction-summary-card' title={commonCopy.truthAuction} variant='embedded'>
			<div className='fork-workflow-summary'>
				<div className='fork-workflow-summary-primary truth-auction-summary-primary'>
					<div className='fork-workflow-summary-stat-group truth-auction-progress-group'>
						<div className='fork-workflow-summary-stat-copy truth-auction-progress-copy'>
							<span>{forkAuctionCopy.attoEthRaised}</span>
							<strong>
								<CurrencyValue value={displayedEthRaisedAttoEth} suffix={commonCopy.eth} /> / <CurrencyValue value={attoEthRaiseCap} suffix={commonCopy.eth} />
							</strong>
						</div>
						<div className='truth-auction-progress-track'>
							<div className='truth-auction-progress-fill is-eth' style={{ width: `${ethRaisedProgress}%` }} />
						</div>
					</div>
					<div className='fork-workflow-summary-stat-group truth-auction-progress-group'>
						<div className='fork-workflow-summary-stat-copy truth-auction-progress-copy'>
							<span>{forkAuctionCopy.attoRepSold}</span>
							<strong>
								<CurrencyValue value={displayedRepSoldAttoRep} suffix={commonCopy.rep} /> / <CurrencyValue value={maxAttoRepBeingSold} suffix={commonCopy.rep} />
							</strong>
						</div>
						<div className='truth-auction-progress-track'>
							<div className='truth-auction-progress-fill is-rep' style={{ width: `${repSoldProgress}%` }} />
						</div>
					</div>
					{progressDetail === undefined ? undefined : <p className='detail'>{progressDetail}</p>}
				</div>
				<div className='fork-workflow-summary-metrics'>
					<MetricField label={forkAuctionCopy.started}>{startedDisplay}</MetricField>
					<MetricField label={ended ? forkAuctionCopy.ended : commonCopy.ends}>{endsDisplay}</MetricField>
					<MetricField label={forkAuctionCopy.clearingPrice}>{clearingPriceDisplay}</MetricField>
					<MetricField label={forkAuctionCopy.minBid}>{<CurrencyValue value={minBidSizeAttoEth} suffix={commonCopy.eth} />}</MetricField>
					{reservePriceDisplay === undefined ? undefined : <MetricField label={forkAuctionCopy.reservePrice}>{reservePriceDisplay}</MetricField>}
					{pendingRefundDisplay === undefined ? undefined : <MetricField label={forkAuctionCopy.pendingRefund}>{pendingRefundDisplay}</MetricField>}
					{winningThresholdPriceDisplay === undefined ? undefined : <MetricField label={forkAuctionCopy.winningThreshold}>{winningThresholdPriceDisplay}</MetricField>}
				</div>
			</div>
			{auctionedUnderwritingLimitAttoEthDisplay === undefined ? undefined : (
				<ReadOnlyDetailAccordion title={forkAuctionCopy.auctionDetails}>
					<MetricGrid>
						<MetricField label={AUCTIONED_UNDERWRITING_LIMIT_ATTO_ETH_LABEL}>{auctionedUnderwritingLimitAttoEthDisplay}</MetricField>
					</MetricGrid>
				</ReadOnlyDetailAccordion>
			)}
		</SectionBlock>
	)
}
