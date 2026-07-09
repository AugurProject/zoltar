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
import { TSX_STRINGS } from '../lib/uiStrings.js'

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
					<MetricField label={TSX_STRINGS.componentsSecurityPoolSummaryMetrics.copy001}>
						<AddressValue address={pool.securityPoolAddress} />
					</MetricField>
				) : undefined}
				{showUniverse ? (
					<MetricField label={TSX_STRINGS.componentsSecurityPoolSummaryMetrics.copy002}>
						<UniverseLink universeId={pool.universeId} />
					</MetricField>
				) : undefined}
				<MetricField label={TSX_STRINGS.componentsSecurityPoolSummaryMetrics.copy003}>{pool.vaultCount.toString()}</MetricField>
				<MetricField label={TSX_STRINGS.componentsSecurityPoolSummaryMetrics.copy004}>{pool.securityMultiplier.toString()}</MetricField>
				<MetricField label={TSX_STRINGS.componentsSecurityPoolSummaryMetrics.copy005}>
					<CurrencyValue value={openInterestFeePerYearBigint(pool.currentRetentionRate)} suffix={TSX_STRINGS.componentsSecurityPoolSummaryMetrics.copy006} />
				</MetricField>
				{showTotalBacking ? (
					<MetricField label={TSX_STRINGS.componentsSecurityPoolSummaryMetrics.copy007}>
						<CurrencyValue value={pool.totalRepDeposit} suffix={TSX_STRINGS.componentsSecurityPoolSummaryMetrics.copy008} />
					</MetricField>
				) : undefined}
				<MetricField label={TSX_STRINGS.componentsSecurityPoolSummaryMetrics.copy009}>
					<CurrencyValue value={pool.completeSetCollateralAmount} suffix={TSX_STRINGS.componentsSecurityPoolSummaryMetrics.copy010} /> / <CurrencyValue value={pool.totalSecurityBondAllowance} suffix={TSX_STRINGS.componentsSecurityPoolSummaryMetrics.copy011} />
				</MetricField>
				{children}
			</MetricGrid>
		)

	return (
		<div className={['security-pool-hero-metrics', className].filter(Boolean).join(' ')}>
			{showCollateralizationGauge ? <CollateralizationCircle className='security-pool-hero-collateralization' collateralizationPercent={collateralizationPercent} size='medium' targetCollateralizationPercent={targetCollateralizationPercent} /> : undefined}
			<div className='security-pool-hero-ribbon'>
				<div className='security-pool-ribbon-stat'>
					<span className='security-pool-ribbon-stat-label'>{TSX_STRINGS.componentsSecurityPoolSummaryMetrics.copy012}</span>
					<strong className='security-pool-ribbon-stat-value'>{pool.vaultCount.toString()}</strong>
				</div>
				<div className='security-pool-ribbon-stat'>
					<span className='security-pool-ribbon-stat-label'>{TSX_STRINGS.componentsSecurityPoolSummaryMetrics.copy013}</span>
					<strong className='security-pool-ribbon-stat-value'>{pool.securityMultiplier.toString()}x</strong>
				</div>
				<div className='security-pool-ribbon-stat'>
					<span className='security-pool-ribbon-stat-label'>{TSX_STRINGS.componentsSecurityPoolSummaryMetrics.copy014}</span>
					<strong className='security-pool-ribbon-stat-value'>
						<CurrencyValue value={openInterestFeePerYearBigint(pool.currentRetentionRate)} suffix={TSX_STRINGS.componentsSecurityPoolSummaryMetrics.copy015} />
					</strong>
				</div>
				<div className='security-pool-ribbon-stat'>
					<span className='security-pool-ribbon-stat-label'>{TSX_STRINGS.componentsSecurityPoolSummaryMetrics.copy016}</span>
					<strong className='security-pool-ribbon-stat-value'>
						<CurrencyValue compactWhenOverflow copyable={false} value={pool.totalRepDeposit} suffix={TSX_STRINGS.componentsSecurityPoolSummaryMetrics.copy017} />
					</strong>
				</div>
			</div>
			<div className='security-pool-hero-main'>
				<div className='security-pool-hero-oracle'>
					<span className='security-pool-hero-oracle-label'>{TSX_STRINGS.componentsSecurityPoolSummaryMetrics.copy018}</span>
					<strong className='security-pool-hero-oracle-value'>
						<OpenOraclePriceValue currentTimestamp={currentTimestamp} lastPrice={pool.lastOraclePrice} lastSettlementTimestamp={pool.lastOracleSettlementTimestamp} priceValidUntilTimestamp={undefined} />
					</strong>
					<span className='detail'>{TSX_STRINGS.componentsSecurityPoolSummaryMetrics.copy019}</span>
				</div>
				<div className='security-pool-hero-progress'>
					<ProgressMeter
						className='security-pool-hero-meter'
						label={TSX_STRINGS.componentsSecurityPoolSummaryMetrics.copy020}
						maxValue={pool.totalSecurityBondAllowance}
						secondaryValue={
							<span className='detail'>
								{TSX_STRINGS.componentsSecurityPoolSummaryMetrics.copy021}
								<CurrencyValue value={pool.totalSecurityBondAllowance} suffix={TSX_STRINGS.componentsSecurityPoolSummaryMetrics.copy022} />
							</span>
						}
						tone={getToneRatioThreshold({
							ratio: getVisualRatio({ value: pool.completeSetCollateralAmount, maxValue: pool.totalSecurityBondAllowance }),
							successThreshold: 0.6,
							warningThreshold: 0.85,
						})}
						value={pool.completeSetCollateralAmount}
						valueText={<CurrencyValue value={pool.completeSetCollateralAmount} suffix={TSX_STRINGS.componentsSecurityPoolSummaryMetrics.copy023} />}
					/>
				</div>
			</div>
			{showPoolAddress || showUniverse || children === undefined ? (
				<div className='security-pool-secondary-facts'>
					{showPoolAddress ? (
						<MetricField label={TSX_STRINGS.componentsSecurityPoolSummaryMetrics.copy024}>
							<AddressValue address={pool.securityPoolAddress} />
						</MetricField>
					) : null}
					{showUniverse ? (
						<MetricField label={TSX_STRINGS.componentsSecurityPoolSummaryMetrics.copy025}>
							<UniverseLink universeId={pool.universeId} />
						</MetricField>
					) : null}
					{children}
				</div>
			) : null}
		</div>
	)
}
