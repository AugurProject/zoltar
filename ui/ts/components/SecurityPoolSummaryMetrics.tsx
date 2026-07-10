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
import {
	UI_STRING_ANNUAL_FEE,
	UI_STRING_CURRENT_ORACLE_PRICE,
	UI_STRING_ETH,
	UI_STRING_LATEST_SETTLEMENT_ANCHORS_THE_TRADING_AND_LIQUIDATION_VIEWS,
	UI_STRING_MAX_PREFIX,
	UI_STRING_OPEN_INTEREST_FEE_YEAR,
	UI_STRING_OPEN_INTEREST_MINTED,
	UI_STRING_OPEN_INTEREST_MINTED_MAX,
	UI_STRING_PERCENT,
	UI_STRING_POOL_ADDRESS,
	UI_STRING_REP,
	UI_STRING_SECURITY_MULTIPLIER,
	UI_STRING_TOTAL_REP_BACKING,
	UI_STRING_TOTAL_REP_COLLATERAL,
	UI_STRING_UNIVERSE,
	UI_STRING_VAULTS,
	UI_STRING_VAULT_COUNT,
} from '../lib/uiStrings.js'

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
					<MetricField label={UI_STRING_POOL_ADDRESS}>
						<AddressValue address={pool.securityPoolAddress} />
					</MetricField>
				) : undefined}
				{showUniverse ? (
					<MetricField label={UI_STRING_UNIVERSE}>
						<UniverseLink universeId={pool.universeId} />
					</MetricField>
				) : undefined}
				<MetricField label={UI_STRING_VAULTS}>{pool.vaultCount.toString()}</MetricField>
				<MetricField label={UI_STRING_SECURITY_MULTIPLIER}>{pool.securityMultiplier.toString()}</MetricField>
				<MetricField label={UI_STRING_OPEN_INTEREST_FEE_YEAR}>
					<CurrencyValue value={openInterestFeePerYearBigint(pool.currentRetentionRate)} suffix={UI_STRING_PERCENT} />
				</MetricField>
				{showTotalBacking ? (
					<MetricField label={UI_STRING_TOTAL_REP_COLLATERAL}>
						<CurrencyValue value={pool.totalRepDeposit} suffix={UI_STRING_REP} />
					</MetricField>
				) : undefined}
				<MetricField label={UI_STRING_OPEN_INTEREST_MINTED_MAX}>
					<CurrencyValue value={pool.completeSetCollateralAmount} suffix={UI_STRING_ETH} /> / <CurrencyValue value={pool.totalSecurityBondAllowance} suffix={UI_STRING_ETH} />
				</MetricField>
				{children}
			</MetricGrid>
		)

	return (
		<div className={['security-pool-hero-metrics', className].filter(Boolean).join(' ')}>
			{showCollateralizationGauge ? <CollateralizationCircle className='security-pool-hero-collateralization' collateralizationPercent={collateralizationPercent} size='medium' targetCollateralizationPercent={targetCollateralizationPercent} /> : undefined}
			<div className='security-pool-hero-ribbon'>
				<div className='security-pool-ribbon-stat'>
					<span className='security-pool-ribbon-stat-label'>{UI_STRING_VAULT_COUNT}</span>
					<strong className='security-pool-ribbon-stat-value'>{pool.vaultCount.toString()}</strong>
				</div>
				<div className='security-pool-ribbon-stat'>
					<span className='security-pool-ribbon-stat-label'>{UI_STRING_SECURITY_MULTIPLIER}</span>
					<strong className='security-pool-ribbon-stat-value'>{pool.securityMultiplier.toString()}x</strong>
				</div>
				<div className='security-pool-ribbon-stat'>
					<span className='security-pool-ribbon-stat-label'>{UI_STRING_ANNUAL_FEE}</span>
					<strong className='security-pool-ribbon-stat-value'>
						<CurrencyValue value={openInterestFeePerYearBigint(pool.currentRetentionRate)} suffix={UI_STRING_PERCENT} />
					</strong>
				</div>
				<div className='security-pool-ribbon-stat'>
					<span className='security-pool-ribbon-stat-label'>{UI_STRING_TOTAL_REP_BACKING}</span>
					<strong className='security-pool-ribbon-stat-value'>
						<CurrencyValue compactWhenOverflow copyable={false} value={pool.totalRepDeposit} suffix={UI_STRING_REP} />
					</strong>
				</div>
			</div>
			<div className='security-pool-hero-main'>
				<div className='security-pool-hero-oracle'>
					<span className='security-pool-hero-oracle-label'>{UI_STRING_CURRENT_ORACLE_PRICE}</span>
					<strong className='security-pool-hero-oracle-value'>
						<OpenOraclePriceValue currentTimestamp={currentTimestamp} lastPrice={pool.lastOraclePrice} lastSettlementTimestamp={pool.lastOracleSettlementTimestamp} priceValidUntilTimestamp={undefined} />
					</strong>
					<span className='detail'>{UI_STRING_LATEST_SETTLEMENT_ANCHORS_THE_TRADING_AND_LIQUIDATION_VIEWS}</span>
				</div>
				<div className='security-pool-hero-progress'>
					<ProgressMeter
						className='security-pool-hero-meter'
						label={UI_STRING_OPEN_INTEREST_MINTED}
						maxValue={pool.totalSecurityBondAllowance}
						secondaryValue={
							<span className='detail'>
								{UI_STRING_MAX_PREFIX}
								<CurrencyValue value={pool.totalSecurityBondAllowance} suffix={UI_STRING_ETH} />
							</span>
						}
						tone={getToneRatioThreshold({
							ratio: getVisualRatio({ value: pool.completeSetCollateralAmount, maxValue: pool.totalSecurityBondAllowance }),
							successThreshold: 0.6,
							warningThreshold: 0.85,
						})}
						value={pool.completeSetCollateralAmount}
						valueText={<CurrencyValue value={pool.completeSetCollateralAmount} suffix={UI_STRING_ETH} />}
					/>
				</div>
			</div>
			{showPoolAddress || showUniverse || children === undefined ? (
				<div className='security-pool-secondary-facts'>
					{showPoolAddress ? (
						<MetricField label={UI_STRING_POOL_ADDRESS}>
							<AddressValue address={pool.securityPoolAddress} />
						</MetricField>
					) : null}
					{showUniverse ? (
						<MetricField label={UI_STRING_UNIVERSE}>
							<UniverseLink universeId={pool.universeId} />
						</MetricField>
					) : null}
					{children}
				</div>
			) : null}
		</div>
	)
}
