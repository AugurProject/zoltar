import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as statoblastAppCopy from '../../../copy/app.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import type { ComponentChildren } from 'preact'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { openInterestFeePerYearBigint } from '../lib/retentionRate.js'
import { formatStatoblastSecurityMultiplier } from '../../markets/lib/trading.js'
import { formatCurrencyBalanceWithUnit } from '@zoltar/ui-core-shared/lib/formatters.js'
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
	const whole = value / 10_000n
	const fraction = (value % 10_000n).toString().padStart(4, '0').replace(/0+$/, '')
	return `${whole.toString()}${fraction === '' ? '' : `.${fraction}`}×`
}

/** Static pool parameters. Capacity is shown by `PoolCapacitySummary`, which labels the REP price it uses. */
export function SecurityPoolSummaryMetrics({ children, className = '', metricVariant = 'default', pool, showTotalBacking = false }: SecurityPoolSummaryMetricsProps) {
	const resolvedPoolHeldRepPerCapacityBps = pool.totalCapacityOwnershipAttoRep === 0n ? undefined : (pool.totalPoolHeldAttoRep * 10_000n) / pool.totalCapacityOwnershipAttoRep
	return (
		<MetricGrid className={className} variant={metricVariant}>
			<MetricField label={securityPoolCopy.vaultCount}>{pool.vaultCount.toString()}</MetricField>
			<MetricField label={statoblastAppCopy.statoblastSecurityMultiplierBps}>{formatStatoblastSecurityMultiplier(pool.statoblastSecurityMultiplierBps)}x</MetricField>
			<MetricField label={commonCopy.initialReportPriorityFee}>{formatCurrencyBalanceWithUnit(pool.initialReportPriorityFeeAttoEthPerGas, commonCopy.eth, 18)}</MetricField>
			<MetricField label={securityPoolCopy.openInterestFeeYear}>
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
