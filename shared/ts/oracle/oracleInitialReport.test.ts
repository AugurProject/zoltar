import { describe, expect, test } from 'bun:test'
import {
	DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS,
	MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS,
	ORACLE_ESCALATION_HALT_MULTIPLIER_BPS,
	ORACLE_PERCENTAGE_PRECISION,
	calculateMaximumOracleInitialReportPriorityFeeAttoEthPerGas,
	calculateOracleMinimumWethReportAttoEth,
} from '@zoltar/shared/oracleInitialReport'

describe('oracle initial report sizing', () => {
	test('uses the configured priority-fee report when the current base fee and open interest are zero', () => {
		expect(calculateOracleMinimumWethReportAttoEth()).toBe(807692307692307693n)
	})

	test('adds priority-fee security to the base-fee-dependent report', () => {
		const baseFeeAttoEthPerGas = 30n * 10n ** 9n
		const minimumWethReport = calculateOracleMinimumWethReportAttoEth({
			...DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS,
			baseFeeAttoEthPerGas,
		})
		const feeSum = BigInt(DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS.openOracleProtocolFee + DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS.openOracleReporterFee)
		const correctionProfitAttoEth = (minimumWethReport * (DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS.targetPriceErrorForDispute - feeSum)) / (ORACLE_PERCENTAGE_PRECISION + DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS.targetPriceErrorForDispute)
		const effectiveGasPriceAttoEthPerGas = baseFeeAttoEthPerGas + DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS.initialReportPriorityFeeAttoEthPerGas
		const bufferedGasCostAttoEth = (DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS.gasUnitsForOneDispute * effectiveGasPriceAttoEthPerGas * DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS.openOracleSecurityMultiplierBps) / 10000n

		expect(minimumWethReport).toBe(3230769230769230770n)
		expect(correctionProfitAttoEth).toBeGreaterThanOrEqual(bufferedGasCostAttoEth)
	})

	test('adds priority-fee security to the larger open-interest-dependent report', () => {
		expect(
			calculateOracleMinimumWethReportAttoEth({
				...DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS,
				baseFeeAttoEthPerGas: 30n * 10n ** 9n,
				openInterestAttoEth: 500n * 10n ** 18n,
			}),
		).toBe(5807692307692307693n)
	})

	test('allows deployments to tune the target correction error', () => {
		expect(
			calculateOracleMinimumWethReportAttoEth({
				...DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS,
				baseFeeAttoEthPerGas: 30n * 10n ** 9n,
				openOracleSecurityMultiplierBps: 100000n,
				targetPriceErrorForDispute: 1000000n,
			}),
		).toBe(1483146067415730338n)
	})

	test('rounds up fractional WETH report sizes', () => {
		expect(
			calculateOracleMinimumWethReportAttoEth({
				baseFeeAttoEthPerGas: 1n,
				gasUnitsForOneDispute: 1n,
				initialReportPriorityFeeAttoEthPerGas: 0n,
				openInterestAttoEth: 0n,
				openOracleProtocolFee: 0,
				openOracleReporterFee: 0,
				openOracleSecurityMultiplierBps: 10000n,
				targetPriceErrorForDispute: ORACLE_PERCENTAGE_PRECISION,
			}),
		).toBe(2n)
	})

	test('rejects fees that eliminate the target correction profit', () => {
		expect(() =>
			calculateOracleMinimumWethReportAttoEth({
				...DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS,
				targetPriceErrorForDispute: 100000n,
			}),
		).toThrow('Cannot divide by zero or a negative denominator')
	})

	test('caps the immutable priority fee so its report and escalation halt fit uint128', () => {
		const uint128Max = (1n << 128n) - 1n
		const maximumReport = calculateOracleMinimumWethReportAttoEth({
			...DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS,
			initialReportPriorityFeeAttoEthPerGas: MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS,
		})
		const firstInvalidReport = calculateOracleMinimumWethReportAttoEth({
			...DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS,
			initialReportPriorityFeeAttoEthPerGas: MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS + 1n,
		})

		expect(calculateMaximumOracleInitialReportPriorityFeeAttoEthPerGas()).toBe(MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS)
		expect(maximumReport).toBeLessThanOrEqual(uint128Max)
		expect((maximumReport * ORACLE_ESCALATION_HALT_MULTIPLIER_BPS) / 10000n).toBeLessThanOrEqual(uint128Max / 2n)
		expect(firstInvalidReport).toBeGreaterThan(maximumReport)
	})
})
