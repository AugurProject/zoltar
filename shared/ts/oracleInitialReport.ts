export const ORACLE_FORMULA_PRECISION = 10n ** 18n
export const ORACLE_PERCENTAGE_PRECISION = 10_000_000n
export const ORACLE_PROTOCOL_FEE = 100000
export const ORACLE_FEE_PERCENTAGE = 10000
export const ORACLE_MULTIPLIER = 115
export const ORACLE_REQUIRED_DISPUTER_PROFIT_BUFFER = 2n * ORACLE_FORMULA_PRECISION
export const ORACLE_GAS_UNITS_FOR_ONE_DISPUTE = 300000n
export const ORACLE_ASSUMED_GAS_PRICE_WEI_PER_GAS = 30n * 10n ** 9n
export const ORACLE_ASSUMED_REP_PER_ETH_PRICE = 1000n * 10n ** 18n
export const ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE = ORACLE_FORMULA_PRECISION / 10n
export const ORACLE_EXPECTED_REP_ETH_PRICE_MOVE_DURING_SETTLEMENT = ORACLE_FORMULA_PRECISION / 100n

export type OracleExactToken1ReportParameters = {
	requiredDisputerProfitBuffer: bigint
	gasUnitsForOneDispute: bigint
	assumedGasPriceWeiPerGas: bigint
	assumedRepPerEthPrice: bigint
	targetPriceErrorForDispute: bigint
	openOracleProtocolFee: number
	openOracleReporterFee: number
	disputeReportSizeMultiplier: number
	expectedRepEthPriceMoveDuringSettlement: bigint
}

export const DEFAULT_ORACLE_EXACT_TOKEN1_REPORT_PARAMETERS = {
	assumedGasPriceWeiPerGas: ORACLE_ASSUMED_GAS_PRICE_WEI_PER_GAS,
	assumedRepPerEthPrice: ORACLE_ASSUMED_REP_PER_ETH_PRICE,
	disputeReportSizeMultiplier: ORACLE_MULTIPLIER,
	expectedRepEthPriceMoveDuringSettlement: ORACLE_EXPECTED_REP_ETH_PRICE_MOVE_DURING_SETTLEMENT,
	gasUnitsForOneDispute: ORACLE_GAS_UNITS_FOR_ONE_DISPUTE,
	openOracleProtocolFee: ORACLE_PROTOCOL_FEE,
	openOracleReporterFee: ORACLE_FEE_PERCENTAGE,
	requiredDisputerProfitBuffer: ORACLE_REQUIRED_DISPUTER_PROFIT_BUFFER,
	targetPriceErrorForDispute: ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE,
} satisfies OracleExactToken1ReportParameters

function ceilDivide(numerator: bigint, denominator: bigint) {
	if (denominator <= 0n) throw new Error('Cannot divide by zero or a negative denominator')
	return (numerator + denominator - 1n) / denominator
}

export function calculateOracleExactToken1Report(parameters: OracleExactToken1ReportParameters = DEFAULT_ORACLE_EXACT_TOKEN1_REPORT_PARAMETERS) {
	const openOracleProtocolFeeFraction = (BigInt(parameters.openOracleProtocolFee) * ORACLE_FORMULA_PRECISION) / ORACLE_PERCENTAGE_PRECISION
	const openOracleReporterFeeFraction = (BigInt(parameters.openOracleReporterFee) * ORACLE_FORMULA_PRECISION) / ORACLE_PERCENTAGE_PRECISION
	const disputeReportSizeMultiplier = (BigInt(parameters.disputeReportSizeMultiplier) * ORACLE_FORMULA_PRECISION) / 100n
	const targetErrorAfterFees = parameters.targetPriceErrorForDispute - openOracleProtocolFeeFraction - openOracleReporterFeeFraction
	const disputeProfitFraction = (targetErrorAfterFees * ORACLE_FORMULA_PRECISION) / (ORACLE_FORMULA_PRECISION + parameters.targetPriceErrorForDispute)
	const priceMoveFraction = (disputeReportSizeMultiplier * parameters.expectedRepEthPriceMoveDuringSettlement) / ORACLE_FORMULA_PRECISION
	const denominator = disputeProfitFraction - priceMoveFraction
	const disputeGasCostWei = parameters.gasUnitsForOneDispute * parameters.assumedGasPriceWeiPerGas
	const numerator = parameters.requiredDisputerProfitBuffer * disputeGasCostWei * parameters.assumedRepPerEthPrice
	return ceilDivide(numerator, ORACLE_FORMULA_PRECISION * denominator)
}

export const ORACLE_EXACT_TOKEN1_REPORT = calculateOracleExactToken1Report()
