export const ORACLE_PERCENTAGE_PRECISION = 10_000_000n
export const ORACLE_PROTOCOL_FEE = 100000
export const ORACLE_FEE_PERCENTAGE = 10000
export const ORACLE_MULTIPLIER = 115
export const ORACLE_GAS_UNITS_FOR_ONE_DISPUTE = 300000n
export const OPEN_ORACLE_SECURITY_MULTIPLIER_BPS = 100000n
export const ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE = 500000n
export const DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_WEI_PER_GAS = 10n * 10n ** 9n
export const ORACLE_OPEN_INTEREST_DIVIDER = 100n
export const ORACLE_ESCALATION_HALT_MULTIPLIER_BPS = 100000n

const BPS_DENOMINATOR = 10000n
const UINT128_MAX = (1n << 128n) - 1n

export type OracleMinimumWethReportParameters = {
	baseFeeWeiPerGas: bigint
	initialReportPriorityFeeWeiPerGas: bigint
	openInterestWei: bigint
	openOracleSecurityMultiplierBps: bigint
	gasUnitsForOneDispute: bigint
	targetPriceErrorForDispute: bigint
	openOracleProtocolFee: number
	openOracleReporterFee: number
}

export const DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS = {
	baseFeeWeiPerGas: 0n,
	gasUnitsForOneDispute: ORACLE_GAS_UNITS_FOR_ONE_DISPUTE,
	initialReportPriorityFeeWeiPerGas: DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_WEI_PER_GAS,
	openInterestWei: 0n,
	openOracleProtocolFee: ORACLE_PROTOCOL_FEE,
	openOracleReporterFee: ORACLE_FEE_PERCENTAGE,
	openOracleSecurityMultiplierBps: OPEN_ORACLE_SECURITY_MULTIPLIER_BPS,
	targetPriceErrorForDispute: ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE,
} satisfies OracleMinimumWethReportParameters

export function calculateMaximumOracleInitialReportPriorityFeeWeiPerGas(parameters: OracleMinimumWethReportParameters = DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS, escalationHaltMultiplierBps = ORACLE_ESCALATION_HALT_MULTIPLIER_BPS) {
	if (parameters.gasUnitsForOneDispute <= 0n) throw new Error('Dispute gas units must be positive')
	if (escalationHaltMultiplierBps <= 0n) throw new Error('Escalation halt multiplier must be positive')
	const feeSum = BigInt(parameters.openOracleProtocolFee + parameters.openOracleReporterFee)
	const correctionProfitNumerator = parameters.targetPriceErrorForDispute - feeSum
	if (correctionProfitNumerator <= 0n) throw new Error('Oracle fees must be below the target price error')
	const reportDenominator = BPS_DENOMINATOR * correctionProfitNumerator
	const reportNumeratorMultiplier = parameters.openOracleSecurityMultiplierBps * (ORACLE_PERCENTAGE_PRECISION + parameters.targetPriceErrorForDispute)
	const escalationLimitedReport = (UINT128_MAX * BPS_DENOMINATOR) / escalationHaltMultiplierBps
	const maximumPriorityFeeReport = (escalationLimitedReport < UINT128_MAX ? escalationLimitedReport : UINT128_MAX) / 2n
	const maximumPriorityDisputeGasCost = (maximumPriorityFeeReport * reportDenominator) / reportNumeratorMultiplier
	return maximumPriorityDisputeGasCost / parameters.gasUnitsForOneDispute
}

export const MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_WEI_PER_GAS = calculateMaximumOracleInitialReportPriorityFeeWeiPerGas()

function ceilDivide(numerator: bigint, denominator: bigint) {
	if (denominator <= 0n) throw new Error('Cannot divide by zero or a negative denominator')
	return (numerator + denominator - 1n) / denominator
}

export function calculateOracleMinimumWethReport(parameters: OracleMinimumWethReportParameters = DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS) {
	const feeSum = BigInt(parameters.openOracleProtocolFee + parameters.openOracleReporterFee)
	const correctionProfitNumerator = parameters.targetPriceErrorForDispute - feeSum
	const denominator = BPS_DENOMINATOR * correctionProfitNumerator
	const calculateGasPriceReport = (gasPriceWeiPerGas: bigint) => {
		if (gasPriceWeiPerGas === 0n) return 0n
		const disputeGasCostWei = parameters.gasUnitsForOneDispute * gasPriceWeiPerGas
		const numerator = disputeGasCostWei * parameters.openOracleSecurityMultiplierBps * (ORACLE_PERCENTAGE_PRECISION + parameters.targetPriceErrorForDispute)
		return ceilDivide(numerator, denominator)
	}
	const priorityFeeReport = calculateGasPriceReport(parameters.initialReportPriorityFeeWeiPerGas)
	const baseFeeReport = calculateGasPriceReport(parameters.baseFeeWeiPerGas)
	const openInterestReport = ceilDivide(parameters.openInterestWei, ORACLE_OPEN_INTEREST_DIVIDER)
	const dynamicReport = baseFeeReport > openInterestReport ? baseFeeReport : openInterestReport
	const calculatedReport = priorityFeeReport + dynamicReport
	return calculatedReport > 0n ? calculatedReport : 1n
}
