import { type Address, type Hash, type Hex, type TransactionReceipt } from './types.js'

import { bytesToHex as nobleBytesToHex, hexToBytes as nobleHexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

import { addr } from 'micro-eth-signer'

import { keccak_256 } from '@noble/hashes/sha3.js'

export function stripHexPrefix(value: string) {
	return value.startsWith('0x') ? value.slice(2) : value
}

export function ensure0x(value: string): Hex {
	return (value.startsWith('0x') ? value : `0x${value}`) as Hex
}

function ensureEvenHex(value: string) {
	return value.length % 2 === 0 ? value : `0${value}`
}

function isHexCharacter(value: string) {
	return /^[0-9a-fA-F]*$/.test(value)
}

export function normalizeQuantityValue(value: bigint | number) {
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Number "${value.toString()}" is not in safe integer range`)
		return BigInt(value)
	}
	if (value < 0n) throw new Error(`Number "${value.toString()}n" is not in safe integer range`)
	return value
}

export function bigintToSafeNumber(value: bigint, label = 'Value') {
	if (value < -9_007_199_254_740_991n || value > 9_007_199_254_740_991n) throw new Error(`${label} exceeds the JavaScript safe integer range`)
	return Number.parseInt(value.toString(), 10)
}

export function hexQuantity(value: bigint | number) {
	const normalized = normalizeQuantityValue(value)
	return normalized === 0n ? '0x0' : ensure0x(normalized.toString(16))
}

export function normalizeHexData(value: string | undefined) {
	if (value === undefined) return undefined
	if (!isHex(value, { strict: true })) throw new Error(`Invalid hex value: ${value}`)
	return ensure0x(ensureEvenHex(stripHexPrefix(value).toLowerCase()))
}

export function normalizeOptionalLogRemoved(value: unknown) {
	if (value === undefined) return undefined
	if (typeof value !== 'boolean') throw new Error('RPC returned a log with an invalid removed flag')
	return value
}

export function normalizeTransactionType(value: unknown) {
	if (typeof value !== 'string') return undefined
	switch (value) {
		case '0x0':
			return 'legacy'
		case '0x1':
			return 'eip2930'
		case '0x2':
			return 'eip1559'
		case '0x3':
			return 'eip4844'
		case '0x4':
			return 'eip7702'
		default:
			return value
	}
}

export function normalizeBlockTag(value: bigint | undefined) {
	return value === undefined ? 'latest' : hexQuantity(value)
}

export function normalizeNullableAddress(value: unknown) {
	if (value === null || value === undefined) return undefined
	if (typeof value !== 'string') throw new Error('RPC returned an invalid address')
	if (value === '0x') return undefined
	return getAddress(value)
}

export function normalizeAddress(value: unknown) {
	const normalized = normalizeNullableAddress(value)
	if (normalized === undefined) throw new Error('RPC returned an invalid address')
	return normalized
}

export function normalizeHash(value: unknown) {
	if (typeof value !== 'string' || !isHex(value, { strict: true })) throw new Error('RPC returned an invalid hash')
	const normalized = stripHexPrefix(value).toLowerCase()
	if (normalized.length !== 64) throw new Error('RPC returned an invalid hash')
	return ensure0x(normalized) as Hash
}

export function requireMatchingTransactionHash(expected: Hash, actual: Hash, resultLabel: string) {
	if (actual !== expected) throw new Error(`RPC returned ${resultLabel} with a different hash: expected "${expected}", received "${actual}"`)
}

export function normalizeRpcHex(value: unknown) {
	if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/u.test(value)) throw new Error('RPC returned an invalid hex value')
	return ensure0x(stripHexPrefix(value).toLowerCase())
}

export function normalizeRpcBigInt(value: unknown, fallback = 0n) {
	if (value === undefined || value === null) return fallback
	if (typeof value === 'bigint') {
		if (value < 0n) throw new Error('RPC returned an invalid bigint value')
		return value
	}
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value) || value < 0) throw new Error('RPC returned an invalid bigint value')
		return BigInt(value)
	}
	if (typeof value !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) throw new Error('RPC returned an invalid bigint value')
	return BigInt(value)
}

export function normalizeRequiredRpcBigInt(value: unknown, label: string) {
	if (value === undefined || value === null) throw new Error(`RPC returned a missing required ${label}`)
	return normalizeRpcBigInt(value)
}

export function normalizeRequiredReceiptQuantity(value: unknown, field: string) {
	if (value === undefined || value === null) throw new Error(`RPC returned a transaction receipt without required ${field}`)
	return normalizeRpcBigInt(value)
}

export function normalizeReceiptStatus(value: unknown): TransactionReceipt['status'] {
	if (value === '0x1') return 'success'
	if (value === '0x0') return 'reverted'
	throw new Error('RPC returned a transaction receipt without a valid status')
}

export function checksumAddressFromBytes(value: Uint8Array) {
	return getAddress(ensure0x(nobleBytesToHex(value).slice(-40)))
}

export function getAddress(value: string): Address {
	if (value.startsWith('0X')) throw new Error(`Invalid address: ${value}`)
	const parsed = addr.parse(value)
	if (!addr.isValid(value)) throw new Error(`Invalid address: ${value}`)
	return ensure0x(addr.addChecksum(parsed.hasPrefix ? value : parsed.data)) as Address
}

export function isAddress(value: string) {
	if (value.startsWith('0X')) return false
	return addr.isValid(value)
}

export function isHex(value: string, options: { strict?: boolean | undefined } = {}) {
	if (options.strict === true && !value.startsWith('0x')) return false
	if (!value.startsWith('0x')) return false
	if (value === '0x') return true
	const normalized = stripHexPrefix(value)
	return isHexCharacter(normalized)
}

export function bytesToHex(value: Uint8Array) {
	return ensure0x(nobleBytesToHex(value))
}

export function hexToBytes(value: Hex | string) {
	return nobleHexToBytes(ensureEvenHex(stripHexPrefix(value)))
}

export function concatHex(values: readonly Hex[]) {
	return ensure0x(values.map(value => stripHexPrefix(value)).join(''))
}

export function toHex(value: bigint | number | string | Uint8Array, options: { size?: number | undefined } = {}) {
	if (typeof value === 'string') {
		return ensure0x(nobleBytesToHex(utf8ToBytes(value)))
	}
	if (typeof value === 'bigint' || typeof value === 'number') {
		const bigintValue = normalizeQuantityValue(value)
		if (options.size === undefined) return hexQuantity(bigintValue)
		const bytes = bigintToBytes(bigintValue)
		if (bytes.length > options.size) throw new Error(`Value exceeds requested size of ${options.size.toString()} bytes`)
		return ensure0x(nobleBytesToHex(Uint8Array.from([...new Uint8Array(options.size - bytes.length), ...bytes])))
	}
	const bytes = value
	if (options.size === undefined) return ensure0x(nobleBytesToHex(bytes))
	if (bytes.length > options.size) throw new Error(`Value exceeds requested size of ${options.size.toString()} bytes`)
	return ensure0x(nobleBytesToHex(Uint8Array.from([...new Uint8Array(options.size - bytes.length), ...bytes])))
}

export function stringToHex(value: string): Hex {
	return toHex(value)
}

export function keccak256(value: Hex | Uint8Array | string) {
	if (typeof value === 'string' && value.startsWith('0x')) {
		return ensure0x(nobleBytesToHex(keccak_256(hexToBytes(value))))
	}
	const bytes = typeof value === 'string' ? utf8ToBytes(value) : value
	return ensure0x(nobleBytesToHex(keccak_256(bytes)))
}

export function parseUnits(value: string, decimals: number) {
	const trimmed = value.trim()
	if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) throw new Error(`Invalid decimal value: ${value}`)
	const negative = trimmed.startsWith('-')
	const normalized = negative ? trimmed.slice(1) : trimmed
	const [wholePartRaw, fractionPartRaw = ''] = normalized.split('.')
	const wholePart = wholePartRaw === '' ? '0' : wholePartRaw
	const trimmedFraction = fractionPartRaw.replace(/0+$/, '')
	if (trimmedFraction.length > decimals) throw new Error(`Too many decimal places: expected at most ${decimals.toString()}`)
	const paddedFraction = trimmedFraction.padEnd(decimals, '0')
	const combined = `${wholePart}${paddedFraction}`.replace(/^0+/, '') || '0'
	const result = BigInt(combined)
	return negative ? -result : result
}

export function formatUnits(value: bigint, decimals: number) {
	const negative = value < 0n
	const normalized = negative ? -value : value
	const base = 10n ** BigInt(decimals)
	const whole = normalized / base
	const fraction = normalized % base
	if (fraction === 0n) return `${negative ? '-' : ''}${whole.toString()}`
	const fractionString = fraction.toString().padStart(decimals, '0').replace(/0+$/, '')
	return `${negative ? '-' : ''}${whole.toString()}.${fractionString}`
}

export function formatEther(value: bigint) {
	return formatUnits(value, 18)
}

export function bigintToBytes(value: bigint) {
	if (value === 0n) return new Uint8Array([])
	let hex = value.toString(16)
	hex = ensureEvenHex(hex)
	return nobleHexToBytes(hex)
}
