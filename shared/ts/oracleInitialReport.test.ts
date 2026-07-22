import { describe, expect, test } from 'bun:test'
import { DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS, ORACLE_PERCENTAGE_PRECISION, calculateOracleMinimumWethReport } from '@zoltar/shared/oracleInitialReport'

describe('oracle initial report sizing', () => {
	test('uses configured gas-price and inclusion floors when the current base fee is zero', () => {
		expect(calculateOracleMinimumWethReport()).toBe(1076923076923076924n)
	})

	test('sizes WETH so a five-percent correction earns ten times the dispute gas cost by default', () => {
		const baseFeeWeiPerGas = 30n * 10n ** 9n
		const minimumWethReport = calculateOracleMinimumWethReport({
			...DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS,
			baseFeeWeiPerGas,
		})
		const feeSum = BigInt(DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS.openOracleProtocolFee + DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS.openOracleReporterFee)
		const correctionProfitWei = (minimumWethReport * (DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS.targetPriceErrorForDispute - feeSum)) / (ORACLE_PERCENTAGE_PRECISION + DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS.targetPriceErrorForDispute)
		const modeledGasPrice = baseFeeWeiPerGas + (DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS.minimumPriorityFeeWei ?? 0n)
		const bufferedGasCostWei = ((DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS.gasUnitsForOneDispute * modeledGasPrice + (DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS.absoluteInclusionPremiumWei ?? 0n)) * DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS.openOracleSecurityMultiplierBps) / 10000n

		expect(minimumWethReport).toBe(2853846153846153847n)
		expect(correctionProfitWei).toBeGreaterThanOrEqual(bufferedGasCostWei)
	})

	test('keeps upward and downward wrong-price correction capacities in their native tokens', () => {
		const amount1Weth = 1n * 10n ** 18n
		const amount2Rep = 10n * 10n ** 18n
		const targetError = DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS.targetPriceErrorForDispute
		const feeSum = BigInt(DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS.openOracleProtocolFee + DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS.openOracleReporterFee)
		const profitNumerator = targetError - feeSum
		const profitDenominator = ORACLE_PERCENTAGE_PRECISION + targetError
		const availableWeth = (amount1Weth * profitNumerator) / profitDenominator
		const availableRep = (amount2Rep * profitNumerator) / profitDenominator

		// A report below truth produces WETH-native correction value.
		expect(availableWeth).toBe(37142857142857142n)
		// A report above truth produces REP-native correction value. At the boundary
		// reportedPrice = (1 + error) * truePrice, its true-price WETH value is at
		// least the deliberately conservative WETH capacity despite integer floors.
		expect(availableRep).toBe(371428571428571428n)
		expect(availableRep * amount1Weth * profitDenominator).toBeGreaterThanOrEqual(availableWeth * amount2Rep * ORACLE_PERCENTAGE_PRECISION)
	})

	test('allows deployments to tune the target correction error', () => {
		expect(
			calculateOracleMinimumWethReport({
				...DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS,
				baseFeeWeiPerGas: 30n * 10n ** 9n,
				openOracleSecurityMultiplierBps: 100000n,
				targetPriceErrorForDispute: 1000000n,
			}),
		).toBe(1310112359550561798n)
	})

	test('rounds up fractional WETH report sizes', () => {
		expect(
			calculateOracleMinimumWethReport({
				baseFeeWeiPerGas: 1n,
				gasUnitsForOneDispute: 1n,
				openOracleProtocolFee: 0,
				openOracleReporterFee: 0,
				openOracleSecurityMultiplierBps: 10000n,
				targetPriceErrorForDispute: ORACLE_PERCENTAGE_PRECISION,
				minimumTotalGasPriceWei: 0n,
				minimumPriorityFeeWei: 0n,
				absoluteInclusionPremiumWei: 0n,
				absoluteMinimumWethReport: 0n,
			}),
		).toBe(2n)
	})

	test('rejects fees that eliminate the target correction profit', () => {
		expect(() =>
			calculateOracleMinimumWethReport({
				...DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS,
				targetPriceErrorForDispute: 100000n,
			}),
		).toThrow('Cannot divide by zero or a negative denominator')
	})
})
