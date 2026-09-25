import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as statoblastAppCopy from '../../../copy/app.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import * as poolWorkspaceCopy from '../../../copy/poolWorkspace.js'
import type { ComponentChildren } from 'preact'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { openInterestFeePerYearBigint } from '../lib/retentionRate.js'
import { calculateMintingCapacityAttoEth, formatStatoblastSecurityMultiplier } from '../../markets/lib/trading.js'
import { formatCurrencyBalanceWithUnit } from '@zoltar/ui-core-shared/lib/formatters.js'
import { GlossaryTerm } from '../../glossary/components/GlossaryTerm.js'
import type { MetricGridVariant } from '../../types.js'
import type { ListedSecurityPool } from '@zoltar/ui-core-shared/types/contracts.js'

type SecurityPoolSummaryMetricsProps = {
	calculationRepPerEthPrice?: bigint | undefined
	calculationPriceConfigured?: boolean | undefined
	children?: ComponentChildren
	className?: string
	metricVariant?: MetricGridVariant
	/** Skip the vault count, security multiplier, and open interest cells when a headline strip already shows them. */
	omitHeadlineMetrics?: boolean
	omitCapacity?: boolean
	pool: ListedSecurityPool
	showTotalBacking?: boolean
}

function formatRepPerCapacityBps(value: bigint) {
	const whole = value / 10_000n
	const fraction = (value % 10_000n).toString().padStart(4, '0').replace(/0+$/, '')
	return `${whole.toString()}${fraction === '' ? '' : `.${fraction}`}×`
}

export function SecurityPoolSummaryMetrics({ calculationPriceConfigured = false, calculationRepPerEthPrice, children, className = '', metricVariant = 'default', omitHeadlineMetrics = false, omitCapacity = false, pool, showTotalBacking = false }: SecurityPoolSummaryMetricsProps) {
	const mintingCapacityAttoEth = calculateMintingCapacityAttoEth(pool.totalCapacityOwnershipAttoRep, calculationPriceConfigured ? calculationRepPerEthPrice : pool.lastOraclePrice, pool.statoblastSecurityMultiplierBps)
	const resolvedPoolHeldRepPerCapacityBps = pool.totalCapacityOwnershipAttoRep === 0n ? undefined : (pool.totalPoolHeldAttoRep * 10_000n) / pool.totalCapacityOwnershipAttoRep
	return (
		<MetricGrid className={className} variant={metricVariant}>
			{omitHeadlineMetrics ? undefined : <MetricField label={securityPoolCopy.vaultCount}>{pool.vaultCount.toString()}</MetricField>}
			{omitHeadlineMetrics ? undefined : <MetricField label={<GlossaryTerm id='security-multiplier'>{statoblastAppCopy.statoblastSecurityMultiplierBps}</GlossaryTerm>}>{formatStatoblastSecurityMultiplier(pool.statoblastSecurityMultiplierBps)}x</MetricField>}
			<MetricField label={commonCopy.initialReportPriorityFee}>{formatCurrencyBalanceWithUnit(pool.initialReportPriorityFeeAttoEthPerGas, commonCopy.eth, 18)}</MetricField>
			<MetricField label={<GlossaryTerm id='open-interest-fee'>{securityPoolCopy.openInterestFeeYear}</GlossaryTerm>}>
				<CurrencyValue value={openInterestFeePerYearBigint(pool.currentRetentionRate)} suffix={commonCopy.percent} />
			</MetricField>
			{showTotalBacking ? (
				<MetricField label={securityPoolCopy.totalPoolHeldAttoRep}>
					<CurrencyValue exactWhenRoundedToZero value={pool.totalPoolHeldAttoRep} suffix={commonCopy.rep} />
				</MetricField>
			) : undefined}
			{resolvedPoolHeldRepPerCapacityBps === undefined ? undefined : <MetricField label={securityPoolCopy.poolHeldRepPerCapacity}>{formatRepPerCapacityBps(resolvedPoolHeldRepPerCapacityBps)}</MetricField>}
			{omitHeadlineMetrics || omitCapacity ? undefined : (
				<MetricField label={poolWorkspaceCopy.capacityLabel} valueClassName='pool-capacity-values'>
					<CurrencyValue exactWhenRoundedToZero value={pool.settlementCollateralAttoEth} suffix={commonCopy.eth} /> <span>/</span> {mintingCapacityAttoEth === undefined ? commonCopy.unavailable : <CurrencyValue exactWhenRoundedToZero value={mintingCapacityAttoEth} suffix={commonCopy.eth} />}
				</MetricField>
			)}
			{children}
		</MetricGrid>
	)
}
