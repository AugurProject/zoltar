import type { SQL } from 'bun'
import { type IndexerOwnershipDiagnostic, type OwnershipRow, reconcileIndexerOwnership } from './indexer-ownership-reconciliation.ts'
import type { IntegrityIssue } from './records.ts'

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
