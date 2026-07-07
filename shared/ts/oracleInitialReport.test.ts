import { describe, expect, test } from 'bun:test'
import { DEFAULT_ORACLE_EXACT_TOKEN1_REPORT_PARAMETERS, ORACLE_EXACT_TOKEN1_REPORT, ORACLE_FORMULA_PRECISION, calculateOracleExactToken1Report } from '@zoltar/shared/oracleInitialReport'

describe('oracle initial report sizing', () => {
	test('matches the deployment default exactToken1Report', () => {
		expect(ORACLE_EXACT_TOKEN1_REPORT).toBe(259332023575638507216n)
		expect(calculateOracleExactToken1Report()).toBe(ORACLE_EXACT_TOKEN1_REPORT)
	})

	test('rounds up fractional report sizes', () => {
		expect(
			calculateOracleExactToken1Report({
				assumedGasPriceWeiPerGas: 1n,
				assumedRepPerEthPrice: ORACLE_FORMULA_PRECISION,
				disputeReportSizeMultiplier: 100,
				expectedRepEthPriceMoveDuringSettlement: 0n,
				gasUnitsForOneDispute: 1n,
				openOracleProtocolFee: 0,
				openOracleReporterFee: 0,
				requiredDisputerProfitBuffer: ORACLE_FORMULA_PRECISION,
				targetPriceErrorForDispute: 2n * ORACLE_FORMULA_PRECISION,
			}),
		).toBe(2n)
	})

	test('rejects unsafe denominator assumptions', () => {
		expect(() =>
			calculateOracleExactToken1Report({
				...DEFAULT_ORACLE_EXACT_TOKEN1_REPORT_PARAMETERS,
				targetPriceErrorForDispute: ORACLE_FORMULA_PRECISION / 100n,
			}),
		).toThrow('Cannot divide by zero or a negative denominator')
	})
})
