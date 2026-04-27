import { CurrencyValue } from './CurrencyValue.js'
import { MetricField } from './MetricField.js'
import { getRemainingMintCapacity } from '../lib/trading.js'

type OpenInterestCapacityMetricsProps = {
	completeSetCollateralAmount: bigint | undefined
	totalSecurityBondAllowance: bigint | undefined
}

export function OpenInterestCapacityMetrics({ completeSetCollateralAmount, totalSecurityBondAllowance }: OpenInterestCapacityMetricsProps) {
	return (
		<>
			<MetricField label='Open Interest Minted / Max'>
				<CurrencyValue value={completeSetCollateralAmount} suffix='ETH' /> / <CurrencyValue value={totalSecurityBondAllowance} suffix='ETH' />
			</MetricField>
			<MetricField label='Remaining Mint Capacity'>
				<CurrencyValue value={getRemainingMintCapacity(totalSecurityBondAllowance, completeSetCollateralAmount)} suffix='ETH' />
			</MetricField>
		</>
	)
}
