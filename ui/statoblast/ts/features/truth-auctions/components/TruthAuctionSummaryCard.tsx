import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as forkAuctionCopy from '@zoltar/ui-zoltar/copy/forkAuction.js'
import type { ComponentChildren } from 'preact'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL } from '../lib/forkAuction.js'

type TruthAuctionSummaryCardProps = {
	auctionedCapacityOwnershipAttoRepDisplay?: ComponentChildren | undefined
	badge: ComponentChildren
	clearingPriceDisplay: ComponentChildren
	displayedEthRaisedAttoEth: bigint
	displayedRepSoldAttoRep: bigint
	endsDisplay: ComponentChildren
	attoEthRaiseCap: bigint
	ethRaisedProgress: number
	maxAttoRepBeingSold: bigint
	minBidSizeAttoEth: bigint
	repSoldProgress: number
	startedDisplay: ComponentChildren
	winningThresholdPriceDisplay?: ComponentChildren | undefined
}

export function TruthAuctionSummaryCard({
	auctionedCapacityOwnershipAttoRepDisplay,
	badge,
	clearingPriceDisplay,
	displayedEthRaisedAttoEth,
	displayedRepSoldAttoRep,
	endsDisplay,
	attoEthRaiseCap,
	ethRaisedProgress,
	maxAttoRepBeingSold,
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
				</div>
				<div className='fork-workflow-summary-metrics'>
					<MetricField label={commonCopy.starts}>{startedDisplay}</MetricField>
					<MetricField label={forkAuctionCopy.clearingPrice}>{clearingPriceDisplay}</MetricField>
					{auctionedCapacityOwnershipAttoRepDisplay === undefined ? undefined : <MetricField label={AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL}>{auctionedCapacityOwnershipAttoRepDisplay}</MetricField>}
					<MetricField label={forkAuctionCopy.minBid}>{<CurrencyValue value={minBidSizeAttoEth} suffix={commonCopy.eth} />}</MetricField>
					<MetricField label={commonCopy.ends}>{endsDisplay}</MetricField>
					{winningThresholdPriceDisplay === undefined ? undefined : <MetricField label={forkAuctionCopy.winningThreshold}>{winningThresholdPriceDisplay}</MetricField>}
				</div>
			</div>
		</SectionBlock>
	)
}
