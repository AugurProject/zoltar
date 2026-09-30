import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as statoblastAppCopy from '../../../copy/app.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import type { ComponentChildren } from 'preact'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { formatTrimmedUnits, formatValueWithUnit } from '@zoltar/ui-core-shared/lib/formatters.js'
import { openInterestFeePerYearBigint } from '@zoltar/statoblast-shared/statoblast/retentionRate'
import { formatStatoblastSecurityMultiplier } from '../../markets/lib/trading.js'
import { GlossaryTerm } from '../../glossary/components/GlossaryTerm.js'
import { formatInitialReportPriorityFee } from '../lib/priorityFee.js'
import type { MetricGridVariant } from '../../types.js'
import type { ListedSecurityPool } from '@zoltar/ui-core-shared/types/contracts.js'

type SecurityPoolSummaryMetricsProps = {
	children?: ComponentChildren
	className?: string
	metricVariant?: MetricGridVariant
	pool: ListedSecurityPool
	showTotalBacking?: boolean
}

function formatRepPerCapacityBps(value: bigint) {
	return formatValueWithUnit(formatTrimmedUnits(value, 4), commonCopy.repPerEth)
}

/** Static pool parameters. Settlement collateral against standing commitments is shown by `PoolCapacitySummary`. */
export function SecurityPoolSummaryMetrics({ children, className = '', metricVariant = 'default', pool, showTotalBacking = false }: SecurityPoolSummaryMetricsProps) {
	const resolvedPoolHeldRepPerCapacityBps = pool.totalUnderwritingLimitAttoEth === 0n ? undefined : (pool.totalPoolHeldAttoRep * 10_000n) / pool.totalUnderwritingLimitAttoEth
	return (
		<MetricGrid className={className} variant={metricVariant}>
			<MetricField label={securityPoolCopy.vaultCount}>{pool.vaultCount.toString()}</MetricField>
			<MetricField label={<GlossaryTerm id='security-multiplier'>{statoblastAppCopy.statoblastSecurityMultiplierBps}</GlossaryTerm>}>{formatStatoblastSecurityMultiplier(pool.statoblastSecurityMultiplierBps)}</MetricField>
			<MetricField label={commonCopy.initialReportPriorityFee}>{formatInitialReportPriorityFee(pool.initialReportPriorityFeeAttoEthPerGas)}</MetricField>
			<MetricField label={<GlossaryTerm id='open-interest-fee'>{securityPoolCopy.openInterestFeeYear}</GlossaryTerm>}>
				<CurrencyValue value={openInterestFeePerYearBigint(pool.currentRetentionRate)} suffix={commonCopy.percent} />
			</MetricField>
			{showTotalBacking ? (
				<MetricField label={securityPoolCopy.totalPoolHeldAttoRep}>
					<CurrencyValue exactWhenRoundedToZero value={pool.totalPoolHeldAttoRep} suffix={commonCopy.rep} />
				</MetricField>
			) : undefined}
			{resolvedPoolHeldRepPerCapacityBps === undefined ? undefined : <MetricField label={securityPoolCopy.poolHeldRepPerCapacity}>{formatRepPerCapacityBps(resolvedPoolHeldRepPerCapacityBps)}</MetricField>}
			{children}
		</MetricGrid>
	)
}
