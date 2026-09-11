type IndexerOwnershipState = 'owned' | 'standby' | 'release-failed' | 'stale-owner' | 'unknown'

export type IndexerOwnershipDiagnostic = {
	readonly chainId: number
	readonly networkId: string
	readonly state: IndexerOwnershipState
	readonly backendPid?: number
	readonly recordedState?: string
	readonly ownerRunId?: string
	readonly heartbeatAt?: string
}

export type OwnershipRow = Record<string, unknown>

export const reconcileIndexerOwnership = (networks: readonly OwnershipRow[], ownership: readonly OwnershipRow[], locks: readonly OwnershipRow[], staleBefore: number): readonly IndexerOwnershipDiagnostic[] => {
	const recordedByChain = new Map(ownership.map(row => [Number(row['chain_id']), row]))
	const lockByChain = new Map(locks.map(row => [Number(row['chain_id']), Number(row['backend_pid'])]))
	return networks.map(network => {
		const chainId = Number(network['chain_id'])
		const networkId = String(network['id'])
		const recorded = recordedByChain.get(chainId)
		const lockedBackendPid = lockByChain.get(chainId)
		const recordedBackendPid = recorded?.['backend_pid'] === null || recorded?.['backend_pid'] === undefined ? undefined : Number(recorded['backend_pid'])
		const heartbeatAt = recorded?.['heartbeat_at'] === null || recorded?.['heartbeat_at'] === undefined ? undefined : new Date(String(recorded['heartbeat_at']))
		const heartbeatFresh = heartbeatAt !== undefined && heartbeatAt.getTime() >= staleBefore
		let state: IndexerOwnershipState
		if (recorded?.['state'] === 'release-failed' && (lockedBackendPid === undefined || recordedBackendPid === lockedBackendPid)) state = 'release-failed'
		else if (lockedBackendPid !== undefined) {
			if (recorded === undefined) state = 'unknown'
			else state = recordedBackendPid === lockedBackendPid && recorded['state'] === 'owned' && heartbeatFresh ? 'owned' : 'stale-owner'
		} else if (recorded?.['state'] === 'standby' || recorded?.['state'] === 'released') state = 'standby'
		else state = 'unknown'
		return {
			chainId,
			networkId,
			state,
			...(lockedBackendPid === undefined && recordedBackendPid === undefined ? {} : { backendPid: lockedBackendPid ?? recordedBackendPid }),
			...(typeof recorded?.['state'] === 'string' ? { recordedState: recorded['state'] } : {}),
			...(recorded?.['owner_run_id'] === null || recorded?.['owner_run_id'] === undefined ? {} : { ownerRunId: String(recorded['owner_run_id']) }),
			...(heartbeatAt === undefined || !Number.isFinite(heartbeatAt.getTime()) ? {} : { heartbeatAt: heartbeatAt.toISOString() }),
		}
	})
}
