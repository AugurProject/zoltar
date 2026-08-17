import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as securityPoolCopy from '@zoltar/ui-zoltar/copy/securityPool.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import type { VaultMetricGridProps } from '../../types.js'

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

export function VaultMetricGrid({ badDebtAttoEth, className = '', layout = 'grid', disputeStakedAttoRep, priceValidUntilTimestamp, vaultAttoRepBacking, capacityOwnershipAttoRep }: VaultMetricGridProps) {
	if (layout === 'preview')
		return (
			<div className={['vault-preview-strip', className].filter(Boolean).join(' ')}>
				<div className='vault-preview-strip-head'>
					<VaultPrimaryMetric className='vault-preview-capacity-ownership' label={commonCopy.capacityOwnershipAttoRep} value={capacityOwnershipAttoRep} suffix={commonCopy.rep} />
				</div>
				<div className='vault-preview-side-metrics'>
					<VaultPrimaryMetric label={commonCopy.poolHeldVaultRepBackingAttoRep} value={vaultAttoRepBacking} suffix={commonCopy.rep} />
				</div>
				<div className='vault-preview-meta'>
					{badDebtAttoEth !== undefined && badDebtAttoEth > 0n ? (
						<MetricField label={securityPoolCopy.badDebt}>
							<CurrencyValue value={badDebtAttoEth} suffix={commonCopy.eth} />
						</MetricField>
					) : null}
					{disputeStakedAttoRep === undefined ? null : (
						<MetricField label={commonCopy.disputeStakedAttoRep}>
							<CurrencyValue value={disputeStakedAttoRep} suffix={commonCopy.rep} />
						</MetricField>
					)}
					{priceValidUntilTimestamp === undefined ? null : (
						<MetricField label={securityPoolCopy.priceValidUntil}>
							<TimestampValue timestamp={priceValidUntilTimestamp} />
						</MetricField>
					)}
				</div>
			</div>
		)

	return (
		<div className={['vault-detail-stage', className].filter(Boolean).join(' ')}>
			<div className='vault-detail-hero'>
				<VaultPrimaryMetric className='vault-detail-hero-primary' label={commonCopy.capacityOwnershipAttoRep} value={capacityOwnershipAttoRep} suffix={commonCopy.rep} />
				<div className='vault-detail-hero-secondary'>
					<VaultPrimaryMetric label={commonCopy.poolHeldVaultRepBackingAttoRep} value={vaultAttoRepBacking} suffix={commonCopy.rep} />
				</div>
			</div>
			<div className='vault-detail-meta'>
				<p className='detail'>{securityPoolCopy.vaultCoverageDetail}</p>
				{badDebtAttoEth === undefined ? undefined : (
					<MetricField label={securityPoolCopy.badDebt}>
						<CurrencyValue value={badDebtAttoEth} suffix={commonCopy.eth} />
					</MetricField>
				)}
				{disputeStakedAttoRep === undefined ? undefined : (
					<MetricField label={commonCopy.disputeStakedAttoRep}>
						<CurrencyValue value={disputeStakedAttoRep} suffix={commonCopy.rep} />
					</MetricField>
				)}
				{priceValidUntilTimestamp === undefined ? undefined : (
					<MetricField label={securityPoolCopy.priceValidUntil}>
						<TimestampValue timestamp={priceValidUntilTimestamp} />
					</MetricField>
				)}
			</div>
		</div>
	)
}
