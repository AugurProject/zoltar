import * as commonCopy from '../../../copy/common.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import { CurrencyValue } from '../../../components/CurrencyValue.js'
import { MetricField } from '../../../components/MetricField.js'
import { TimestampValue } from '../../../components/TimestampValue.js'
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

export function VaultMetricGrid({ className = '', layout = 'grid', escalationEscrowedRep, priceValidUntilTimestamp, repDepositShare, securityBondAllowance }: VaultMetricGridProps) {
	if (layout === 'preview')
		return (
			<div className={['vault-preview-strip', className].filter(Boolean).join(' ')}>
				<div className='vault-preview-strip-head'>
					<VaultPrimaryMetric className='vault-preview-allowance' label={commonCopy.securityBondAllowance} value={securityBondAllowance} suffix={commonCopy.eth} />
				</div>
				<div className='vault-preview-side-metrics'>
					<VaultPrimaryMetric label={commonCopy.freeRep} value={repDepositShare} suffix={commonCopy.rep} />
				</div>
				<div className='vault-preview-meta'>
					{escalationEscrowedRep === undefined ? null : (
						<MetricField label={commonCopy.escalationRep}>
							<CurrencyValue value={escalationEscrowedRep} suffix={commonCopy.rep} />
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
				<VaultPrimaryMetric className='vault-detail-hero-primary' label={commonCopy.securityBondAllowance} value={securityBondAllowance} suffix={commonCopy.eth} />
				<div className='vault-detail-hero-secondary'>
					<VaultPrimaryMetric label={commonCopy.freeRep} value={repDepositShare} suffix={commonCopy.rep} />
				</div>
			</div>
			<div className='vault-detail-meta'>
				<p className='detail'>{securityPoolCopy.vaultCoverageDetail}</p>
				{escalationEscrowedRep === undefined ? undefined : (
					<MetricField label={commonCopy.escalationRep}>
						<CurrencyValue value={escalationEscrowedRep} suffix={commonCopy.rep} />
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
