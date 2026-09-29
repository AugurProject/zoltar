import * as workspaceCopy from '../../../copy/poolWorkspace.js'
import { VaultExposureValue } from './VaultExposureValue.js'
import { RepPriceStatusLabel } from './RepPriceStatusLabel.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import { formatMultiplier } from '@zoltar/ui-core-shared/lib/formatters.js'
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

function BadDebtMetric({ value, valueClassName }: { value: bigint; valueClassName?: string }) {
	return (
		<MetricField label={securityPoolCopy.badDebt} valueClassName={valueClassName}>
			<CurrencyValue exactWhenRoundedToZero value={value} suffix={commonCopy.eth} />
		</MetricField>
	)
}

function DisputeStakedMetric({ value }: { value: bigint }) {
	return (
		<MetricField label={commonCopy.disputeStakedAttoRep}>
			<CurrencyValue exactWhenRoundedToZero value={value} suffix={commonCopy.rep} />
		</MetricField>
	)
}

function PriceValidUntilMetric({ timestamp }: { timestamp: bigint }) {
	return (
		<MetricField label={securityPoolCopy.priceValidUntil}>
			<TimestampValue timestamp={timestamp} />
		</MetricField>
	)
}

function getAssociatedRepHealth({ associatedRepPerCapacityBps, isCurrentlyHealthy, selectedPoolStatoblastSecurityMultiplierBps }: { associatedRepPerCapacityBps: bigint | undefined; isCurrentlyHealthy: boolean | undefined; selectedPoolStatoblastSecurityMultiplierBps: bigint | undefined }) {
	if (isCurrentlyHealthy === false) return { statusLabel: securityPoolCopy.vaultHealthUnderwater, toneClass: 'metric-value-danger' }
	if (isCurrentlyHealthy !== true) return { statusLabel: undefined, toneClass: undefined }
	if (associatedRepPerCapacityBps !== undefined && selectedPoolStatoblastSecurityMultiplierBps !== undefined && associatedRepPerCapacityBps <= (selectedPoolStatoblastSecurityMultiplierBps * 105n) / 100n) return { statusLabel: securityPoolCopy.vaultHealthNearMinimum, toneClass: 'metric-value-warning' }
	return { statusLabel: securityPoolCopy.vaultHealthHealthy, toneClass: 'metric-value-success' }
}

export function VaultMetricGrid({
	openInterestAttoEth,
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
	underwritingLimitAttoEth,
}: VaultMetricGridProps) {
	const { statusLabel: associatedRepStatusLabel, toneClass: associatedRepToneClass } = getAssociatedRepHealth({
		associatedRepPerCapacityBps,
		isCurrentlyHealthy,
		selectedPoolStatoblastSecurityMultiplierBps,
	})

	if (layout === 'preview')
		return (
			<div className={['vault-preview-strip', className].filter(Boolean).join(' ')}>
				<div className='vault-preview-strip-head'>
					<div className='vault-preview-capacity-ownership'>
						<span>{securityPoolCopy.exposureSupported}</span>
						<strong>
							<VaultExposureValue capacity={underwritingLimitAttoEth} />
						</strong>
					</div>
				</div>
				<div className='vault-preview-side-metrics'>
					<VaultPrimaryMetric label={commonCopy.poolHeldVaultRepBackingAttoRep} value={vaultAttoRepBacking} suffix={commonCopy.rep} />
				</div>
				<div className='vault-preview-meta'>
					{badDebtAttoEth !== undefined && badDebtAttoEth > 0n ? <BadDebtMetric value={badDebtAttoEth} /> : undefined}
					{disputeStakedAttoRep === undefined ? undefined : <DisputeStakedMetric value={disputeStakedAttoRep} />}
					{priceValidUntilTimestamp === undefined ? undefined : <PriceValidUntilMetric timestamp={priceValidUntilTimestamp} />}
				</div>
			</div>
		)

	return (
		<div className={['vault-detail-stage', className].filter(Boolean).join(' ')}>
			<div className='vault-health-status'>
				<p className={`vault-health ${associatedRepToneClass ?? ''}`}>{associatedRepStatusLabel ?? workspaceCopy.healthUnknown}</p>
				<RepPriceStatusLabel />
			</div>
			<div className='vault-detail-hero'>
				<div className='vault-detail-hero-primary'>
					<span>{securityPoolCopy.exposureSupported}</span>
					<strong>
						<VaultExposureValue capacity={underwritingLimitAttoEth} />
					</strong>
				</div>
				<div className='vault-detail-hero-secondary'>
					<VaultPrimaryMetric label={commonCopy.poolHeldVaultRepBackingAttoRep} value={vaultAttoRepBacking} suffix={commonCopy.rep} />
				</div>
			</div>
			<div className='vault-risk-summary'>
				{badDebtAttoEth !== undefined && badDebtAttoEth > 0n ? <BadDebtMetric value={badDebtAttoEth} valueClassName='metric-value-danger' /> : undefined}
				{disputeStakedAttoRep !== undefined && disputeStakedAttoRep > 0n ? <DisputeStakedMetric value={disputeStakedAttoRep} /> : undefined}
			</div>
			<details className='vault-backing-details'>
				<summary>{workspaceCopy.backingDetails}</summary>
				<MetricField label={securityPoolCopy.currentProportionalObligation}>
					<CurrencyValue value={openInterestAttoEth} suffix={commonCopy.eth} />
				</MetricField>
				<div className='vault-detail-meta'>
					{associatedRepPerCapacityBps === undefined ? undefined : (
						<MetricField label={securityPoolCopy.associatedRepPerCapacity} valueClassName={associatedRepToneClass}>
							<span className='metric-inline-value'>
								<span>{formatMultiplier(associatedRepPerCapacityBps, 4)}</span>
								{associatedRepStatusLabel === undefined ? undefined : <span className='metric-inline-status'>{associatedRepStatusLabel}</span>}
							</span>
						</MetricField>
					)}
					{badDebtAttoEth === undefined || badDebtAttoEth > 0n ? undefined : <BadDebtMetric value={badDebtAttoEth} />}
					{disputeStakedAttoRep === undefined || disputeStakedAttoRep > 0n ? undefined : <DisputeStakedMetric value={disputeStakedAttoRep} />}
					{priceValidUntilTimestamp === undefined ? undefined : <PriceValidUntilMetric timestamp={priceValidUntilTimestamp} />}
				</div>
			</details>
		</div>
	)
}
