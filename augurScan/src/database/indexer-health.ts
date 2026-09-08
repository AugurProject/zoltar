import type { SQL } from 'bun'
import type { IntegrityIssue } from './records.ts'

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

type OwnershipRow = Record<string, unknown>

export const reconcileIndexerOwnership = (
	networks: readonly OwnershipRow[],
	ownership: readonly OwnershipRow[],
	locks: readonly OwnershipRow[],
	staleBefore: number,
): readonly IndexerOwnershipDiagnostic[] => {
	const recordedByChain = new Map(ownership.map((row) => [Number(row['chain_id']), row]))
	const lockByChain = new Map(locks.map((row) => [Number(row['chain_id']), Number(row['backend_pid'])]))
	return networks.map((network) => {
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

export const readIndexerHealth = async (
	sql: SQL,
	auditIntegrity: (sql: SQL) => Promise<readonly IntegrityIssue[]>,
	freshnessThresholdMs: number,
	now = Date.now(),
): Promise<{
	readonly status: 'healthy' | 'degraded'
	readonly networks: readonly OwnershipRow[]
	readonly ownership: readonly IndexerOwnershipDiagnostic[]
	readonly staleChainIds: readonly number[]
	readonly integrityIssues: readonly IntegrityIssue[]
}> => {
	const [networks, ownership, locks, integrityIssues] = await Promise.all([
		sql`SELECT chain_id, id, phase, last_poll_at, last_success_at, consecutive_failures, next_retry_at, last_error FROM networks ORDER BY chain_id`,
		sql`SELECT chain_id, network_id, state, backend_pid, owner_run_id, heartbeat_at, updated_at FROM indexer_ownership ORDER BY chain_id`,
		sql`
			SELECT objid::bigint AS chain_id, pid AS backend_pid
			FROM pg_locks
			WHERE locktype = 'advisory' AND classid::bigint = 92138472 AND objsubid = 2 AND granted
			ORDER BY objid, pid
		`,
		auditIntegrity(sql),
	])
	const staleBefore = now - freshnessThresholdMs
	const stale = networks.filter((row: OwnershipRow) => row['last_success_at'] === null || new Date(String(row['last_success_at'])).getTime() < staleBefore)
	const reconciledOwnership = reconcileIndexerOwnership(networks, ownership, locks, staleBefore)
	const ownershipHealthy = reconciledOwnership.every(({ state }) => state === 'owned' || state === 'standby')
	return {
		status: integrityIssues.length === 0 && stale.length === 0 && ownershipHealthy ? 'healthy' : 'degraded',
		networks,
		ownership: reconciledOwnership,
		staleChainIds: stale.map((row: OwnershipRow) => Number(row['chain_id'])),
		integrityIssues,
	}
}
