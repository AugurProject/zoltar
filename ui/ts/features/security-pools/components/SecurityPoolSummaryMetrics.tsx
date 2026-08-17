import * as commonCopy from '../../../copy/common.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import type { ComponentChildren } from 'preact'
import { AddressValue } from '../../../components/AddressValue.js'
import { CurrencyValue } from '../../../components/CurrencyValue.js'
import { MetricGrid } from '../../../components/MetricGrid.js'
import { MetricField } from '../../../components/MetricField.js'
import { OpenOraclePriceValue } from '../../open-oracle/components/OpenOraclePriceValue.js'
import { ProgressMeter } from '../../../components/ProgressMeter.js'
import { openInterestFeePerYearBigint } from '../lib/retentionRate.js'
import { calculateMintingCapacityAttoEth, formatStatoblastSecurityMultiplier } from '../../markets/lib/trading.js'
import { getToneRatioThreshold, getVisualRatio } from '../../../lib/visualMetrics.js'
import { formatCurrencyBalanceWithUnit } from '../../../lib/formatters.js'
import type { MetricGridVariant } from '../../types.js'
import type { ListedSecurityPool } from '../../../types/contracts.js'

type SecurityPoolSummaryMetricsProps = {
	children?: ComponentChildren
	className?: string
	currentTimestamp?: bigint | undefined
	metricVariant?: MetricGridVariant
	pool: ListedSecurityPool
	showPoolAddress?: boolean
	showTotalBacking?: boolean
	variant?: 'embedded' | 'hero'
}

export function SecurityPoolSummaryMetrics({ children, className = '', currentTimestamp, metricVariant = 'default', pool, showPoolAddress = false, showTotalBacking = false, variant = 'embedded' }: SecurityPoolSummaryMetricsProps) {
	const mintingCapacityAttoEth = calculateMintingCapacityAttoEth(pool.totalCapacityOwnershipAttoRep, pool.lastOraclePrice, pool.statoblastSecurityMultiplierBps)
	if (variant === 'embedded')
		return (
			<MetricGrid className={className} variant={metricVariant}>
				{showPoolAddress ? (
					<MetricField label={securityPoolCopy.poolAddress}>
						<AddressValue address={pool.securityPoolAddress} />
					</MetricField>
				) : undefined}
				<MetricField label={securityPoolCopy.vaultCount}>{pool.vaultCount.toString()}</MetricField>
				<MetricField label={commonCopy.statoblastSecurityMultiplierBps}>{formatStatoblastSecurityMultiplier(pool.statoblastSecurityMultiplierBps)}x</MetricField>
				<MetricField label={commonCopy.initialReportPriorityFee}>{formatCurrencyBalanceWithUnit(pool.initialReportPriorityFeeAttoEthPerGas, commonCopy.gwei, 9)}</MetricField>
				<MetricField label={securityPoolCopy.openInterestFeeYear}>
					<CurrencyValue value={openInterestFeePerYearBigint(pool.currentRetentionRate)} suffix={commonCopy.percent} />
				</MetricField>
				{showTotalBacking ? (
					<MetricField label={securityPoolCopy.totalPoolHeldAttoRep}>
						<CurrencyValue value={pool.totalPoolHeldAttoRep} suffix={commonCopy.rep} />
					</MetricField>
				) : undefined}
				<MetricField label={securityPoolCopy.openInterestMintedMax}>
					<CurrencyValue value={pool.settlementCollateralAttoEth} suffix={commonCopy.eth} /> / {mintingCapacityAttoEth === undefined ? commonCopy.unavailable : <CurrencyValue value={mintingCapacityAttoEth} suffix={commonCopy.eth} />}
				</MetricField>
				{children}
			</MetricGrid>
		)

	return (
		<div className={['security-pool-hero-metrics', className].filter(Boolean).join(' ')}>
			<div className='security-pool-hero-ribbon'>
				<div className='security-pool-ribbon-stat'>
					<span className='security-pool-ribbon-stat-label'>{securityPoolCopy.vaultCount}</span>
					<strong className='security-pool-ribbon-stat-value'>{pool.vaultCount.toString()}</strong>
				</div>
				<div className='security-pool-ribbon-stat'>
					<span className='security-pool-ribbon-stat-label'>{commonCopy.statoblastSecurityMultiplierBps}</span>
					<strong className='security-pool-ribbon-stat-value'>{formatStatoblastSecurityMultiplier(pool.statoblastSecurityMultiplierBps)}x</strong>
				</div>
				<div className='security-pool-ribbon-stat'>
					<span className='security-pool-ribbon-stat-label'>{securityPoolCopy.annualFee}</span>
					<strong className='security-pool-ribbon-stat-value'>
						<CurrencyValue value={openInterestFeePerYearBigint(pool.currentRetentionRate)} suffix={commonCopy.percent} />
					</strong>
				</div>
				<div className='security-pool-ribbon-stat'>
					<span className='security-pool-ribbon-stat-label'>{securityPoolCopy.totalPoolHeldAttoRep}</span>
					<strong className='security-pool-ribbon-stat-value'>
						<CurrencyValue compactWhenOverflow copyable={false} value={pool.totalPoolHeldAttoRep} suffix={commonCopy.rep} />
					</strong>
				</div>
			</div>
			<div className='security-pool-hero-main'>
				<div className='security-pool-hero-oracle'>
					<span className='security-pool-hero-oracle-label'>{securityPoolCopy.currentOraclePrice}</span>
					<strong className='security-pool-hero-oracle-value'>
						<OpenOraclePriceValue currentTimestamp={currentTimestamp} lastPrice={pool.lastOraclePrice} lastSettlementTimestamp={pool.lastOracleSettlementTimestamp} priceValidUntilTimestamp={undefined} />
					</strong>
					<span className='detail'>{securityPoolCopy.latestSettlementContextDetail}</span>
				</div>
				<div className='security-pool-hero-progress'>
					<ProgressMeter
						className='security-pool-hero-meter'
						label={securityPoolCopy.openInterestMinted}
						maxValue={mintingCapacityAttoEth ?? 0n}
						secondaryValue={
							<span className='detail'>
								{securityPoolCopy.maxLead}
								{mintingCapacityAttoEth === undefined ? commonCopy.unavailable : <CurrencyValue value={mintingCapacityAttoEth} suffix={commonCopy.eth} />}
							</span>
						}
						tone={getToneRatioThreshold({
							ratio: getVisualRatio({ value: pool.settlementCollateralAttoEth, maxValue: mintingCapacityAttoEth ?? 0n }),
							successThreshold: 0.6,
							warningThreshold: 0.85,
						})}
						value={pool.settlementCollateralAttoEth}
						valueText={<CurrencyValue value={pool.settlementCollateralAttoEth} suffix={commonCopy.eth} />}
					/>
				</div>
			</div>
			{showPoolAddress || children === undefined ? (
				<div className='security-pool-secondary-facts'>
					{showPoolAddress ? (
						<MetricField label={securityPoolCopy.poolAddress}>
							<AddressValue address={pool.securityPoolAddress} />
						</MetricField>
					) : null}
					{children}
				</div>
			) : null}
		</div>
	)
}
