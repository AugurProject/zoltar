import { zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import * as openOracleCopy from '../copy/openOracle.js'

/** EIP-7825 per-transaction gas limit; a settle transaction asking for more is never included. */
const TRANSACTION_GAS_CAP = 16_777_216n
const DEFAULT_SETTLEMENT_GAS = 5_000_000n
const SETTLEMENT_OVERHEAD_GAS = 600_000n
// A longer game may be valid onchain, but the UI does not invite a new
// disputer to lock funds for more than a year (12 seconds per block).
export const OPEN_ORACLE_MAX_UI_SETTLEMENT_SECONDS = 365n * 24n * 60n * 60n

type Callback = { callbackContract: Address; callbackGasLimit: bigint | number }

/**
 * Includes EIP-150 forwarding, the post-call reserve settle checks and the callback's gas.
 * `trustedCallback` is true only for the escrow a factory-registered shared price feed opened
 * for this report: its known code returns no data, so it needs no return-data allowance.
 */
function conservativeOpenOracleSettlementGas(game: Callback, trustedCallback: boolean) {
	if (game.callbackContract === zeroAddress) return DEFAULT_SETTLEMENT_GAS
	const callback = BigInt(game.callbackGasLimit)
	const postCallReserve = (callback + 62n) / 63n
	// Any other callback can spend its budget allocating return data; the caller may
	// spend another budget copying it before checking the required gas reserve.
	const callbackExecution = trustedCallback ? (callback * 64n + 62n) / 63n : 2n * callback
	const required = callbackExecution + postCallReserve + SETTLEMENT_OVERHEAD_GAS
	return required > DEFAULT_SETTLEMENT_GAS ? required : DEFAULT_SETTLEMENT_GAS
}

/** The settle gas limit to request, or a refusal when it would exceed what one transaction may use. */
export function getOpenOracleSettlementGasLimit(game: Callback, trustedCallback: boolean): { gas: bigint; refusal?: undefined } | { gas?: undefined; refusal: string } {
	const gas = conservativeOpenOracleSettlementGas(game, trustedCallback)
	return gas > TRANSACTION_GAS_CAP ? { refusal: openOracleCopy.settlementGasExceedsTransactionCap } : { gas }
}

export function getOpenOracleSettlementSafetyGuard(report: Callback & { settlementTime: bigint; timeType: boolean; trustedSettlementCallback: boolean }) {
	if (conservativeOpenOracleSettlementGas(report, report.trustedSettlementCallback) > TRANSACTION_GAS_CAP) return 'This report exceeds the safe settlement gas limit. Disputing it could lock your dispute deposit.'
	const maximum = report.timeType ? OPEN_ORACLE_MAX_UI_SETTLEMENT_SECONDS : OPEN_ORACLE_MAX_UI_SETTLEMENT_SECONDS / 12n
	if (report.settlementTime > maximum) return 'This report has a settlement duration longer than one year. Disputing it could lock your dispute deposit.'
	return undefined
}
