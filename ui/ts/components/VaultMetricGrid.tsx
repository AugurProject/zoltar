import { CurrencyValue } from './CurrencyValue.js'
import { MetricField } from './MetricField.js'
import { TimestampValue } from './TimestampValue.js'
import type { VaultMetricGridProps } from '../types/components.js'
import { CollateralizationCircle } from './CollateralizationCircle.js'
import { getVaultCollateralizationPercent } from '../lib/trading.js'
import { UI_STRING_ESCROWED_REP, UI_STRING_ETH, UI_STRING_PRICE_VALID_UNTIL, UI_STRING_REP, UI_STRING_REP_COLLATERAL, UI_STRING_SECURITY_BOND_ALLOWANCE } from '../lib/uiStrings.js'

function VaultPrimaryMetric({ className, label, suffix, value }: { className?: string; label: string; suffix: string; value: bigint | undefined }) {
	return (
		<div className={className}>
			<span>{label}</span>
			<strong>
				<CurrencyValue value={value} suffix={suffix} />
			</strong>
		</div>
	)
}

export function VaultMetricGrid({ className = '', layout = 'grid', escalationEscrowedRep, priceValidUntilTimestamp, repDepositShare, repPerEthPrice, selectedPoolSecurityMultiplier, securityBondAllowance }: VaultMetricGridProps) {
	const collateralizationPercent = getVaultCollateralizationPercent(repDepositShare, securityBondAllowance, repPerEthPrice)
	const targetCollateralizationPercent = selectedPoolSecurityMultiplier === undefined ? undefined : selectedPoolSecurityMultiplier * 100n * 10n ** 18n

	if (layout === 'preview')
		return (
			<div className={['vault-preview-strip', className].filter(Boolean).join(' ')}>
				<div className='vault-preview-strip-head'>
					<VaultPrimaryMetric className='vault-preview-allowance' label={UI_STRING_SECURITY_BOND_ALLOWANCE} value={securityBondAllowance} suffix={UI_STRING_ETH} />
				</div>
				<div className='vault-preview-side-metrics'>
					<VaultPrimaryMetric label={UI_STRING_REP_COLLATERAL} value={repDepositShare} suffix={UI_STRING_REP} />
				</div>
				<div className='vault-preview-meta'>
					{escalationEscrowedRep === undefined ? null : (
						<MetricField label={UI_STRING_ESCROWED_REP}>
							<CurrencyValue value={escalationEscrowedRep} suffix={UI_STRING_REP} />
						</MetricField>
					)}
					{priceValidUntilTimestamp === undefined ? null : (
						<MetricField label={UI_STRING_PRICE_VALID_UNTIL}>
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
				<VaultPrimaryMetric className='vault-detail-hero-primary' label={UI_STRING_SECURITY_BOND_ALLOWANCE} value={securityBondAllowance} suffix={UI_STRING_ETH} />
				<div className='vault-detail-hero-secondary'>
					<VaultPrimaryMetric label={UI_STRING_REP_COLLATERAL} value={repDepositShare} suffix={UI_STRING_REP} />
				</div>
			</div>
			<div className='vault-detail-meta'>
				{escalationEscrowedRep === undefined ? undefined : (
					<MetricField label={UI_STRING_ESCROWED_REP}>
						<CurrencyValue value={escalationEscrowedRep} suffix={UI_STRING_REP} />
					</MetricField>
				)}
				{priceValidUntilTimestamp === undefined ? undefined : (
					<MetricField label={UI_STRING_PRICE_VALID_UNTIL}>
						<TimestampValue timestamp={priceValidUntilTimestamp} />
					</MetricField>
				)}
			</div>
		</div>
	)
}
