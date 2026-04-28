import { CurrencyValue } from './CurrencyValue.js'
import { MetricField } from './MetricField.js'
import { getAllowanceBackedRep } from '../lib/trading.js'

type OpenInterestCapacityMetricsProps = {
	completeSetCollateralAmount: bigint | undefined
	lastOraclePrice: bigint | undefined
	totalRepDeposit: bigint | undefined
	totalSecurityBondAllowance: bigint | undefined
}

export function OpenInterestCapacityMetrics({ completeSetCollateralAmount, lastOraclePrice, totalRepDeposit, totalSecurityBondAllowance }: OpenInterestCapacityMetricsProps) {
	const allowanceBackedRep = getAllowanceBackedRep(totalSecurityBondAllowance, lastOraclePrice)

	return (
		<>
			<MetricField label='Open Interest Minted / Max'>
				<CurrencyValue value={completeSetCollateralAmount} suffix='ETH' /> / <CurrencyValue value={totalSecurityBondAllowance} suffix='ETH' />
			</MetricField>
			<MetricField label={<span title='Uses the most recent settled oracle price.'>Allowance * Last Oracle / REP Deposit</span>}>
				<CurrencyValue value={allowanceBackedRep} suffix='REP' /> / <CurrencyValue value={totalRepDeposit} suffix='REP' />
			</MetricField>
		</>
	)
}
