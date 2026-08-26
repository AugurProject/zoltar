import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
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

function formatRepPerCapacityBps(value: bigint) {
	const whole = value / 10_000n
	const fraction = (value % 10_000n).toString().padStart(4, '0').replace(/0+$/, '')
	return `${whole.toString()}${fraction === '' ? '' : `.${fraction}`}×`
}

function getVaultHealthLabel(isCurrentlyHealthy: boolean | undefined) {
	if (isCurrentlyHealthy === undefined) return commonCopy.unavailable
	return isCurrentlyHealthy ? securityPoolCopy.healthy : securityPoolCopy.unhealthy
}

export function VaultMetricGrid({ associatedRepPerCapacityBps, badDebtAttoEth, className = '', layout = 'grid', disputeStakedAttoRep, isCurrentlyHealthy, poolHeldRepPerCapacityBps, priceValidUntilTimestamp, vaultAttoRepBacking, capacityOwnershipAttoRep }: VaultMetricGridProps) {
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
				{associatedRepPerCapacityBps === undefined ? undefined : <MetricField label={securityPoolCopy.associatedRepPerCapacity}>{formatRepPerCapacityBps(associatedRepPerCapacityBps)}</MetricField>}
				{poolHeldRepPerCapacityBps === undefined ? undefined : <MetricField label={securityPoolCopy.poolHeldRepPerCapacity}>{formatRepPerCapacityBps(poolHeldRepPerCapacityBps)}</MetricField>}
				{associatedRepPerCapacityBps === undefined ? undefined : <MetricField label={securityPoolCopy.currentVaultHealth}>{getVaultHealthLabel(isCurrentlyHealthy)}</MetricField>}
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
