import { bigintToSafeNumber, bytesToHex, hexToBytes, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import type { OpenOracleStatePreimage } from '@zoltar/open-oracle-shared/openOracle/openOracle'

// Optional OpenOracle report flags that the repository's own consumers never set; tests use them to exercise contract paths.
export const OPEN_ORACLE_FLAG_STORE_SETTLEMENT_ELIGIBILITY = 1n << 4n
export const OPEN_ORACLE_FLAG_FEES_ONLY_AT_HALT = 1n << 5n
export const OPEN_ORACLE_FLAG_FLEXIBLE_ESCALATION = 1n << 6n

function writePackedUint(bytes: Uint8Array, offset: number, width: number, value: bigint) {
	if (value < 0n || value >= 1n << (BigInt(width) * 8n)) throw new Error(`OpenOracle packed value does not fit in ${width.toString()} bytes`)
	let remaining = value
	for (let index = offset + width - 1; index >= offset; index--) {
		bytes[index] = bigintToSafeNumber(remaining & 0xffn, 'Packed byte')
		remaining >>= 8n
	}
}

function writePackedAddress(bytes: Uint8Array, offset: number, value: Address) {
	bytes.set(hexToBytes(value), offset)
}

// Inverse of decodeOpenOracleStatePreimage: builds the packed ReportSubmitted/ReportDisputed event payload for fixtures.
export function encodeOpenOracleStatePreimagePacked(preimage: OpenOracleStatePreimage): Hex {
	const bytes = new Uint8Array(235)
	const { game, helper } = preimage
	writePackedUint(bytes, 0, 16, game.currentAmount1)
	writePackedUint(bytes, 16, 16, game.currentAmount2)
	writePackedAddress(bytes, 32, game.currentReporter)
	writePackedUint(bytes, 52, 6, game.reportTimestamp)
	writePackedUint(bytes, 58, 6, game.settlementTimestamp)
	writePackedAddress(bytes, 64, game.token1)
	writePackedUint(bytes, 84, 6, game.lastReportOppoTime)
	writePackedUint(bytes, 90, 6, game.settlementTime)
	writePackedUint(bytes, 96, 16, game.escalationHalt)
	writePackedAddress(bytes, 112, game.protocolFeeRecipient)
	writePackedUint(bytes, 132, 12, game.settlerRewardAttoEth)
	writePackedAddress(bytes, 144, game.token2)
	writePackedUint(bytes, 164, 3, game.numReports)
	writePackedUint(bytes, 167, 3, game.disputeDelay)
	writePackedUint(bytes, 170, 3, game.feePercentage)
	writePackedUint(bytes, 173, 2, game.multiplier)
	writePackedAddress(bytes, 175, game.callbackContract)
	writePackedUint(bytes, 195, 4, game.callbackGasLimit)
	writePackedUint(bytes, 199, 3, game.protocolFee)
	writePackedUint(bytes, 202, 1, game.flags)
	writePackedAddress(bytes, 203, helper.creator)
	writePackedUint(bytes, 223, 6, helper.blockTimestamp)
	writePackedUint(bytes, 229, 6, helper.blockNumber)
	return bytesToHex(bytes)
}
