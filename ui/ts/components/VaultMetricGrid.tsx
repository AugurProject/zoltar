import { ApprovedAmountValue } from './ApprovedAmountValue.js'
import { CollateralizationMetricField } from './CollateralizationMetricField.js'
import { CurrencyValue } from './CurrencyValue.js'
import { MetricField } from './MetricField.js'
import { TimestampValue } from './TimestampValue.js'
import type { VaultMetricGridProps } from '../types/components.js'
import { getVaultCollateralizationPercent } from '../lib/trading.js'

export function VaultMetricGrid({ approvedRep, className = '', lockedRepInEscalationGame, priceValidUntilTimestamp, repDepositShare, repPerEthPrice, repPerEthSource, repPerEthSourceUrl, selectedPoolSecurityMultiplier, securityBondAllowance, unpaidEthFees, variant = 'record' }: VaultMetricGridProps) {
	const gridClassName = variant === 'embedded' ? 'workflow-metric-grid' : 'entity-metric-grid'
	const metricClassName = variant === 'embedded' ? undefined : 'entity-metric'

	return (
		<div className={[gridClassName, className].filter(Boolean).join(' ')}>
			<MetricField className={metricClassName} label='REP Collateral'>
				<CurrencyValue value={repDepositShare} suffix='REP' />
			</MetricField>
			{approvedRep === undefined ? undefined : (
				<MetricField className={metricClassName} label='Approved REP'>
					<ApprovedAmountValue loading={approvedRep.loading} value={approvedRep.value} suffix='REP' />
				</MetricField>
			)}
			<MetricField className={metricClassName} label='Security Bond Allowance'>
				<CurrencyValue value={securityBondAllowance} suffix='ETH' />
			</MetricField>
			<CollateralizationMetricField
				className={metricClassName}
				collateralizationPercent={getVaultCollateralizationPercent(repDepositShare, securityBondAllowance, repPerEthPrice)}
				repPerEthSource={repPerEthSource}
				repPerEthSourceUrl={repPerEthSourceUrl}
				securityBondAllowance={securityBondAllowance}
				securityMultiplier={selectedPoolSecurityMultiplier}
			/>
			<MetricField className={metricClassName} label='Unpaid ETH Fees'>
				<CurrencyValue value={unpaidEthFees} suffix='ETH' />
			</MetricField>
			{lockedRepInEscalationGame === undefined ? undefined : (
				<MetricField className={metricClassName} label='Locked REP'>
					<CurrencyValue value={lockedRepInEscalationGame} suffix='REP' />
				</MetricField>
			)}
			{priceValidUntilTimestamp === undefined ? undefined : (
				<MetricField className={metricClassName} label='Price Valid Until'>
					<TimestampValue timestamp={priceValidUntilTimestamp} />
				</MetricField>
			)}
		</div>
	)
}
