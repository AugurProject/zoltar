import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as statoblastAppCopy from '../../../copy/app.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { OpenOraclePriceValue } from '../../open-oracle/components/OpenOraclePriceValue.js'
import { getQuestionTitle, Question } from '@zoltar/ui-core-shared/components/Question.js'
import { SecurityPoolSummaryMetrics } from './SecurityPoolSummaryMetrics.js'
import { SecurityPoolLink } from './SecurityPoolLink.js'
import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { PoolCapacitySummary } from './PoolCapacitySummary.js'
import * as copy from '../../../copy/poolWorkspace.js'
import { getOracleManagerPriceValidUntilTimestamp } from '../../../protocol/oracleTiming.js'
import { getSecurityPoolStatusBadgeLabel, getSecurityPoolStatusBadgeTone } from '../lib/securityPoolLabels.js'
import type { SecurityPoolLifecycleState } from '../lib/securityPoolState.js'
import { calculateMintingCapacityAttoEth } from '../../markets/lib/trading.js'
import type { ListedSecurityPool, MarketDetails, OracleManagerDetails, ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js'

type SecurityPoolObjectHeaderProps = {
	calculationPriceConfigured: boolean
	currentPoolOracleManagerDetails: OracleManagerDetails | undefined
	currentPoolOraclePrice: bigint | undefined
	currentPoolOracleSettlementTimestamp: bigint | undefined
	currentTimestamp: bigint | undefined
	marketDetails: MarketDetails
	repPerEthPrice: bigint | undefined
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

function getSummaryCalculationPrice(props: SecurityPoolObjectHeaderProps) {
	if (props.calculationPriceConfigured) return props.repPerEthPrice
	const pool = getSummaryPool(props)
	const validUntil = getOracleManagerPriceValidUntilTimestamp(pool.lastOracleSettlementTimestamp)
	return props.currentTimestamp !== undefined && validUntil !== undefined && props.currentTimestamp < validUntil ? (props.currentPoolOraclePrice ?? pool.lastOraclePrice) : undefined
}

export function SecurityPoolObjectHeader(props: SecurityPoolObjectHeaderProps) {
	const { currentTimestamp, marketDetails, selectedPoolHasActualForkActivity, selectedPoolLifecycleState, selectedPoolQuestionOutcome } = props
	const summaryPool = getSummaryPool(props)
	const capacity = calculateMintingCapacityAttoEth(summaryPool.totalCapacityOwnershipAttoRep, getSummaryCalculationPrice(props), summaryPool.statoblastSecurityMultiplierBps)
	const statusBadgeLabel = getSecurityPoolStatusBadgeLabel({ hasForkActivity: selectedPoolHasActualForkActivity, lifecycleState: selectedPoolLifecycleState, ...(selectedPoolQuestionOutcome === undefined ? {} : { questionOutcome: selectedPoolQuestionOutcome }) })
	return (
		<div className='selected-pool-object-header pool-overview-header'>
			<div className='pool-object-identity'>
				<h2>{getQuestionTitle(marketDetails)}</h2>
				<div className='pool-object-meta'>
					<Badge ariaLabel={statusBadgeLabel} tone={getSecurityPoolStatusBadgeTone(selectedPoolLifecycleState)}>
						{statusBadgeLabel}
					</Badge>
					<p className='pool-deadline'>
						<span>{currentTimestamp !== undefined && currentTimestamp >= marketDetails.endTime ? securityPoolCopy.ended : commonCopy.ends}</span> <TimestampValue timestamp={marketDetails.endTime} {...(currentTimestamp === undefined ? {} : { currentTimestamp })} />
					</p>
				</div>
			</div>

			<PoolCapacitySummary showUnavailableReason={false} capacity={capacity} minted={summaryPool.settlementCollateralAttoEth} />
		</div>
	)
}

export function SecurityPoolReferenceDetails(props: SecurityPoolObjectHeaderProps) {
	const { currentPoolOracleManagerDetails, currentPoolOraclePrice, currentPoolOracleSettlementTimestamp, currentTimestamp, marketDetails, selectedPoolParentPool, selectedPoolView } = props
	const summaryPool = getSummaryPool(props)
	return (
		<div className='pool-reference-details'>
			<ReadOnlyDetailAccordion title={copy.poolDetails}>
				<Question question={marketDetails} variant='preview' showTitle={false} />
				<SecurityPoolSummaryMetrics calculationPriceConfigured calculationRepPerEthPrice={getSummaryCalculationPrice(props)} metricVariant='context' pool={summaryPool} omitCapacity showTotalBacking>
					<MetricField label={securityPoolCopy.managerAddress}>
						<AddressValue address={summaryPool.managerAddress} />
					</MetricField>
					<MetricField label={statoblastAppCopy.openOraclePrice}>
						<OpenOraclePriceValue
							currentTimestamp={currentTimestamp}
							lastPrice={currentPoolOraclePrice}
							lastSettlementTimestamp={currentPoolOracleSettlementTimestamp ?? 0n}
							pendingReportReadyAtTimestamp={currentPoolOracleManagerDetails?.pendingReportReadyAtTimestamp}
							priceValidUntilTimestamp={currentPoolOracleManagerDetails?.priceValidUntilTimestamp}
						/>
					</MetricField>
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
