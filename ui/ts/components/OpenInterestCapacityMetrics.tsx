import { CollateralizationMetricField } from './CollateralizationMetricField.js'
import { CurrencyValue } from './CurrencyValue.js'
import { MetricField } from './MetricField.js'
import { getPoolCollateralizationPercent } from '../lib/trading.js'

type OpenInterestCapacityMetricsProps = {
	completeSetCollateralAmount: bigint | undefined
	repPerEthPrice: bigint | undefined
	repPerEthSource: 'v4' | 'v3' | undefined
	repPerEthSourceUrl: string | undefined
	securityMultiplier: bigint | undefined
	totalRepDeposit: bigint | undefined
	totalSecurityBondAllowance: bigint | undefined
}

export function OpenInterestCapacityMetrics({ completeSetCollateralAmount, repPerEthPrice, repPerEthSource, repPerEthSourceUrl, securityMultiplier, totalRepDeposit, totalSecurityBondAllowance }: OpenInterestCapacityMetricsProps) {
	const collateralizationPercent = getPoolCollateralizationPercent(totalRepDeposit, totalSecurityBondAllowance, repPerEthPrice)

	return (
		<>
			<MetricField label='Open Interest Minted / Max'>
				<CurrencyValue value={completeSetCollateralAmount} suffix='ETH' /> / <CurrencyValue value={totalSecurityBondAllowance} suffix='ETH' />
			</MetricField>
			<CollateralizationMetricField collateralizationPercent={collateralizationPercent} repPerEthSource={repPerEthSource} repPerEthSourceUrl={repPerEthSourceUrl} securityBondAllowance={totalSecurityBondAllowance} securityMultiplier={securityMultiplier} />
		</>
	)
}
