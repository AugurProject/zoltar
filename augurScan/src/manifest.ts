import { getAddress, isAddress } from './ethereum.ts'
import type { ManifestContract } from './types.ts'

export const parseManifestValue = (value: { contracts?: unknown }, filename: string): readonly ManifestContract[] => {
	if (!Array.isArray(value.contracts)) throw new Error(`${filename} must contain a contracts array`)
	const addresses = new Set<string>()
	return value.contracts.map((entry, index) => {
		if (!Array.isArray(entry) || (entry.length !== 3 && entry.length !== 4) || typeof entry[0] !== 'string' || !isAddress(entry[0]) || typeof entry[1] !== 'string' || typeof entry[2] !== 'string' || (entry[3] !== undefined && (typeof entry[3] !== 'string' || !/^\d+$/.test(entry[3])))) {
			throw new Error(`${filename} contract ${index} is invalid`)
		}
		const address = getAddress(entry[0])
		const key = address.toLowerCase()
		if (addresses.has(key)) throw new Error(`${filename} contract ${index} duplicates address ${address}`)
		addresses.add(key)
		return entry[3] === undefined ? ([address, entry[1], entry[2]] as const) : ([address, entry[1], entry[2], BigInt(entry[3])] as const)
	})
}
