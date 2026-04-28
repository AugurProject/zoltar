import { CurrencyValue } from './CurrencyValue.js'
import { MetricField } from './MetricField.js'
import { hasRepBackedPoolWithNoActiveAllowance } from '../lib/trading.js'

type OpenInterestCapacityMetricsProps = {
	completeSetCollateralAmount: bigint | undefined
	totalRepDeposit: bigint | undefined
	totalSecurityBondAllowance: bigint | undefined
}

export function OpenInterestCapacityMetrics({ completeSetCollateralAmount, totalRepDeposit, totalSecurityBondAllowance }: OpenInterestCapacityMetricsProps) {
	const maxCapacityBadge = hasRepBackedPoolWithNoActiveAllowance(totalRepDeposit, totalSecurityBondAllowance) ? (
		<span className='badge muted' title='REP is deposited in the pool, but the vaults have not set any active security bond allowance.'>
			No active allowances
		</span>
	) : undefined

	return (
		<MetricField label='Open Interest Minted / Max'>
			<CurrencyValue value={completeSetCollateralAmount} suffix='ETH' /> / <CurrencyValue value={totalSecurityBondAllowance} suffix='ETH' /> {maxCapacityBadge}
		</MetricField>
	)
}
