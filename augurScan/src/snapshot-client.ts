import { type CollateralIdentityCache, withCollateralIdentityCache } from './collateral-metadata.ts'
import type { PublicClient } from './ethereum.ts'
import { type EntityStateSnapshot, type StateRead, type StateSnapshotTarget, sampleEntityStateWithRead } from './snapshots.ts'

export const sampleEntityState = async (client: { readContract: (parameters: Parameters<PublicClient['readContract']>[0]) => Promise<unknown> }, target: StateSnapshotTarget, blockNumber: bigint, onFailure: (error: unknown) => void = () => {}, identityCache?: CollateralIdentityCache): Promise<EntityStateSnapshot> => {
	const read: StateRead = withCollateralIdentityCache(async (address, abi, functionName, args) => await client.readContract({ address, abi, functionName, ...(args === undefined ? {} : { args }), blockNumber }), identityCache)
	return await sampleEntityStateWithRead(target, read, onFailure)
}
