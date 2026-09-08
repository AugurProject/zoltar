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
				<CurrencyValue exactWhenRoundedToZero value={value} suffix={suffix} />
			</strong>
		</div>
	)
}

function formatRepPerCapacityBps(value: bigint) {
	const whole = value / 10_000n
	const fraction = (value % 10_000n).toString().padStart(4, '0').replace(/0+$/, '')
	return `${whole.toString()}${fraction === '' ? '' : `.${fraction}`}×`
}

function getAssociatedRepToneClass({ associatedRepPerCapacityBps, isCurrentlyHealthy, selectedPoolStatoblastSecurityMultiplierBps }: { associatedRepPerCapacityBps: bigint | undefined; isCurrentlyHealthy: boolean | undefined; selectedPoolStatoblastSecurityMultiplierBps: bigint | undefined }) {
	if (isCurrentlyHealthy === false) return 'metric-value-danger'
	if (isCurrentlyHealthy !== true) return undefined
	if (associatedRepPerCapacityBps === undefined || selectedPoolStatoblastSecurityMultiplierBps === undefined) return 'metric-value-success'
	if (associatedRepPerCapacityBps <= (selectedPoolStatoblastSecurityMultiplierBps * 105n) / 100n) return 'metric-value-warning'
	return 'metric-value-success'
}

function getAssociatedRepStatusLabel({ associatedRepPerCapacityBps, isCurrentlyHealthy, selectedPoolStatoblastSecurityMultiplierBps }: { associatedRepPerCapacityBps: bigint | undefined; isCurrentlyHealthy: boolean | undefined; selectedPoolStatoblastSecurityMultiplierBps: bigint | undefined }) {
	if (isCurrentlyHealthy === false) return securityPoolCopy.vaultHealthUnderwater
	if (isCurrentlyHealthy !== true) return undefined
	if (associatedRepPerCapacityBps === undefined || selectedPoolStatoblastSecurityMultiplierBps === undefined) return securityPoolCopy.vaultHealthHealthy
	if (associatedRepPerCapacityBps <= (selectedPoolStatoblastSecurityMultiplierBps * 105n) / 100n) return securityPoolCopy.vaultHealthNearMinimum
	return securityPoolCopy.vaultHealthHealthy
}

export function VaultMetricGrid({
	associatedRepPerCapacityBps,
	badDebtAttoEth,
	className = '',
	layout = 'grid',
	disputeStakedAttoRep,
	isCurrentlyHealthy,
	poolHeldRepPerCapacityBps: _poolHeldRepPerCapacityBps,
	priceValidUntilTimestamp,
	vaultAttoRepBacking,
	selectedPoolStatoblastSecurityMultiplierBps,
	capacityOwnershipAttoRep,
}: VaultMetricGridProps) {
	const associatedRepToneClass = getAssociatedRepToneClass({
		associatedRepPerCapacityBps,
		isCurrentlyHealthy,
		selectedPoolStatoblastSecurityMultiplierBps,
	})
	const associatedRepStatusLabel = getAssociatedRepStatusLabel({
		associatedRepPerCapacityBps,
		isCurrentlyHealthy,
		selectedPoolStatoblastSecurityMultiplierBps,
	})

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
							<CurrencyValue exactWhenRoundedToZero value={badDebtAttoEth} suffix={commonCopy.eth} />
						</MetricField>
					) : null}
					{disputeStakedAttoRep === undefined ? null : (
						<MetricField label={commonCopy.disputeStakedAttoRep}>
							<CurrencyValue exactWhenRoundedToZero value={disputeStakedAttoRep} suffix={commonCopy.rep} />
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
				{associatedRepPerCapacityBps === undefined ? undefined : (
					<MetricField label={securityPoolCopy.associatedRepPerCapacity} valueClassName={associatedRepToneClass}>
						<span className='metric-inline-value'>
							<span>{formatRepPerCapacityBps(associatedRepPerCapacityBps)}</span>
							{associatedRepStatusLabel === undefined ? undefined : <span className='metric-inline-status'>{associatedRepStatusLabel}</span>}
						</span>
					</MetricField>
				)}
				{badDebtAttoEth === undefined ? undefined : (
					<MetricField label={securityPoolCopy.badDebt}>
						<CurrencyValue exactWhenRoundedToZero value={badDebtAttoEth} suffix={commonCopy.eth} />
					</MetricField>
				)}
				{disputeStakedAttoRep === undefined ? undefined : (
					<MetricField label={commonCopy.disputeStakedAttoRep}>
						<CurrencyValue exactWhenRoundedToZero value={disputeStakedAttoRep} suffix={commonCopy.rep} />
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
