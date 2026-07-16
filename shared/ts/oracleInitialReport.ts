export const ORACLE_PERCENTAGE_PRECISION = 10_000_000n
export const ORACLE_PROTOCOL_FEE = 100000
export const ORACLE_FEE_PERCENTAGE = 10000
export const ORACLE_MULTIPLIER = 115
export const ORACLE_GAS_UNITS_FOR_ONE_DISPUTE = 300000n
export const OPEN_ORACLE_SECURITY_MULTIPLIER_BPS = 100000n
export const ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE = 500000n

const BPS_DENOMINATOR = 10000n

export type OracleMinimumWethReportParameters = {
	baseFeeWeiPerGas: bigint
	openOracleSecurityMultiplierBps: bigint
	gasUnitsForOneDispute: bigint
	targetPriceErrorForDispute: bigint
	openOracleProtocolFee: number
	openOracleReporterFee: number
}

export const DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS = {
	baseFeeWeiPerGas: 0n,
	gasUnitsForOneDispute: ORACLE_GAS_UNITS_FOR_ONE_DISPUTE,
	openOracleProtocolFee: ORACLE_PROTOCOL_FEE,
	openOracleReporterFee: ORACLE_FEE_PERCENTAGE,
	openOracleSecurityMultiplierBps: OPEN_ORACLE_SECURITY_MULTIPLIER_BPS,
	targetPriceErrorForDispute: ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE,
} satisfies OracleMinimumWethReportParameters

function ceilDivide(numerator: bigint, denominator: bigint) {
	if (denominator <= 0n) throw new Error('Cannot divide by zero or a negative denominator')
	return (numerator + denominator - 1n) / denominator
}

export function calculateOracleMinimumWethReport(parameters: OracleMinimumWethReportParameters = DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS) {
	const feeSum = BigInt(parameters.openOracleProtocolFee + parameters.openOracleReporterFee)
	const correctionProfitNumerator = parameters.targetPriceErrorForDispute - feeSum
	const disputeGasCostWei = parameters.gasUnitsForOneDispute * parameters.baseFeeWeiPerGas
	const numerator = disputeGasCostWei * parameters.openOracleSecurityMultiplierBps * (ORACLE_PERCENTAGE_PRECISION + parameters.targetPriceErrorForDispute)
	const denominator = BPS_DENOMINATOR * correctionProfitNumerator
	const calculatedReport = ceilDivide(numerator, denominator)
	return calculatedReport > 0n ? calculatedReport : 1n
}
