import type { ComponentChildren } from 'preact'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import * as statoblastAppCopy from '../../../copy/app.js'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { OpenOraclePriceValue } from '../../open-oracle/components/OpenOraclePriceValue.js'
import { getQuestionTitle, Question } from '@zoltar/ui-core-shared/components/Question.js'
import { SecurityPoolSummaryMetrics } from './SecurityPoolSummaryMetrics.js'
import { SecurityPoolLink } from './SecurityPoolLink.js'
import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { UpdatedAgo } from '@zoltar/ui-core-shared/components/UpdatedAgo.js'
import type { DataFreshness } from '@zoltar/ui-core-shared/lib/freshness.js'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { FavoriteToggle } from '@zoltar/ui-core-shared/components/FavoriteToggle.js'
import { PoolCapacitySummary } from './PoolCapacitySummary.js'
import * as copy from '../../../copy/poolWorkspace.js'
import { getSecurityPoolStatusBadgeLabel, getSecurityPoolStatusBadgeTone } from '../lib/securityPoolLabels.js'
import type { SecurityPoolLifecycleState } from '../lib/securityPoolState.js'
import type { ListedSecurityPool, MarketDetails, OracleManagerDetails, ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js'

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

/**
 * The pool's identity with its next actions beside it, then one strip of the figures that decide what can happen next:
 * collateral in use against capacity, the Open Oracle price, and the lifecycle stage.
 */
export function SecurityPoolObjectHeader(props: SecurityPoolObjectHeaderProps & { actions?: ComponentChildren; lifecycle?: ComponentChildren; oracleStatus?: ComponentChildren }) {
	const { actions, currentTimestamp, freshness, lifecycle, marketDetails, oracleStatus, selectedPoolHasActualForkActivity, selectedPoolLifecycleState, selectedPoolQuestionOutcome } = props
	const summaryPool = getSummaryPool(props)
	const capacity = summaryPool.totalUnderwritingLimitAttoEth
	const statusBadgeLabel = getSecurityPoolStatusBadgeLabel({ hasForkActivity: selectedPoolHasActualForkActivity, lifecycleState: selectedPoolLifecycleState, ...(selectedPoolQuestionOutcome === undefined ? {} : { questionOutcome: selectedPoolQuestionOutcome }) })
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
			<div className='pool-status-strip'>
				<PoolCapacitySummary showUnavailableReason={false} capacity={capacity} minted={summaryPool.settlementCollateralAttoEth} />
				{oracleStatus}
				{lifecycle}
			</div>
		</div>
	)
}

/** `showOraclePrice` is false while the page's price row already shows the Open Oracle price, so the details do not repeat it. */
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
							<SecurityPoolLink securityPoolAddress={summaryPool.parent} selectedPoolView={selectedPoolView} universeId={selectedPoolParentPool?.universeId} />
						</MetricField>
					)}
				</SecurityPoolSummaryMetrics>
			</ReadOnlyDetailAccordion>
		</div>
	)
}
