import type { ReservedSQL, SQL } from 'bun'
import { DatabaseConsistencyError, type EvidenceProvenance, type HistoryInvalidationReason } from './records.ts'

export type SourceReplayPlan = {
	readonly reason: Extract<HistoryInvalidationReason, 'abi-redecode' | 'projection-rebuild'>
	readonly causes: readonly Extract<HistoryInvalidationReason, 'abi-redecode' | 'projection-rebuild'>[]
}

export const recordChainReorganization = async (
	transaction: SQL,
	chainId: number,
	previousBlock: bigint | undefined,
	previousHash: string | undefined,
	ancestorBlock: bigint,
	ancestorHash: string | undefined,
	depth: bigint,
	reason: HistoryInvalidationReason,
	causes: readonly HistoryInvalidationReason[] = [reason],
	provenance?: EvidenceProvenance,
): Promise<string> => {
	const rows = await transaction`
		INSERT INTO chain_reorganizations
			(chain_id, previous_block, previous_hash, ancestor_block, ancestor_hash, depth, reason,
				indexer_run_id, abi_source_hash, application_source_hash, projection_source_hash)
		VALUES
			(${chainId}, ${previousBlock?.toString() ?? null}, ${previousHash ?? null}, ${ancestorBlock.toString()}, ${ancestorHash ?? null},
				${depth.toString()}, ${reason}, ${provenance?.indexerRunId ?? null}, ${provenance?.abiSourceHash ?? null},
				${provenance?.applicationSourceHash ?? null}, ${provenance?.projectionSourceHash ?? null})
		RETURNING id::text
	`
	const id = rows[0]?.['id']
	if (typeof id !== 'string' || !/^\d+$/.test(id)) throw new DatabaseConsistencyError('Unable to record history invalidation')
	for (const cause of new Set([reason, ...causes]))
		await transaction`
			INSERT INTO history_invalidation_causes (invalidation_id, reason)
			VALUES (${id}, ${cause})
			ON CONFLICT DO NOTHING
		`
	return id
}

export const captureHistoryInvalidation = async (transaction: SQL, invalidationId: string, chainId: number, afterBlock?: bigint): Promise<void> => {
	const blockBoundary = afterBlock === undefined ? transaction`` : transaction`AND number > ${afterBlock.toString()}`
	const transactionBoundary = afterBlock === undefined ? transaction`` : transaction`AND block_number > ${afterBlock.toString()}`
	await transaction`
		INSERT INTO history_invalidation_occurrences
			(invalidation_id, occurrence_kind, chain_id, block_hash, occurrence_id, sub_index)
		SELECT ${invalidationId}, 'block', chain_id, hash, hash, 0
		FROM blocks WHERE chain_id = ${chainId} AND canonical ${blockBoundary}
		ON CONFLICT DO NOTHING
	`
	await transaction`
		INSERT INTO history_invalidation_occurrences
			(invalidation_id, occurrence_kind, chain_id, block_hash, occurrence_id, sub_index)
		SELECT ${invalidationId}, 'transaction', chain_id, block_hash, hash, transaction_index
		FROM transactions WHERE chain_id = ${chainId} AND canonical ${transactionBoundary}
		ON CONFLICT DO NOTHING
	`
	await transaction`
		INSERT INTO history_invalidation_occurrences
			(invalidation_id, occurrence_kind, chain_id, block_hash, occurrence_id, sub_index)
		SELECT ${invalidationId}, 'log', chain_id, block_hash, tx_hash, log_index
		FROM logs WHERE chain_id = ${chainId} AND canonical ${transactionBoundary}
		ON CONFLICT DO NOTHING
	`
	await transaction`
		INSERT INTO history_invalidation_occurrences
			(invalidation_id, occurrence_kind, chain_id, block_hash, occurrence_id, sub_index)
		SELECT ${invalidationId}, 'entity-state', chain_id, block_hash, id::text, 0
		FROM entity_state_observations WHERE chain_id = ${chainId} AND canonical ${transactionBoundary}
		ON CONFLICT DO NOTHING
	`
}

export const captureDirectObservationInvalidation = async (transaction: SQL, invalidationId: string, chainId: number, boundary: { readonly afterBlock?: bigint; readonly beforeBlock?: bigint }): Promise<void> => {
	if (boundary.afterBlock !== undefined && boundary.beforeBlock !== undefined) throw new DatabaseConsistencyError('Direct observation invalidation must use one block boundary')
	const balanceBoundary = boundary.afterBlock !== undefined ? transaction`AND block_number > ${boundary.afterBlock.toString()}` : boundary.beforeBlock !== undefined ? transaction`AND block_number < ${boundary.beforeBlock.toString()}` : transaction``
	const metadataBoundary = boundary.afterBlock !== undefined ? transaction`AND read_block > ${boundary.afterBlock.toString()}` : boundary.beforeBlock !== undefined ? transaction`AND read_block < ${boundary.beforeBlock.toString()}` : transaction``
	await transaction`
		INSERT INTO history_invalidation_occurrences
			(invalidation_id, occurrence_kind, chain_id, block_hash, occurrence_id, sub_index)
		SELECT ${invalidationId}, 'address-balance', chain_id, block_hash, id::text, 0
		FROM address_balance_observations WHERE chain_id = ${chainId} AND canonical ${balanceBoundary}
		ON CONFLICT DO NOTHING
	`
	await transaction`
		INSERT INTO history_invalidation_occurrences
			(invalidation_id, occurrence_kind, chain_id, block_hash, occurrence_id, sub_index)
		SELECT ${invalidationId}, 'token-metadata', chain_id, block_hash, id::text, 0
		FROM token_metadata_observations WHERE chain_id = ${chainId} AND canonical ${metadataBoundary}
		ON CONFLICT DO NOTHING
	`
}

const derivedProjectionTables = [
	'questions',
	'pools',
	'pool_snapshots',
	'pool_state_events',
	'vault_snapshots',
	'universe_events',
	'amm_markets',
	'amm_price_snapshots',
	'rep_eth_price_snapshots',
	'uniswap_rep_eth_markets',
	'uniswap_rep_eth_price_observations',
	'protocol_timeline_entries',
	'open_oracle_report_events',
	'escalation_game_events',
	'truth_auction_events',
	'amm_trade_events',
	'fork_migration_events',
	'liquidation_approval_events',
] as const

export const clearInvalidatedDerivedProjections = async (transaction: SQL, invalidationId: string): Promise<void> => {
	for (const table of derivedProjectionTables)
		await transaction.unsafe(
			`DELETE FROM ${table} AS derived USING history_invalidation_occurrences AS invalidation
			 WHERE invalidation.invalidation_id = $1 AND invalidation.occurrence_kind = 'log'
				AND derived.chain_id = invalidation.chain_id AND derived.block_hash = invalidation.block_hash
				AND derived.tx_hash = invalidation.occurrence_id AND derived.log_index = invalidation.sub_index`,
			[invalidationId],
		)
	await transaction.unsafe(
		`DELETE FROM contract_discoveries AS discovery USING history_invalidation_occurrences AS invalidation
		 WHERE invalidation.invalidation_id = $1 AND invalidation.occurrence_kind = 'transaction'
			AND discovery.chain_id = invalidation.chain_id AND discovery.block_hash = invalidation.block_hash
			AND discovery.tx_hash = invalidation.occurrence_id`,
		[invalidationId],
	)
	await transaction.unsafe(
		`DELETE FROM address_activity AS activity USING history_invalidation_occurrences AS invalidation
		 WHERE invalidation.invalidation_id = $1 AND invalidation.occurrence_kind = 'transaction'
			AND activity.chain_id = invalidation.chain_id AND activity.block_hash = invalidation.block_hash
			AND activity.tx_hash = invalidation.occurrence_id`,
		[invalidationId],
	)
}

export type CanonicalHistoryTablePolicy = {
	readonly kind: 'history'
	readonly table: string
	readonly rewindColumn: 'number' | 'block_number' | 'read_block'
	readonly clearFinalized?: true
	readonly staleOnInvalidation?: true
	readonly invalidateOnFullReplay: boolean
}

export type CanonicalTablePolicy = CanonicalHistoryTablePolicy | { readonly kind: 'contract-registry'; readonly table: 'contracts' }

export const canonicalTablePolicies = [
	{ kind: 'history', table: 'blocks', rewindColumn: 'number', clearFinalized: true, invalidateOnFullReplay: true },
	{ kind: 'history', table: 'transactions', rewindColumn: 'block_number', invalidateOnFullReplay: true },
	{ kind: 'history', table: 'logs', rewindColumn: 'block_number', clearFinalized: true, invalidateOnFullReplay: true },
	{ kind: 'history', table: 'contract_discoveries', rewindColumn: 'block_number', invalidateOnFullReplay: true },
	{ kind: 'history', table: 'questions', rewindColumn: 'block_number', invalidateOnFullReplay: true },
	{ kind: 'history', table: 'pools', rewindColumn: 'block_number', invalidateOnFullReplay: true },
	{ kind: 'history', table: 'pool_snapshots', rewindColumn: 'block_number', invalidateOnFullReplay: true },
	{ kind: 'history', table: 'pool_state_events', rewindColumn: 'block_number', invalidateOnFullReplay: true },
	{ kind: 'history', table: 'vault_snapshots', rewindColumn: 'block_number', invalidateOnFullReplay: true },
	{ kind: 'history', table: 'universe_events', rewindColumn: 'block_number', invalidateOnFullReplay: true },
	{ kind: 'history', table: 'amm_markets', rewindColumn: 'block_number', invalidateOnFullReplay: true },
	{ kind: 'history', table: 'amm_price_snapshots', rewindColumn: 'block_number', invalidateOnFullReplay: true },
	{ kind: 'history', table: 'rep_eth_price_snapshots', rewindColumn: 'block_number', invalidateOnFullReplay: true },
	{ kind: 'history', table: 'uniswap_rep_eth_markets', rewindColumn: 'block_number', invalidateOnFullReplay: true },
	{ kind: 'history', table: 'uniswap_rep_eth_price_observations', rewindColumn: 'block_number', invalidateOnFullReplay: true },
	{ kind: 'history', table: 'protocol_timeline_entries', rewindColumn: 'block_number', invalidateOnFullReplay: true },
	{ kind: 'history', table: 'open_oracle_report_events', rewindColumn: 'block_number', invalidateOnFullReplay: true },
	{ kind: 'history', table: 'escalation_game_events', rewindColumn: 'block_number', invalidateOnFullReplay: true },
	{ kind: 'history', table: 'truth_auction_events', rewindColumn: 'block_number', invalidateOnFullReplay: true },
	{ kind: 'history', table: 'amm_trade_events', rewindColumn: 'block_number', invalidateOnFullReplay: true },
	{ kind: 'history', table: 'fork_migration_events', rewindColumn: 'block_number', invalidateOnFullReplay: true },
	{ kind: 'history', table: 'liquidation_approval_events', rewindColumn: 'block_number', invalidateOnFullReplay: true },
	{ kind: 'history', table: 'entity_state_snapshots', rewindColumn: 'block_number', staleOnInvalidation: true, invalidateOnFullReplay: false },
	{ kind: 'history', table: 'entity_state_observations', rewindColumn: 'block_number', invalidateOnFullReplay: false },
	{ kind: 'history', table: 'address_activity', rewindColumn: 'block_number', invalidateOnFullReplay: true },
	{ kind: 'history', table: 'address_balance_snapshots', rewindColumn: 'block_number', invalidateOnFullReplay: false },
	{ kind: 'history', table: 'address_balance_observations', rewindColumn: 'block_number', invalidateOnFullReplay: false },
	{ kind: 'history', table: 'token_metadata', rewindColumn: 'read_block', invalidateOnFullReplay: false },
	{ kind: 'history', table: 'token_metadata_observations', rewindColumn: 'read_block', invalidateOnFullReplay: false },
	{ kind: 'contract-registry', table: 'contracts' },
] as const satisfies readonly CanonicalTablePolicy[]

export const canonicalHistoryPolicies = canonicalTablePolicies.filter((policy): policy is (typeof canonicalTablePolicies)[number] & CanonicalHistoryTablePolicy => policy.kind === 'history')

export const invalidateHistoryPolicy = async (transaction: SQL, policy: CanonicalHistoryTablePolicy, chainId: number, boundary?: { readonly comparison: '<' | '>'; readonly block: bigint }): Promise<void> => {
	const assignments = [policy.staleOnInvalidation ? "read_status = 'stale'" : undefined, 'canonical = false', policy.clearFinalized ? 'finalized = false' : undefined].filter(assignment => assignment !== undefined).join(', ')
	const boundaryClause = boundary === undefined ? '' : ` AND ${policy.rewindColumn} ${boundary.comparison} $2`
	await transaction.unsafe(`UPDATE ${policy.table} SET ${assignments} WHERE chain_id = $1${boundaryClause} AND canonical`, boundary === undefined ? [chainId] : [chainId, boundary.block.toString()])
}

export const invalidateCanonicalHistory = async (transaction: SQL, chainId: number, discoveryRetirementFloor?: bigint): Promise<void> => {
	for (const policy of canonicalHistoryPolicies) {
		if (policy.invalidateOnFullReplay) await invalidateHistoryPolicy(transaction, policy, chainId)
		else if (discoveryRetirementFloor !== undefined) await invalidateHistoryPolicy(transaction, policy, chainId, { comparison: '<', block: discoveryRetirementFloor })
	}
	await transaction`DELETE FROM log_scan_cursors WHERE chain_id = ${chainId}`
	await transaction`
		UPDATE contracts SET deployment_block = NULL, deployment_timestamp = NULL,
			deployment_block_exact = NULL, deployment_checked_block = NULL
		WHERE chain_id = ${chainId}
	`
	if (discoveryRetirementFloor === undefined)
		await transaction`
			UPDATE contracts SET canonical = false
			WHERE chain_id = ${chainId} AND provenance <> 'manifest'
				AND (discovery_block IS NULL OR discovery_block >= (SELECT start_block FROM networks WHERE chain_id = ${chainId}))
		`
	else
		await transaction`
			UPDATE contracts SET canonical = false
			WHERE chain_id = ${chainId} AND provenance <> 'manifest'
				AND (discovery_block IS NULL OR discovery_block >= ${discoveryRetirementFloor.toString()})
		`
}

export const releaseReservedConnection = async (connection: Pick<ReservedSQL, 'release'>): Promise<void> => {
	await connection.release()
}

export const destroyReservedConnection = async (connection: Pick<ReservedSQL, 'close'>): Promise<void> => {
	await connection.close({ timeout: 0 })
}

export type IndexerLease = {
	readonly backendPid: number
	readonly connection: ReservedSQL
	readonly assertHeld: (sql?: SQL) => Promise<void>
	readonly release: () => Promise<void>
}

export type PersistedIndexerOwnershipState = 'owned' | 'standby' | 'released' | 'release-failed' | 'unknown'

const pendingLeaseOperations = new WeakMap<object, Promise<void>>()

export const runSerializedIndexerLeaseOperation = async <T>(lease: object, operation: () => Promise<T>): Promise<T> => {
	const previous = pendingLeaseOperations.get(lease) ?? Promise.resolve()
	const result = previous.then(operation)
	const completion = result.then(
		() => {},
		() => {},
	)
	pendingLeaseOperations.set(lease, completion)
	try {
		return await result
	} finally {
		if (pendingLeaseOperations.get(lease) === completion) pendingLeaseOperations.delete(lease)
	}
}

export const withIndexerLease = async <T>(lease: IndexerLease, operation: (transaction: SQL) => Promise<T>): Promise<T> =>
	await runSerializedIndexerLeaseOperation(lease, async () => {
		await lease.assertHeld(lease.connection)
		await lease.connection.unsafe('BEGIN')
		try {
			await lease.assertHeld(lease.connection)
			const result = await operation(lease.connection)
			await lease.connection.unsafe('COMMIT')
			return result
		} catch (error) {
			try {
				await lease.connection.unsafe('ROLLBACK')
			} catch (rollbackError) {
				throw new AggregateError([error, rollbackError], 'Indexer transaction failed and could not be rolled back')
			}
			throw error
		}
	})

export const withOptionalIndexerLease = async <T>(sql: SQL, lease: IndexerLease | undefined, operation: (sql: SQL) => Promise<T>): Promise<T> => (lease === undefined ? await operation(sql) : await withIndexerLease(lease, operation))

export const scannerDatabaseOptions = (maxConnections: number, connectionTimeoutSeconds: number) => ({
	max: maxConnections,
	idleTimeout: 0,
	maxLifetime: 0,
	connectionTimeout: connectionTimeoutSeconds,
})

export type SeedNetworkOptions = {
	readonly lease?: IndexerLease
	readonly resetCanonicalHistoryOnManifestChange?: boolean
	readonly preserveStoredStart?: boolean
	readonly sourceReplayPlan?: SourceReplayPlan
	readonly appliedSourceHashes?: EvidenceProvenance
}
