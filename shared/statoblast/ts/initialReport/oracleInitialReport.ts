import { ceilDiv } from '@zoltar/core-shared/math/bigint'
const ORACLE_PERCENTAGE_PRECISION = 10_000_000n
export const ORACLE_PROTOCOL_FEE = 100000
export const ORACLE_FEE_PERCENTAGE = 10000
export const ORACLE_MULTIPLIER = 115
const ORACLE_GAS_UNITS_FOR_ONE_DISPUTE = 300000n
const OPEN_ORACLE_SECURITY_MULTIPLIER_BPS = 100000n
export const ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE = 500000n
export const DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS = 10n * 10n ** 9n
export const ORACLE_ESCALATION_HALT_MULTIPLIER_BPS = 100000n

// OpenOracle request parameters every price coordinator is deployed with.
export const ORACLE_PROTOCOL_FEE_RECIPIENT = '0x000000000000000000000000000000000000dEaD'
export const ORACLE_SETTLEMENT_TIME = 40 * 12
export const ORACLE_DISPUTE_DELAY = 0
export const ORACLE_MAX_SETTLEMENT_BASE_FEE_MULTIPLIER_BPS = 30000n

/** Exact native settlement reward required by the shared REP price feed. */
export function calculateOracleSettlementBountyAttoEth(parameters: { baseFeePerGas: bigint; initialReportPriorityFeeAttoEthPerGas: bigint; settlementCallbackGasLimit: bigint; maxSettlementBaseFeeMultiplierBps: bigint }) {
	if (parameters.maxSettlementBaseFeeMultiplierBps === undefined) throw new Error('Settlement fee multiplier is required')
	const callback = parameters.settlementCallbackGasLimit
	const gasBudget = callback + callback / 63n + 310_000n
	const paddedGas = ceilDiv(gasBudget * 12_000n, 10_000n) + 20_000n
	const feeAllowance = ((parameters.baseFeePerGas + parameters.initialReportPriorityFeeAttoEthPerGas) * parameters.maxSettlementBaseFeeMultiplierBps) / 10_000n
	return paddedGas * feeAllowance + 101n
}

const BPS_DENOMINATOR = 10000n
const UINT128_MAX = (1n << 128n) - 1n

function calculateMaximumOracleInitialReportPriorityFeeAttoEthPerGas() {
	const feeSum = BigInt(ORACLE_PROTOCOL_FEE + ORACLE_FEE_PERCENTAGE)
	const correctionProfitNumerator = ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE - feeSum
	if (correctionProfitNumerator <= 0n) throw new Error('Oracle fees must be below the target price error')
	const reportDenominator = BPS_DENOMINATOR * correctionProfitNumerator
	const reportNumeratorMultiplier = OPEN_ORACLE_SECURITY_MULTIPLIER_BPS * (ORACLE_PERCENTAGE_PRECISION + ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE)
	const escalationLimitedReport = (UINT128_MAX * BPS_DENOMINATOR) / ORACLE_ESCALATION_HALT_MULTIPLIER_BPS
	const maximumPriorityFeeReport = (escalationLimitedReport < UINT128_MAX ? escalationLimitedReport : UINT128_MAX) / 2n
	const maximumPriorityDisputeGasCost = (maximumPriorityFeeReport * reportDenominator) / reportNumeratorMultiplier
	const reportMaximum = maximumPriorityDisputeGasCost / ORACLE_GAS_UNITS_FOR_ONE_DISPUTE
	const callback = 4_000_000n
	const gas = ceilDiv((callback + callback / 63n + 310_000n) * 12_000n, 10_000n) + 20_000n
	const maximumAllowance = ((1n << 96n) - 1n - 101n) / gas
	const bountyMaximum = ceilDiv((maximumAllowance + 1n) * 10_000n, ORACLE_MAX_SETTLEMENT_BASE_FEE_MULTIPLIER_BPS) - 1n
	return reportMaximum < bountyMaximum ? reportMaximum : bountyMaximum
}

export const MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS = calculateMaximumOracleInitialReportPriorityFeeAttoEthPerGas()
