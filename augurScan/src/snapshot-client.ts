import type { PublicClient } from './ethereum.ts'
import { type EntityStateSnapshot, type StateRead, type StateSnapshotTarget, sampleEntityStateWithRead } from './snapshots.ts'

export const sampleEntityState = async (client: Pick<PublicClient, 'readContract'>, target: StateSnapshotTarget, blockNumber: bigint, onFailure: (error: unknown) => void = () => {}): Promise<EntityStateSnapshot> => {
	const read: StateRead = async (address, abi, functionName, args) => await client.readContract({ address, abi, functionName, ...(args === undefined ? {} : { args }), blockNumber })
	return await sampleEntityStateWithRead(target, read, onFailure)
}
