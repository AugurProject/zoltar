import { encodeAbiParameters, keccak256 } from './ethereum.js'

const UINT248_MASK = (1n << 248n) - 1n

export function getChildUniverseId(parentUniverseId: bigint, outcomeIndex: bigint) {
	if (parentUniverseId < 0n || parentUniverseId > UINT248_MASK) throw new Error('Parent universe ID is outside uint248')
	if (outcomeIndex < 0n || outcomeIndex >= 1n << 256n) throw new Error('Fork outcome is outside uint256')
	return BigInt(keccak256(encodeAbiParameters([{ type: 'uint248' }, { type: 'uint256' }], [parentUniverseId, outcomeIndex]))) & UINT248_MASK
}
