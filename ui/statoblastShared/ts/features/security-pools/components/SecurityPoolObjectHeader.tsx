import type { ComponentChildren } from 'preact'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import * as statoblastAppCopy from '../../../copy/app.js'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { OpenOraclePriceValue } from '../../open-oracle/components/OpenOraclePriceValue.js'
import { getQuestionTitle, Question } from '@zoltar/ui-core-shared/components/Question.js'
import { SecurityPoolSummaryMetrics } from './SecurityPoolSummaryMetrics.js'
import { StatoblastSecurityPoolLink } from './StatoblastSecurityPoolLink.js'
import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { UpdatedAgo } from '@zoltar/ui-core-shared/components/UpdatedAgo.js'
import type { DataFreshness } from '@zoltar/ui-core-shared/lib/freshness.js'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { FavoriteToggle } from '@zoltar/ui-core-shared/components/FavoriteToggle.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { AmountOfLimit, formatPercentOfLimit, PoolCapacitySummary } from './PoolCapacitySummary.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { ProgressMeter } from '@zoltar/ui-core-shared/components/ProgressMeter.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { formatRelativeTimestamp, getWallClockTimestamp } from '@zoltar/ui-core-shared/lib/formatters.js'
import * as forkAuctionCopy from '../../../copy/forkAuction.js'
import { getReportingOutcomeLabel } from '../../reporting/lib/reporting.js'
import { getFinalizedTruthAuctionRaisedAttoEth } from '../../truth-auctions/lib/truthAuctionBook.js'
import { hasTruthAuctionEnded, isMigrationClosed } from '../../truth-auctions/lib/forkAuction.js'
import { getPoolStripStage, type PoolForkTimeline } from '../lib/poolStrip.js'
import { useChainTimestamp } from '@zoltar/ui-core-shared/wallet/chainTimestamp.js'
import { getPoolRemainingMintCapacity } from '../../markets/lib/trading.js'
import * as copy from '../../../copy/poolWorkspace.js'
import { getSecurityPoolStatusBadgeLabel, getSecurityPoolStatusBadgeTone } from '../lib/securityPoolLabels.js'
import type { SecurityPoolLifecycleState } from '../lib/securityPoolState.js'
import { isMintingPausedByEscalation } from '../lib/poolLifecycle.js'
import type { MarketDetails, ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js'
import type { ListedSecurityPool, OracleManagerDetails, TruthAuctionMetrics } from '../../../types/contracts.js'

type SecurityPoolObjectHeaderProps = {
	currentPoolOracleManagerDetails: OracleManagerDetails | undefined
	currentPoolOraclePrice: bigint | undefined
	currentPoolOracleSettlementTimestamp: bigint | undefined
	currentTimestamp: bigint | undefined
	/** The pool summary's age; it refreshes in place on each new block. */
	freshness?: DataFreshness | undefined
	marketDetails: MarketDetails
	selectedPoolHasActualForkActivity: boolean
	selectedPoolLifecycleState: SecurityPoolLifecycleState | undefined
	selectedPoolParentPool: ListedSecurityPool | undefined
	selectedPoolQuestionOutcome: ReportingOutcomeKey | 'none' | undefined
	selectedPoolSummaryPool: ListedSecurityPool
	selectedPoolView: string
}

function getSummaryPool(props: SecurityPoolObjectHeaderProps) {
	return { ...props.selectedPoolSummaryPool, lastOraclePrice: props.currentPoolOraclePrice ?? props.selectedPoolSummaryPool.lastOraclePrice, lastOracleSettlementTimestamp: props.currentPoolOracleSettlementTimestamp ?? props.selectedPoolSummaryPool.lastOracleSettlementTimestamp }
}

function PoolStripFigure({ detail, label, textValue = false, value }: { detail?: ComponentChildren; label: string; textValue?: boolean; value: ComponentChildren }) {
	return (
		<div className='pool-strip-figure'>
			<span className='metric-label'>{label}</span>
			<strong className={textValue ? 'pool-strip-figure-value is-text' : 'pool-strip-figure-value'}>{value}</strong>
			{detail === undefined ? undefined : <span className='pool-strip-figure-detail'>{detail}</span>}
		</div>
	)
}

/**
 * A deadline leads with how far away it is, or how long ago it passed; the UTC time follows quietly. While the fork
 * details are being read the tile holds its place with a loading value; a deadline that stays unknown, including after
 * a failed read, is left out rather than shown as a placeholder.
 */
function PoolDeadlineFigure({ currentTimestamp, hasEnded, labels, loading, timestamp }: { currentTimestamp: bigint | undefined; hasEnded: (now: bigint, deadline: bigint) => boolean; labels: { ended: string; upcoming: string }; loading: boolean; timestamp: bigint | undefined }) {
	const chainTimestamp = useChainTimestamp()
	const known = timestamp !== undefined && timestamp !== 0n
	if (!known) return loading ? <PoolStripFigure label={labels.upcoming} value={<LoadingText announce={false} />} /> : undefined
	const now = currentTimestamp ?? chainTimestamp ?? getWallClockTimestamp()
	return <PoolStripFigure label={hasEnded(now, timestamp) ? labels.ended : labels.upcoming} value={formatRelativeTimestamp(timestamp, now)} detail={<TimestampValue timestamp={timestamp} relative={false} />} />
}

function SettlementCollateralFigure({ pool }: { pool: ListedSecurityPool }) {
	return <PoolStripFigure label={forkAuctionCopy.settlementCollateral} value={<CurrencyValue value={pool.settlementCollateralAttoEth} suffix={commonCopy.eth} exactWhenRoundedToZero />} />
}

function getTruthAuctionProgressDetail(auction: TruthAuctionMetrics, amountAttoEth: bigint) {
	if (auction.hitCap) return forkAuctionCopy.targetReached
	const percent = formatPercentOfLimit(amountAttoEth, auction.attoEthRaiseCap)
	return percent === undefined ? undefined : copy.formatShareOfTarget(percent)
}

/** What the auction raises against its target: the clearing amount, capped at the target, until it finalizes, then what it raised. */
function TruthAuctionProgressFigure({ auction }: { auction: TruthAuctionMetrics }) {
	const amountAttoEth = auction.finalized ? getFinalizedTruthAuctionRaisedAttoEth(auction) : auction.accumulatedBidAttoEth
	return (
		<div className='pool-meter is-prominent pool-auction-progress'>
			<ProgressMeter label={forkAuctionCopy.attoEthRaised} maxValue={auction.attoEthRaiseCap} value={amountAttoEth} valueText={<AmountOfLimit amount={amountAttoEth} limit={auction.attoEthRaiseCap} />} detail={getTruthAuctionProgressDetail(auction, amountAttoEth)} />
		</div>
	)
}

/** While the fork details are being read, the auction tile holds its place; without auction metrics, settlement collateral leads instead. */
function TruthAuctionLeadFigure({ forkTimeline, pool }: { forkTimeline: PoolForkTimeline; pool: ListedSecurityPool }) {
	if (forkTimeline.truthAuction !== undefined) return <TruthAuctionProgressFigure auction={forkTimeline.truthAuction} />
	if (forkTimeline.loading) return <PoolStripFigure label={forkAuctionCopy.attoEthRaised} value={<LoadingText announce={false} />} />
	return <SettlementCollateralFigure pool={pool} />
}

/**
 * The strip's leading figures follow the pool's stage: an operating pool shows collateral in use against capacity; a
 * forked pool shows its settlement collateral and the migration or auction deadline; an ended pool shows its outcome.
 */
function PoolStageFigures({ currentTimestamp, forkTimeline, lifecycleState, pool, questionOutcome }: { currentTimestamp: bigint | undefined; forkTimeline: PoolForkTimeline; lifecycleState: SecurityPoolLifecycleState | undefined; pool: ListedSecurityPool; questionOutcome: ReportingOutcomeKey | 'none' | undefined }) {
	const stripStage = getPoolStripStage(lifecycleState)
	switch (stripStage) {
		case 'ended':
			return (
				<>
					{questionOutcome === undefined || questionOutcome === 'none' ? undefined : <PoolStripFigure label={commonCopy.outcome} textValue value={getReportingOutcomeLabel(questionOutcome)} />}
					<SettlementCollateralFigure pool={pool} />
				</>
			)
		case 'migration':
			return (
				<>
					<SettlementCollateralFigure pool={pool} />
					<PoolDeadlineFigure currentTimestamp={currentTimestamp} hasEnded={isMigrationClosed} labels={{ ended: forkAuctionCopy.migrationEnded, upcoming: forkAuctionCopy.migrationEnds }} loading={forkTimeline.loading} timestamp={forkTimeline.migrationEndsAt} />
				</>
			)
		case 'auction':
			return (
				<>
					<TruthAuctionLeadFigure forkTimeline={forkTimeline} pool={pool} />
					<PoolDeadlineFigure currentTimestamp={currentTimestamp} hasEnded={hasTruthAuctionEnded} labels={{ ended: forkAuctionCopy.auctionEnded, upcoming: forkAuctionCopy.auctionEnds }} loading={forkTimeline.loading} timestamp={forkTimeline.auctionEndsAt} />
				</>
			)
		case 'operating':
			return <PoolCapacitySummary showUnavailableReason={false} capacity={pool.totalUnderwritingLimitAttoEth} minted={pool.settlementCollateralAttoEth} mintingPaused={isMintingPausedByEscalation(pool, lifecycleState)} remainingCapacity={getPoolRemainingMintCapacity(pool)} showUsage />
		default:
			return assertNever(stripStage)
	}
}

/**
 * The pool's identity with its next actions beside it, then one strip of the figures that decide what can happen next:
 * the stage's leading figures (see `PoolStageFigures`), the OpenOracle price while a pool action reads it, and the lifecycle stage.
 */
export function SecurityPoolObjectHeader(props: SecurityPoolObjectHeaderProps & { actions?: ComponentChildren; forkTimeline: PoolForkTimeline; lifecycle?: ComponentChildren; oracleStatus?: ComponentChildren; showStageFigures: boolean }) {
	const { actions, currentTimestamp, forkTimeline, freshness, lifecycle, marketDetails, oracleStatus, selectedPoolHasActualForkActivity, selectedPoolLifecycleState, selectedPoolQuestionOutcome, showStageFigures } = props
	const summaryPool = getSummaryPool(props)
	// An ended pool's strip leads with its outcome, so the badge names the outcome only when the strip's figures are hidden.
	const badgeQuestionOutcome = showStageFigures ? undefined : selectedPoolQuestionOutcome
	const statusBadgeLabel = getSecurityPoolStatusBadgeLabel({ hasForkActivity: selectedPoolHasActualForkActivity, lifecycleState: selectedPoolLifecycleState, ...(badgeQuestionOutcome === undefined ? {} : { questionOutcome: badgeQuestionOutcome }) })
	return (
		<div className='selected-pool-object-header pool-overview-header'>
			<div className='pool-overview-title-row'>
				<div className='pool-object-identity'>
					<div className='pool-object-title'>
						<FavoriteToggle app='statoblast' entityLabel={getQuestionTitle(marketDetails)} id={summaryPool.securityPoolAddress} kind='pool' />
						<h2>{getQuestionTitle(marketDetails)}</h2>
					</div>
					<div className='pool-object-meta'>
						<Badge ariaLabel={statusBadgeLabel} tone={getSecurityPoolStatusBadgeTone(selectedPoolLifecycleState)}>
							{statusBadgeLabel}
						</Badge>
						<p className='pool-deadline'>
							<span>{currentTimestamp !== undefined && currentTimestamp >= marketDetails.endTime ? securityPoolCopy.questionEnded : securityPoolCopy.questionEnds}</span> <TimestampValue timestamp={marketDetails.endTime} {...(currentTimestamp === undefined ? {} : { currentTimestamp })} />
						</p>
						{freshness === undefined ? undefined : <UpdatedAgo {...freshness} />}
					</div>
				</div>
				{actions}
			</div>
			{/* A pool from another universe shows no stage figures until the app switches to it, so the strip never shows empty placeholders; its price status, such as a pending report, stays reachable. */}
			{!showStageFigures && oracleStatus === undefined && lifecycle === undefined ? undefined : (
				<div className='pool-status-strip'>
					{showStageFigures ? <PoolStageFigures currentTimestamp={currentTimestamp} forkTimeline={forkTimeline} lifecycleState={selectedPoolLifecycleState} pool={summaryPool} questionOutcome={selectedPoolQuestionOutcome} /> : undefined}
					{oracleStatus}
					{lifecycle}
				</div>
			)}
		</div>
	)
}

/** `showOraclePrice` is false while the page's price row already shows the OpenOracle price, so the details do not repeat it, and in ended or forked pools, where no action reads the price. */
export function SecurityPoolReferenceDetails(props: SecurityPoolObjectHeaderProps & { showOraclePrice: boolean }) {
	const { currentPoolOracleManagerDetails, currentPoolOraclePrice, currentPoolOracleSettlementTimestamp, currentTimestamp, marketDetails, selectedPoolParentPool, selectedPoolView, showOraclePrice } = props
	const summaryPool = getSummaryPool(props)
	return (
		<div className='pool-reference-details'>
			<ReadOnlyDetailAccordion title={copy.poolDetails}>
				<Question question={marketDetails} variant='preview' showTitle={false} />
				<SecurityPoolSummaryMetrics metricVariant='context' pool={summaryPool} showTotalBacking>
					<MetricField label={securityPoolCopy.managerAddress}>
						<AddressValue address={summaryPool.managerAddress} />
					</MetricField>
					{showOraclePrice ? (
						<MetricField label={statoblastAppCopy.openOraclePrice}>
							<OpenOraclePriceValue
								currentTimestamp={currentTimestamp}
								lastPrice={currentPoolOraclePrice}
								lastSettlementTimestamp={currentPoolOracleSettlementTimestamp ?? 0n}
								pendingReportReadyAtTimestamp={currentPoolOracleManagerDetails?.pendingReportReadyAtTimestamp}
								priceValidUntilTimestamp={currentPoolOracleManagerDetails?.priceValidUntilTimestamp}
							/>
						</MetricField>
					) : undefined}
					{summaryPool.parent === zeroAddress ? undefined : (
						<MetricField label={securityPoolCopy.parentPool}>
							<StatoblastSecurityPoolLink securityPoolAddress={summaryPool.parent} selectedPoolView={selectedPoolView} universeId={selectedPoolParentPool?.universeId} />
						</MetricField>
					)}
				</SecurityPoolSummaryMetrics>
			</ReadOnlyDetailAccordion>
		</div>
	)
}

/** Holds the object header's shape while the pool first loads, so the loaded header replaces it in place instead of moving the page. */
export function SecurityPoolObjectHeaderSkeleton() {
	return (
		<div className='selected-pool-object-header pool-overview-header pool-object-header-skeleton'>
			<div className='pool-overview-title-row'>
				<div className='pool-object-identity'>
					<span className='skeleton-line skeleton-line-title' aria-hidden='true' />
					<LoadingText>{securityPoolCopy.loadingPool}</LoadingText>
				</div>
			</div>
			<div className='pool-status-strip' aria-hidden='true'>
				{['capacity', 'oracle', 'stage'].map(slot => (
					<div key={slot} className='pool-object-header-skeleton-slot'>
						<span className='skeleton-line skeleton-line-detail' />
						<span className='skeleton-line skeleton-line-title' />
					</div>
				))}
			</div>
		</div>
	)
}
