import { encodeAbiParameters, keccak256 } from '@zoltar/bot-shared/ethereum'

const UINT248_LIMIT = 1n << 248n

// Mirrors the Zoltar child-universe identity derivation so fixtures can name fork children deterministically.
export function deriveChildUniverseId(universeId: bigint, outcomeIndex: bigint) {
	return BigInt(keccak256(encodeAbiParameters([{ type: 'uint248' }, { type: 'uint256' }], [universeId, outcomeIndex]))) & (UINT248_LIMIT - 1n)
}
