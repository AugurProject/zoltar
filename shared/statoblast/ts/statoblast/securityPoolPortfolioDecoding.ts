import { getAddress, isAddress, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'

/** Reads an unsigned integer contract value, accepting a safe JavaScript integer as well as a bigint. */
export function decodeUint(value: unknown, label: string, bits = 256): bigint {
	const integer = typeof value === 'number' && Number.isSafeInteger(value) ? BigInt(value) : value
	if (typeof integer !== 'bigint' || integer < 0n || integer >= 1n << BigInt(bits)) throw new Error(`${label} must fit uint${bits}.`)
	return integer
}

/** Reads a checksummed address; the zero address is rejected unless `allowZero` is set. */
export function decodeAddress(value: unknown, label: string, allowZero = false): Address {
	if (typeof value !== 'string' || !isAddress(value) || (!allowZero && getAddress(value) === zeroAddress)) throw new Error(`${label} must be a nonzero address.`)
	return getAddress(value)
}

export function decodeBool(value: unknown, failureMessage: string): boolean {
	if (typeof value !== 'boolean') throw new Error(failureMessage)
	return value
}

/** Returns a struct result's fields in `names` order, whether the client decoded it as a tuple array or a named object. */
export function decodeFields(value: unknown, names: readonly string[], failureMessage: string): unknown[] {
	if (Array.isArray(value) && value.length === names.length) return value
	if (value !== null && typeof value === 'object' && !Array.isArray(value)) return names.map(name => Reflect.get(value, name))
	throw new Error(failureMessage)
}
