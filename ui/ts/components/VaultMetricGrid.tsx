import { CurrencyValue } from './CurrencyValue.js'
import { MetricField } from './MetricField.js'
import { TimestampValue } from './TimestampValue.js'
import type { VaultMetricGridProps } from '../types/components.js'
import { CollateralizationCircle } from './CollateralizationCircle.js'
import { getVaultCollateralizationPercent } from '../lib/trading.js'
import { TSX_STRINGS } from '../lib/uiStrings.js'

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
					<VaultPrimaryMetric className='vault-preview-allowance' label={TSX_STRINGS.componentsVaultMetricGrid.copy001} value={securityBondAllowance} suffix={TSX_STRINGS.componentsVaultMetricGrid.copy002} />
				</div>
				<div className='vault-preview-side-metrics'>
					<VaultPrimaryMetric label={TSX_STRINGS.componentsVaultMetricGrid.copy003} value={repDepositShare} suffix={TSX_STRINGS.componentsVaultMetricGrid.copy004} />
				</div>
				<div className='vault-preview-meta'>
					{escalationEscrowedRep === undefined ? null : (
						<MetricField label={TSX_STRINGS.componentsVaultMetricGrid.copy005}>
							<CurrencyValue value={escalationEscrowedRep} suffix={TSX_STRINGS.componentsVaultMetricGrid.copy006} />
						</MetricField>
					)}
					{priceValidUntilTimestamp === undefined ? null : (
						<MetricField label={TSX_STRINGS.componentsVaultMetricGrid.copy007}>
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
				<VaultPrimaryMetric className='vault-detail-hero-primary' label={TSX_STRINGS.componentsVaultMetricGrid.copy008} value={securityBondAllowance} suffix={TSX_STRINGS.componentsVaultMetricGrid.copy009} />
				<div className='vault-detail-hero-secondary'>
					<VaultPrimaryMetric label={TSX_STRINGS.componentsVaultMetricGrid.copy010} value={repDepositShare} suffix={TSX_STRINGS.componentsVaultMetricGrid.copy011} />
				</div>
			</div>
			<div className='vault-detail-meta'>
				{escalationEscrowedRep === undefined ? undefined : (
					<MetricField label={TSX_STRINGS.componentsVaultMetricGrid.copy012}>
						<CurrencyValue value={escalationEscrowedRep} suffix={TSX_STRINGS.componentsVaultMetricGrid.copy013} />
					</MetricField>
				)}
				{priceValidUntilTimestamp === undefined ? undefined : (
					<MetricField label={TSX_STRINGS.componentsVaultMetricGrid.copy014}>
						<TimestampValue timestamp={priceValidUntilTimestamp} />
					</MetricField>
				)}
			</div>
		</div>
	)
}
