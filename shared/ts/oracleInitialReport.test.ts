import { describe, expect, test } from 'bun:test'
import { DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS, MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_WEI_PER_GAS, ORACLE_ESCALATION_HALT_MULTIPLIER_BPS, ORACLE_PERCENTAGE_PRECISION, calculateMaximumOracleInitialReportPriorityFeeWeiPerGas, calculateOracleMinimumWethReport } from '@zoltar/shared/oracleInitialReport'

describe('oracle initial report sizing', () => {
	test('uses the configured priority-fee report when the current base fee and open interest are zero', () => {
		expect(calculateOracleMinimumWethReport()).toBe(807692307692307693n)
	})

	test('adds priority-fee security to the base-fee-dependent report', () => {
		const baseFeeWeiPerGas = 30n * 10n ** 9n
		const minimumWethReport = calculateOracleMinimumWethReport({
			...DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS,
			baseFeeWeiPerGas,
		})
		const feeSum = BigInt(DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS.openOracleProtocolFee + DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS.openOracleReporterFee)
		const correctionProfitWei = (minimumWethReport * (DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS.targetPriceErrorForDispute - feeSum)) / (ORACLE_PERCENTAGE_PRECISION + DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS.targetPriceErrorForDispute)
		const effectiveGasPriceWeiPerGas = baseFeeWeiPerGas + DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS.initialReportPriorityFeeWeiPerGas
		const bufferedGasCostWei = (DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS.gasUnitsForOneDispute * effectiveGasPriceWeiPerGas * DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS.openOracleSecurityMultiplierBps) / 10000n

		expect(minimumWethReport).toBe(3230769230769230770n)
		expect(correctionProfitWei).toBeGreaterThanOrEqual(bufferedGasCostWei)
	})

	test('adds priority-fee security to the larger open-interest-dependent report', () => {
		expect(
			calculateOracleMinimumWethReport({
				...DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS,
				baseFeeWeiPerGas: 30n * 10n ** 9n,
				openInterestWei: 500n * 10n ** 18n,
			}),
		).toBe(5807692307692307693n)
	})

	test('allows deployments to tune the target correction error', () => {
		expect(
			calculateOracleMinimumWethReport({
				...DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS,
				baseFeeWeiPerGas: 30n * 10n ** 9n,
				openOracleSecurityMultiplierBps: 100000n,
				targetPriceErrorForDispute: 1000000n,
			}),
		).toBe(1483146067415730338n)
	})

	test('rounds up fractional WETH report sizes', () => {
		expect(
			calculateOracleMinimumWethReport({
				baseFeeWeiPerGas: 1n,
				gasUnitsForOneDispute: 1n,
				initialReportPriorityFeeWeiPerGas: 0n,
				openInterestWei: 0n,
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

	test('caps the immutable priority fee so its report and escalation halt fit uint128', () => {
		const uint128Max = (1n << 128n) - 1n
		const maximumReport = calculateOracleMinimumWethReport({
			...DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS,
			initialReportPriorityFeeWeiPerGas: MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_WEI_PER_GAS,
		})
		const firstInvalidReport = calculateOracleMinimumWethReport({
			...DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS,
			initialReportPriorityFeeWeiPerGas: MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_WEI_PER_GAS + 1n,
		})

		expect(calculateMaximumOracleInitialReportPriorityFeeWeiPerGas()).toBe(MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_WEI_PER_GAS)
		expect(maximumReport).toBeLessThanOrEqual(uint128Max)
		expect((maximumReport * ORACLE_ESCALATION_HALT_MULTIPLIER_BPS) / 10000n).toBeLessThanOrEqual(uint128Max / 2n)
		expect(firstInvalidReport).toBeGreaterThan(maximumReport)
	})
})
