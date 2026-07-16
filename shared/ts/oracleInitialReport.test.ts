import { describe, expect, test } from 'bun:test'
import { DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS, ORACLE_PERCENTAGE_PRECISION, calculateOracleMinimumWethReport } from '@zoltar/shared/oracleInitialReport'

describe('oracle initial report sizing', () => {
	test('uses the OpenOracle non-zero minimum when the current base fee is zero', () => {
		expect(calculateOracleMinimumWethReport()).toBe(1n)
	})

	test('sizes WETH so a five-percent correction earns ten times the dispute gas cost by default', () => {
		const baseFeeWeiPerGas = 30n * 10n ** 9n
		const minimumWethReport = calculateOracleMinimumWethReport({
			...DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS,
			baseFeeWeiPerGas,
		})
		const feeSum = BigInt(DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS.openOracleProtocolFee + DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS.openOracleReporterFee)
		const correctionProfitWei = (minimumWethReport * (DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS.targetPriceErrorForDispute - feeSum)) / (ORACLE_PERCENTAGE_PRECISION + DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS.targetPriceErrorForDispute)
		const bufferedGasCostWei = (DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS.gasUnitsForOneDispute * baseFeeWeiPerGas * DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS.openOracleSecurityMultiplierBps) / 10000n

		expect(minimumWethReport).toBe(2423076923076923077n)
		expect(correctionProfitWei).toBeGreaterThanOrEqual(bufferedGasCostWei)
	})

	test('allows deployments to tune the target correction error', () => {
		expect(
			calculateOracleMinimumWethReport({
				...DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS,
				baseFeeWeiPerGas: 30n * 10n ** 9n,
				openOracleSecurityMultiplierBps: 100000n,
				targetPriceErrorForDispute: 1000000n,
			}),
		).toBe(1112359550561797753n)
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
