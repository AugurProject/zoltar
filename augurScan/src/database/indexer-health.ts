import type { SQL } from 'bun'
import { type IndexerOwnershipDiagnostic, type OwnershipRow, reconcileIndexerOwnership } from './indexer-ownership-reconciliation.ts'
import type { IntegrityIssue } from './records.ts'

type EnabledNetwork = { readonly id: string; readonly chainId: number }

/**
 * Reports the health of the networks this process enables. An enabled network whose indexer has never recorded its
 * row is missing and degrades health; retained rows of a network that `NETWORKS` no longer enables are ignored.
 */
export const readIndexerHealth = async (
	sql: SQL,
	auditIntegrity: (sql: SQL) => Promise<readonly IntegrityIssue[]>,
	enabledNetworks: readonly EnabledNetwork[],
	freshnessThresholdMs: number,
	now = Date.now(),
): Promise<{
	readonly status: 'healthy' | 'degraded'
	readonly networks: readonly OwnershipRow[]
	readonly ownership: readonly IndexerOwnershipDiagnostic[]
	readonly staleChainIds: readonly number[]
	readonly missingNetworks: readonly EnabledNetwork[]
	readonly integrityIssues: readonly IntegrityIssue[]
}> => {
	const enabledChainIds = sql.array(
		enabledNetworks.map(({ chainId }) => chainId),
		'INT4',
	)
	const [networks, ownership, locks, auditedIssues] = await Promise.all([
		sql`SELECT chain_id, id, phase, last_poll_at, last_success_at, consecutive_failures, next_retry_at, last_error FROM networks WHERE chain_id = ANY(${enabledChainIds}) ORDER BY chain_id`,
		sql`SELECT chain_id, network_id, state, backend_pid, owner_run_id, heartbeat_at, updated_at FROM indexer_ownership WHERE chain_id = ANY(${enabledChainIds}) ORDER BY chain_id`,
		sql`
			SELECT objid::bigint AS chain_id, pid AS backend_pid
			FROM pg_locks
			WHERE locktype = 'advisory' AND classid::bigint = 92138472 AND objsubid = 2 AND granted
			ORDER BY objid, pid
		`,
		auditIntegrity(sql),
	])
	const enabledChainIdSet = new Set(enabledNetworks.map(({ chainId }) => chainId))
	const integrityIssues = auditedIssues.filter(issue => enabledChainIdSet.has(issue.chainId))
	const staleBefore = now - freshnessThresholdMs
	const recordedChainIds = new Set(networks.map((row: OwnershipRow) => Number(row['chain_id'])))
	const missingNetworks = enabledNetworks.filter(({ chainId }) => !recordedChainIds.has(chainId)).map(({ id, chainId }) => ({ id, chainId }))
	const stale = networks.filter((row: OwnershipRow) => row['last_success_at'] === null || new Date(String(row['last_success_at'])).getTime() < staleBefore)
	const reconciledOwnership = reconcileIndexerOwnership(networks, ownership, locks, staleBefore)
	const ownershipHealthy = reconciledOwnership.every(({ state }) => state === 'owned' || state === 'standby')
	return {
		status: integrityIssues.length === 0 && stale.length === 0 && missingNetworks.length === 0 && ownershipHealthy ? 'healthy' : 'degraded',
		networks,
		ownership: reconciledOwnership,
		staleChainIds: stale.map((row: OwnershipRow) => Number(row['chain_id'])),
		missingNetworks,
		integrityIssues,
	}
}
