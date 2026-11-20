import { zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'

const TRANSACTION_GAS_CAP = 16_777_216n
const DEFAULT_SETTLEMENT_GAS = 5_000_000n
const SETTLEMENT_OVERHEAD_GAS = 600_000n
// A longer game may be valid onchain, but the UI does not invite a new
// disputer to lock funds for more than a year (12 seconds per block).
const MAX_SETTLEMENT_SECONDS = 365n * 24n * 60n * 60n

type Callback = { callbackContract: Address; callbackGasLimit: bigint | number }

/** Includes caller-side return-data copying as well as EIP-150 and the callback's gas. */
export function conservativeOpenOracleSettlementGas(game: Callback) {
	if (game.callbackContract === zeroAddress) return DEFAULT_SETTLEMENT_GAS
	const callback = BigInt(game.callbackGasLimit)
	// A callback can spend its budget allocating return data; the caller may
	// spend another budget copying it before checking the required gas reserve.
	const required = 2n * callback + (callback + 62n) / 63n + SETTLEMENT_OVERHEAD_GAS
	return required > DEFAULT_SETTLEMENT_GAS ? required : DEFAULT_SETTLEMENT_GAS
}

export function getOpenOracleSettlementSafetyGuard(report: Callback & { settlementTime: bigint; timeType: boolean }) {
	if (conservativeOpenOracleSettlementGas(report) > TRANSACTION_GAS_CAP) return 'This report exceeds the safe settlement gas limit. Disputing it could lock your dispute deposit.'
	const maximum = report.timeType ? MAX_SETTLEMENT_SECONDS : MAX_SETTLEMENT_SECONDS / 12n
	if (report.settlementTime > maximum) return 'This report has a settlement duration longer than one year. Disputing it could lock your dispute deposit.'
	return undefined
}
