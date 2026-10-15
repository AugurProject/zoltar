import * as workspaceCopy from '../../../copy/poolWorkspace.js'
import { VaultExposureValue } from './VaultExposureValue.js'
import { RepPriceStatusLabel } from './RepPriceStatusLabel.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import { formatMultiplier } from '@zoltar/ui-core-shared/lib/formatters.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import type { VaultMetricGridProps } from '../../types.js'
import type { VaultHealthTier } from '../lib/vaultHealth.js'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'

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

/** The badge tone, verdict, and value tone for a vault health tier; an unknown tier has no verdict. */
export function getVaultHealthPresentation(tier: VaultHealthTier) {
	switch (tier) {
		case 'underwater':
			return { badgeTone: 'danger' as const, statusLabel: securityPoolCopy.vaultHealthUnderwater, toneClass: 'metric-value-danger' }
		case 'nearMinimum':
			return { badgeTone: 'warning' as const, statusLabel: securityPoolCopy.vaultHealthNearMinimum, toneClass: 'metric-value-warning' }
		case 'healthy':
			return { badgeTone: 'ok' as const, statusLabel: securityPoolCopy.vaultHealthHealthy, toneClass: 'metric-value-success' }
		case 'unknown':
			return { badgeTone: 'muted' as const, statusLabel: undefined, toneClass: undefined }
		default:
			return assertNever(tier)
	}
}

export function VaultMetricGrid({
	openInterestAttoEth,
	associatedRepPerCapacityBps,
	badDebtAttoEth,
	className = '',
	layout = 'grid',
	disputeStakedAttoRep,
	healthTier,
	poolEnded = false,
	poolHeldRepPerCapacityBps: _poolHeldRepPerCapacityBps,
	priceValidUntilTimestamp,
	vaultAttoRepBacking,
	underwritingLimitAttoEth,
}: VaultMetricGridProps) {
	const { badgeTone: healthBadgeTone, statusLabel: associatedRepStatusLabel, toneClass: associatedRepToneClass } = getVaultHealthPresentation(healthTier)

	// The directory preview is one flat metric row, so every figure shares the grid's label, value size, and baseline.
	// The backing ratio carries the health tone (the row's badge names the verdict); a zero dispute stake is left out.
	if (layout === 'preview')
		return (
			<div className={['vault-preview-strip', className].filter(Boolean).join(' ')}>
				<MetricField label={securityPoolCopy.commitmentLimit}>
					<VaultExposureValue capacity={underwritingLimitAttoEth} />
				</MetricField>
				<MetricField label={commonCopy.poolHeldVaultRepBackingAttoRep}>
					<CurrencyValue exactWhenRoundedToZero value={vaultAttoRepBacking} suffix={commonCopy.rep} />
				</MetricField>
				{associatedRepPerCapacityBps === undefined ? undefined : (
					<MetricField label={securityPoolCopy.associatedRepPerCapacity} valueClassName={associatedRepToneClass}>
						{formatMultiplier(associatedRepPerCapacityBps, 4)}
					</MetricField>
				)}
				{disputeStakedAttoRep === undefined || disputeStakedAttoRep === 0n ? undefined : <DisputeStakedMetric value={disputeStakedAttoRep} />}
				{badDebtAttoEth !== undefined && badDebtAttoEth > 0n ? <BadDebtMetric value={badDebtAttoEth} valueClassName='metric-value-danger' /> : undefined}
				{priceValidUntilTimestamp === undefined ? undefined : <PriceValidUntilMetric timestamp={priceValidUntilTimestamp} />}
			</div>
		)

	return (
		<div className={['vault-detail-stage', className].filter(Boolean).join(' ')}>
			{poolEnded ? undefined : (
				<div className='vault-health-status'>
					<Badge className='vault-health' tone={healthBadgeTone}>
						{associatedRepStatusLabel ?? workspaceCopy.healthUnknown}
					</Badge>
					<RepPriceStatusLabel />
				</div>
			)}
			<div className='vault-detail-hero'>
				<div className='vault-detail-hero-primary'>
					<span>{securityPoolCopy.commitmentLimit}</span>
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
