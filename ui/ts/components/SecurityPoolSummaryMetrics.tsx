import * as commonCopy from '../copy/common.js'
import * as securityPoolCopy from '../copy/securityPool.js'
import type { ComponentChildren } from 'preact'
import { AddressValue } from './AddressValue.js'
import { CurrencyValue } from './CurrencyValue.js'
import { MetricGrid } from './MetricGrid.js'
import { MetricField } from './MetricField.js'
import { CollateralizationCircle } from './CollateralizationCircle.js'
import { OpenOraclePriceValue } from './OpenOraclePriceValue.js'
import { ProgressMeter } from './ProgressMeter.js'
import { UniverseLink } from './UniverseLink.js'
import { openInterestFeePerYearBigint } from '../lib/retentionRate.js'
import { getPoolCollateralizationPercent } from '../lib/trading.js'
import { getToneRatioThreshold, getVisualRatio } from '../lib/visualMetrics.js'
import type { MetricGridVariant } from '../types/components.js'
import type { ListedSecurityPool } from '../types/contracts.js'

type SecurityPoolSummaryMetricsProps = {
	children?: ComponentChildren
	className?: string
	currentTimestamp?: bigint | undefined
	metricVariant?: MetricGridVariant
	pool: ListedSecurityPool
	repPerEthPrice: bigint | undefined
	repPerEthSource: 'mock' | 'v3' | 'v4' | undefined
	repPerEthSourceUrl: string | undefined
	showCollateralizationGauge?: boolean
	showPoolAddress?: boolean
	showTotalBacking?: boolean
	showUniverse?: boolean
	variant?: 'embedded' | 'hero'
}

export function SecurityPoolSummaryMetrics({
	children,
	className = '',
	currentTimestamp,
	metricVariant = 'default',
	pool,
	repPerEthPrice,
	repPerEthSource: _repPerEthSource,
	repPerEthSourceUrl: _repPerEthSourceUrl,
	showCollateralizationGauge = true,
	showPoolAddress = false,
	showTotalBacking = false,
	showUniverse = false,
	variant = 'embedded',
}: SecurityPoolSummaryMetricsProps) {
	const collateralizationPercent = getPoolCollateralizationPercent(pool.totalRepDeposit, pool.totalSecurityBondAllowance, repPerEthPrice)
	const targetCollateralizationPercent = pool.securityMultiplier * 100n * 10n ** 18n

	if (variant === 'embedded')
		return (
			<MetricGrid className={className} variant={metricVariant}>
				{showPoolAddress ? (
					<MetricField label={securityPoolCopy.poolAddress}>
						<AddressValue address={pool.securityPoolAddress} />
					</MetricField>
				) : undefined}
				{showUniverse ? (
					<MetricField label={commonCopy.universe}>
						<UniverseLink universeId={pool.universeId} />
					</MetricField>
				) : undefined}
				<MetricField label={securityPoolCopy.vaults}>{pool.vaultCount.toString()}</MetricField>
				<MetricField label={commonCopy.securityMultiplier}>{pool.securityMultiplier.toString()}</MetricField>
				<MetricField label={securityPoolCopy.openInterestFeeYear}>
					<CurrencyValue value={openInterestFeePerYearBigint(pool.currentRetentionRate)} suffix={commonCopy.percent} />
				</MetricField>
				{showTotalBacking ? (
					<MetricField label={securityPoolCopy.totalRepCollateral}>
						<CurrencyValue value={pool.totalRepDeposit} suffix={commonCopy.rep} />
					</MetricField>
				) : undefined}
				<MetricField label={securityPoolCopy.openInterestMintedMax}>
					<CurrencyValue value={pool.completeSetCollateralAmount} suffix={commonCopy.eth} /> / <CurrencyValue value={pool.totalSecurityBondAllowance} suffix={commonCopy.eth} />
				</MetricField>
				{children}
			</MetricGrid>
		)

	return (
		<div className={['security-pool-hero-metrics', className].filter(Boolean).join(' ')}>
			{showCollateralizationGauge ? <CollateralizationCircle className='security-pool-hero-collateralization' collateralizationPercent={collateralizationPercent} size='medium' targetCollateralizationPercent={targetCollateralizationPercent} /> : undefined}
			<div className='security-pool-hero-ribbon'>
				<div className='security-pool-ribbon-stat'>
					<span className='security-pool-ribbon-stat-label'>{securityPoolCopy.vaultCount}</span>
					<strong className='security-pool-ribbon-stat-value'>{pool.vaultCount.toString()}</strong>
				</div>
				<div className='security-pool-ribbon-stat'>
					<span className='security-pool-ribbon-stat-label'>{commonCopy.securityMultiplier}</span>
					<strong className='security-pool-ribbon-stat-value'>{pool.securityMultiplier.toString()}x</strong>
				</div>
				<div className='security-pool-ribbon-stat'>
					<span className='security-pool-ribbon-stat-label'>{securityPoolCopy.annualFee}</span>
					<strong className='security-pool-ribbon-stat-value'>
						<CurrencyValue value={openInterestFeePerYearBigint(pool.currentRetentionRate)} suffix={commonCopy.percent} />
					</strong>
				</div>
				<div className='security-pool-ribbon-stat'>
					<span className='security-pool-ribbon-stat-label'>{securityPoolCopy.totalRepBacking}</span>
					<strong className='security-pool-ribbon-stat-value'>
						<CurrencyValue compactWhenOverflow copyable={false} value={pool.totalRepDeposit} suffix={commonCopy.rep} />
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
						maxValue={pool.totalSecurityBondAllowance}
						secondaryValue={
							<span className='detail'>
								{securityPoolCopy.maxLead}
								<CurrencyValue value={pool.totalSecurityBondAllowance} suffix={commonCopy.eth} />
							</span>
						}
						tone={getToneRatioThreshold({
							ratio: getVisualRatio({ value: pool.completeSetCollateralAmount, maxValue: pool.totalSecurityBondAllowance }),
							successThreshold: 0.6,
							warningThreshold: 0.85,
						})}
						value={pool.completeSetCollateralAmount}
						valueText={<CurrencyValue value={pool.completeSetCollateralAmount} suffix={commonCopy.eth} />}
					/>
				</div>
			</div>
			{showPoolAddress || showUniverse || children === undefined ? (
				<div className='security-pool-secondary-facts'>
					{showPoolAddress ? (
						<MetricField label={securityPoolCopy.poolAddress}>
							<AddressValue address={pool.securityPoolAddress} />
						</MetricField>
					) : null}
					{showUniverse ? (
						<MetricField label={commonCopy.universe}>
							<UniverseLink universeId={pool.universeId} />
						</MetricField>
					) : null}
					{children}
				</div>
			) : null}
		</div>
	)
}
