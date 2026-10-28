import { keccak256, type Hex } from '../ethereum.js'

export type RuntimeIdentity = {
	runtimeCodeHash: Hex
	runtimeCodeLength: number
	immutableReferences: Readonly<Record<string, readonly { start: number; length: number }[]>>
}

/** Match compiler runtime while requiring every repeated immutable occurrence to agree. */
export function verifyRuntimeIdentity(actual: Hex | undefined, expected: RuntimeIdentity, label: string) {
	if (actual === undefined || actual.length !== 2 + expected.runtimeCodeLength * 2) throw new Error(`Unrecognized ${label} runtime code`)
	let masked = actual.toLowerCase()
	for (const entries of Object.values(expected.immutableReferences)) {
		let immutableValue: string | undefined
		for (const { start, length } of entries) {
			const from = 2 + start * 2
			const through = from + length * 2
			if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length <= 0 || through > actual.length) throw new Error('Invalid compiler immutable reference')
			const value = actual.slice(from, through).toLowerCase()
			if (immutableValue !== undefined && immutableValue !== value) throw new Error(`Inconsistent ${label} runtime immutable values`)
			immutableValue = value
			masked = masked.slice(0, from) + '0'.repeat(length * 2) + masked.slice(through)
		}
	}
	if (keccak256(`0x${masked.slice(2)}`) !== expected.runtimeCodeHash) throw new Error(`Unrecognized ${label} runtime code`)
}
