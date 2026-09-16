import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as statoblastAppCopy from '../../../copy/app.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { OpenOraclePriceValue } from '../../open-oracle/components/OpenOraclePriceValue.js'
import { getQuestionTitle, Question } from '@zoltar/ui-core-shared/components/Question.js'
import { SecurityPoolSummaryMetrics } from './SecurityPoolSummaryMetrics.js'
import { SecurityPoolLink } from './SecurityPoolLink.js'
import { StickyObjectContext } from '@zoltar/ui-core-shared/components/StickyObjectContext.js'
import { getSecurityPoolStatusBadgeLabel, getSecurityPoolStatusBadgeTone } from '../lib/securityPoolLabels.js'
import type { SecurityPoolLifecycleState } from '../lib/securityPoolState.js'
import { calculateMintingCapacityAttoEth, formatStatoblastSecurityMultiplier } from '../../markets/lib/trading.js'
import type { ListedSecurityPool, MarketDetails, OracleManagerDetails, ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js'

type SecurityPoolObjectHeaderProps = {
	calculationPriceConfigured: boolean
	currentPoolOracleManagerDetails: OracleManagerDetails | undefined
	currentPoolOraclePrice: bigint | undefined
	currentPoolOracleSettlementTimestamp: bigint | undefined
	currentTimestamp: bigint | undefined
	marketDetails: MarketDetails
	onViewPendingReport: (reportId: bigint) => void
	repPerEthPrice: bigint | undefined
	selectedPoolHasActualForkActivity: boolean
	selectedPoolLifecycleState: SecurityPoolLifecycleState | undefined
	selectedPoolParentPool: ListedSecurityPool | undefined
	selectedPoolQuestionOutcome: ReportingOutcomeKey | 'none' | undefined
	selectedPoolSummaryPool: ListedSecurityPool
	selectedPoolView: string
}

export function SecurityPoolObjectHeader({
	calculationPriceConfigured,
	currentPoolOracleManagerDetails,
	currentPoolOraclePrice,
	currentPoolOracleSettlementTimestamp,
	currentTimestamp,
	marketDetails,
	onViewPendingReport,
	repPerEthPrice,
	selectedPoolHasActualForkActivity,
	selectedPoolLifecycleState,
	selectedPoolParentPool,
	selectedPoolQuestionOutcome,
	selectedPoolSummaryPool,
	selectedPoolView,
}: SecurityPoolObjectHeaderProps) {
	const summaryPool = {
		...selectedPoolSummaryPool,
		lastOracleSettlementTimestamp: currentPoolOracleSettlementTimestamp ?? selectedPoolSummaryPool.lastOracleSettlementTimestamp,
	}
	const mintingCapacityAttoEth = calculateMintingCapacityAttoEth(summaryPool.totalCapacityOwnershipAttoRep, calculationPriceConfigured ? repPerEthPrice : summaryPool.lastOraclePrice, summaryPool.statoblastSecurityMultiplierBps)
	const statusBadgeLabel = getSecurityPoolStatusBadgeLabel({
		hasForkActivity: selectedPoolHasActualForkActivity,
		lifecycleState: selectedPoolLifecycleState,
		...(selectedPoolQuestionOutcome === undefined ? {} : { questionOutcome: selectedPoolQuestionOutcome }),
	})
	return (
		<div className='selected-pool-object-header'>
			<StickyObjectContext
				badge={
					<Badge ariaLabel={statusBadgeLabel} tone={getSecurityPoolStatusBadgeTone(selectedPoolLifecycleState)}>
						{statusBadgeLabel}
					</Badge>
				}
				items={[
					{ label: securityPoolCopy.vaultCount, value: summaryPool.vaultCount.toString() },
					{ label: statoblastAppCopy.statoblastSecurityMultiplierBps, value: `${formatStatoblastSecurityMultiplier(summaryPool.statoblastSecurityMultiplierBps)}x` },
					{
						label: statoblastAppCopy.openOraclePrice,
						value: <OpenOraclePriceValue currentTimestamp={currentTimestamp} lastPrice={currentPoolOraclePrice} lastSettlementTimestamp={currentPoolOracleSettlementTimestamp ?? 0n} priceValidUntilTimestamp={currentPoolOracleManagerDetails?.priceValidUntilTimestamp} />,
					},
					{
						label: securityPoolCopy.openInterestMinted,
						value: (
							<span className='comparison-record-value-stack'>
								<CurrencyValue exactWhenRoundedToZero value={summaryPool.settlementCollateralAttoEth} suffix={commonCopy.eth} copyable={false} />
								<span className='detail'>
									{securityPoolCopy.maxLead}
									{mintingCapacityAttoEth === undefined ? commonCopy.unavailable : <CurrencyValue exactWhenRoundedToZero value={mintingCapacityAttoEth} suffix={commonCopy.eth} copyable={false} />}
								</span>
							</span>
						),
					},
				]}
				sticky={false}
				title={getQuestionTitle(marketDetails)}
				variant='embedded-context-strip'
			>
				<Question className='selected-pool-hero-question' question={marketDetails} variant='preview' showTitle={false} />
				<SecurityPoolSummaryMetrics calculationPriceConfigured={calculationPriceConfigured} calculationRepPerEthPrice={repPerEthPrice} className='selected-pool-context-grid' metricVariant='context' omitHeadlineMetrics pool={summaryPool} showTotalBacking>
					{summaryPool.parent === zeroAddress ? undefined : (
						<MetricField label={securityPoolCopy.parentPool}>
							<SecurityPoolLink securityPoolAddress={summaryPool.parent} selectedPoolView={selectedPoolView} universeId={selectedPoolParentPool?.universeId} />
						</MetricField>
					)}
					{currentPoolOracleManagerDetails?.pendingReportId === undefined || currentPoolOracleManagerDetails.pendingReportId === 0n ? undefined : (
						<MetricField label={securityPoolCopy.pendingRequest}>
							<button className='link' type='button' onClick={() => onViewPendingReport(currentPoolOracleManagerDetails.pendingReportId)}>
								{securityPoolCopy.formatPendingReportLabel(currentPoolOracleManagerDetails.pendingReportId.toString())}
							</button>
						</MetricField>
					)}
				</SecurityPoolSummaryMetrics>
			</StickyObjectContext>
		</div>
	)
}
