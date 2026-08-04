import { getAddress, type Hex } from '#ethereum'

export function requiredBigint(value: unknown, description: string) {
	if (typeof value !== 'bigint') throw new Error(`${description} is not an RPC bigint`)
	return value
}

export function requiredTuple(value: unknown, minimumLength: number, description: string): readonly unknown[] {
	if (!Array.isArray(value) || value.length < minimumLength) throw new Error(`${description} is not a complete RPC tuple`)
	return value
}

export function requiredBigintArray(value: unknown, description: string) {
	const values = requiredTuple(value, 1, description)
	return values.map((entry, index) => requiredBigint(entry, `${description}[${index.toString()}]`))
}

export function requiredRpcAddress(value: unknown, description: string) {
	if (typeof value !== 'string') throw new Error(`${description} is not an RPC address`)
	try {
		return getAddress(value)
	} catch (error) {
		void error
		throw new Error(`${description} is not a valid RPC address`)
	}
}

export function requiredHash(value: unknown, description: string): Hex {
	if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${description} is not a 32-byte RPC hash`)
	return value as Hex
}

export function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error)
}
