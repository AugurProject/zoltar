import { CollateralizationMetricField } from './CollateralizationMetricField.js'
import { CurrencyValue } from './CurrencyValue.js'
import { MetricField } from './MetricField.js'
import { getPoolCollateralizationPercent } from '../lib/trading.js'

type OpenInterestCapacityMetricsProps = {
	completeSetCollateralAmount: bigint | undefined
	repEthPrice: bigint | undefined
	repEthSource: 'v4' | 'v3' | undefined
	repEthSourceUrl: string | undefined
	securityMultiplier: bigint | undefined
	totalRepDeposit: bigint | undefined
	totalSecurityBondAllowance: bigint | undefined
}

export function OpenInterestCapacityMetrics({ completeSetCollateralAmount, repEthPrice, repEthSource, repEthSourceUrl, securityMultiplier, totalRepDeposit, totalSecurityBondAllowance }: OpenInterestCapacityMetricsProps) {
	const collateralizationPercent = getPoolCollateralizationPercent(totalRepDeposit, totalSecurityBondAllowance, repEthPrice)

	return (
		<>
			<MetricField label='Open Interest Minted / Max'>
				<CurrencyValue value={completeSetCollateralAmount} suffix='ETH' /> / <CurrencyValue value={totalSecurityBondAllowance} suffix='ETH' />
			</MetricField>
			<CollateralizationMetricField collateralizationPercent={collateralizationPercent} repEthSource={repEthSource} repEthSourceUrl={repEthSourceUrl} securityBondAllowance={totalSecurityBondAllowance} securityMultiplier={securityMultiplier} />
		</>
	)
}
