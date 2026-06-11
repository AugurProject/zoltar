import { CurrencyValue } from './CurrencyValue.js'
import { MetricField } from './MetricField.js'
import { TimestampValue } from './TimestampValue.js'
import type { VaultMetricGridProps } from '../types/components.js'
import { CollateralizationCircle } from './CollateralizationCircle.js'
import { getVaultCollateralizationPercent } from '../lib/trading.js'

export function VaultMetricGrid({ className = '', layout = 'grid', lockedRepInEscalationGame, priceValidUntilTimestamp, repDepositShare, repPerEthPrice, selectedPoolSecurityMultiplier, securityBondAllowance }: VaultMetricGridProps) {
	const collateralizationPercent = getVaultCollateralizationPercent(repDepositShare, securityBondAllowance, repPerEthPrice)
	const targetCollateralizationPercent = selectedPoolSecurityMultiplier === undefined ? undefined : selectedPoolSecurityMultiplier * 100n * 10n ** 18n

	if (layout === 'preview')
		return (
			<div className={['vault-preview-strip', className].filter(Boolean).join(' ')}>
				<div className='vault-preview-strip-head'>
					<div className='vault-preview-allowance'>
						<span>Security Bond Allowance</span>
						<strong>
							<CurrencyValue value={securityBondAllowance} suffix='ETH' />
						</strong>
					</div>
				</div>
				<div className='vault-preview-side-metrics'>
					<div>
						<span>REP Collateral</span>
						<strong>
							<CurrencyValue value={repDepositShare} suffix='REP' />
						</strong>
					</div>
				</div>
				<div className='vault-preview-meta'>
					{lockedRepInEscalationGame === undefined ? null : (
						<MetricField label='Locked REP'>
							<CurrencyValue value={lockedRepInEscalationGame} suffix='REP' />
						</MetricField>
					)}
					{priceValidUntilTimestamp === undefined ? null : (
						<MetricField label='Price Valid Until'>
							<TimestampValue timestamp={priceValidUntilTimestamp} />
						</MetricField>
					)}
				</div>
			</div>
		)

	return (
		<div className={['vault-detail-stage', className].filter(Boolean).join(' ')}>
			<div className='vault-detail-hero'>
				<CollateralizationCircle className='vault-detail-collateralization' collateralizationPercent={collateralizationPercent} size='medium' targetCollateralizationPercent={targetCollateralizationPercent} />
				<div className='vault-detail-hero-primary'>
					<span>Security Bond Allowance</span>
					<strong>
						<CurrencyValue value={securityBondAllowance} suffix='ETH' />
					</strong>
				</div>
				<div className='vault-detail-hero-secondary'>
					<div>
						<span>REP Collateral</span>
						<strong>
							<CurrencyValue value={repDepositShare} suffix='REP' />
						</strong>
					</div>
				</div>
			</div>
			<div className='vault-detail-meta'>
				{lockedRepInEscalationGame === undefined ? undefined : (
					<MetricField label='Locked REP'>
						<CurrencyValue value={lockedRepInEscalationGame} suffix='REP' />
					</MetricField>
				)}
				{priceValidUntilTimestamp === undefined ? undefined : (
					<MetricField label='Price Valid Until'>
						<TimestampValue timestamp={priceValidUntilTimestamp} />
					</MetricField>
				)}
			</div>
		</div>
	)
}
