import { bytesToHex, encodeAbiParameters, getAddress, hexToBytes, keccak256, type Address, type Hex } from './ethereum.js'

export const OPEN_ORACLE_FLAG_TIME_TYPE = 1n << 0n
export const OPEN_ORACLE_FLAG_TRACK_DISPUTES = 1n << 1n
export const OPEN_ORACLE_FLAG_STORE_ALL = 1n << 2n
export const OPEN_ORACLE_FLAG_STORE_PRICE = 1n << 3n
export const OPEN_ORACLE_REPORT_SUBMITTED_TOPIC = keccak256('ReportSubmitted(uint256,bytes)')
export const OPEN_ORACLE_REPORT_DISPUTED_TOPIC = keccak256('ReportDisputed(uint256,bytes)')
export const OPEN_ORACLE_REPORT_SETTLED_TOPIC = keccak256('ReportSettled(uint256)')

export type OpenOracleGame = {
	callbackContract: Address
	callbackGasLimit: bigint
	currentAmount1: bigint
	currentAmount2: bigint
	currentReporter: Address
	disputeDelay: bigint
	escalationHalt: bigint
	feePercentage: bigint
	flags: bigint
	lastReportOppoTime: bigint
	multiplier: bigint
	numReports: bigint
	protocolFee: bigint
	protocolFeeRecipient: Address
	reportTimestamp: bigint
	settlementTime: bigint
	settlementTimestamp: bigint
	settlerReward: bigint
	token1: Address
	token2: Address
}

export type OpenOraclePreimageHelper = {
	blockNumber: bigint
	blockTimestamp: bigint
	creator: Address
	reportId: bigint
}

export type OpenOracleStatePreimage = {
	game: OpenOracleGame
	helper: OpenOraclePreimageHelper
}

const OPEN_ORACLE_GAME_COMPONENTS = [
	{ name: 'currentAmount1', type: 'uint128' },
	{ name: 'currentAmount2', type: 'uint128' },
	{ name: 'currentReporter', type: 'address' },
	{ name: 'reportTimestamp', type: 'uint48' },
	{ name: 'settlementTimestamp', type: 'uint48' },
	{ name: 'token1', type: 'address' },
	{ name: 'lastReportOppoTime', type: 'uint48' },
	{ name: 'settlementTime', type: 'uint48' },
	{ name: 'escalationHalt', type: 'uint128' },
	{ name: 'protocolFeeRecipient', type: 'address' },
	{ name: 'settlerReward', type: 'uint96' },
	{ name: 'token2', type: 'address' },
	{ name: 'numReports', type: 'uint24' },
	{ name: 'disputeDelay', type: 'uint24' },
	{ name: 'feePercentage', type: 'uint24' },
	{ name: 'multiplier', type: 'uint16' },
	{ name: 'callbackContract', type: 'address' },
	{ name: 'callbackGasLimit', type: 'uint32' },
	{ name: 'protocolFee', type: 'uint24' },
	{ name: 'flags', type: 'uint8' },
] as const

const OPEN_ORACLE_HELPER_COMPONENTS = [
	{ name: 'reportId', type: 'uint256' },
	{ name: 'creator', type: 'address' },
	{ name: 'blockTimestamp', type: 'uint256' },
	{ name: 'blockNumber', type: 'uint256' },
] as const

function readPackedUint(bytes: Uint8Array, offset: number, width: number) {
	if (!Number.isInteger(offset) || !Number.isInteger(width) || offset < 0 || width < 1 || offset + width > bytes.length) throw new Error('OpenOracle packed event data is truncated')
	let value = 0n
	for (let index = offset; index < offset + width; index++) {
		const byte = bytes[index]
		if (byte === undefined) throw new Error('OpenOracle packed event data is truncated')
		value = (value << 8n) | BigInt(byte)
	}
	return value
}

function readPackedAddress(bytes: Uint8Array, offset: number) {
	return getAddress(bytesToHex(bytes.slice(offset, offset + 20)))
}

function writePackedUint(bytes: Uint8Array, offset: number, width: number, value: bigint) {
	if (value < 0n || value >= 1n << (BigInt(width) * 8n)) throw new Error(`OpenOracle packed value does not fit in ${width.toString()} bytes`)
	let remaining = value
	for (let index = offset + width - 1; index >= offset; index--) {
		bytes[index] = Number(remaining & 0xffn)
		remaining >>= 8n
	}
}

function writePackedAddress(bytes: Uint8Array, offset: number, value: Address) {
	bytes.set(hexToBytes(value), offset)
}

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
	writePackedUint(bytes, 132, 12, game.settlerReward)
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

export function decodeOpenOracleStatePreimage(data: Hex, reportId: bigint): OpenOracleStatePreimage {
	const bytes = hexToBytes(data)
	if (bytes.length !== 235) throw new Error(`OpenOracle packed event data must be 235 bytes, received ${bytes.length.toString()}`)
	return {
		game: {
			currentAmount1: readPackedUint(bytes, 0, 16),
			currentAmount2: readPackedUint(bytes, 16, 16),
			currentReporter: readPackedAddress(bytes, 32),
			reportTimestamp: readPackedUint(bytes, 52, 6),
			settlementTimestamp: readPackedUint(bytes, 58, 6),
			token1: readPackedAddress(bytes, 64),
			lastReportOppoTime: readPackedUint(bytes, 84, 6),
			settlementTime: readPackedUint(bytes, 90, 6),
			escalationHalt: readPackedUint(bytes, 96, 16),
			protocolFeeRecipient: readPackedAddress(bytes, 112),
			settlerReward: readPackedUint(bytes, 132, 12),
			token2: readPackedAddress(bytes, 144),
			numReports: readPackedUint(bytes, 164, 3),
			disputeDelay: readPackedUint(bytes, 167, 3),
			feePercentage: readPackedUint(bytes, 170, 3),
			multiplier: readPackedUint(bytes, 173, 2),
			callbackContract: readPackedAddress(bytes, 175),
			callbackGasLimit: readPackedUint(bytes, 195, 4),
			protocolFee: readPackedUint(bytes, 199, 3),
			flags: readPackedUint(bytes, 202, 1),
		},
		helper: {
			reportId,
			creator: readPackedAddress(bytes, 203),
			blockTimestamp: readPackedUint(bytes, 223, 6),
			blockNumber: readPackedUint(bytes, 229, 6),
		},
	}
}

export function getOpenOracleGameTuple(game: OpenOracleGame) {
	return [
		game.currentAmount1,
		game.currentAmount2,
		game.currentReporter,
		game.reportTimestamp,
		game.settlementTimestamp,
		game.token1,
		game.lastReportOppoTime,
		game.settlementTime,
		game.escalationHalt,
		game.protocolFeeRecipient,
		game.settlerReward,
		game.token2,
		game.numReports,
		game.disputeDelay,
		game.feePercentage,
		game.multiplier,
		game.callbackContract,
		game.callbackGasLimit,
		game.protocolFee,
		game.flags,
	] as const
}

export function getOpenOracleHelperTuple(helper: OpenOraclePreimageHelper) {
	return [helper.reportId, helper.creator, helper.blockTimestamp, helper.blockNumber] as const
}

export function hashOpenOracleStatePreimage(preimage: OpenOracleStatePreimage) {
	return keccak256(
		encodeAbiParameters(
			[
				{ type: 'tuple', components: OPEN_ORACLE_GAME_COMPONENTS },
				{ type: 'tuple', components: OPEN_ORACLE_HELPER_COMPONENTS },
			],
			[getOpenOracleGameTuple(preimage.game), getOpenOracleHelperTuple(preimage.helper)],
		),
	)
}

export function getOpenOracleReportIdFromTopic(topic: Hex) {
	return BigInt(topic)
}

export function hasOpenOracleFlag(game: OpenOracleGame, flag: bigint) {
	return (game.flags & flag) !== 0n
}
