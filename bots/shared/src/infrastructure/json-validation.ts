import type { Hex } from '../ethereum.ts'

const HASH32_PATTERN = /^0x[0-9a-fA-F]{64}$/
const DECIMAL_UNIT = 10n ** 18n

export function isHash32(value: unknown): value is Hex {
	return typeof value === 'string' && HASH32_PATTERN.test(value)
}

export function hash32(value: unknown, label: string) {
	if (!isHash32(value)) throw new Error(`${label} must be a 32-byte hash`)
	return value
}

export function normalizedHash32(value: unknown, label: string) {
	return hash32(typeof value === 'string' ? value.toLowerCase() : value, label)
}

export function parseDecimalAmount(value: unknown, label: string) {
	if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value)) throw new Error(`${label} must be a non-negative decimal with at most 18 places`)
	const [whole = '0', fraction = ''] = value.split('.')
	return BigInt(whole) * DECIMAL_UNIT + BigInt(fraction.padEnd(18, '0'))
}

export function formatDecimalAmount(value: bigint) {
	if (value < 0n) throw new Error('Decimal amount cannot be negative')
	const whole = value / DECIMAL_UNIT
	const fraction = (value % DECIMAL_UNIT).toString().padStart(18, '0').replace(/0+$/, '')
	return fraction === '' ? whole.toString() : `${whole.toString()}.${fraction}`
}
