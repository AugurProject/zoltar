import { SQL } from 'bun'
import {
	canonicalHistoryPolicies,
	captureDirectObservationInvalidation,
	captureHistoryInvalidation,
	clearInvalidatedDerivedProjections,
	destroyReservedConnection,
	type IndexerLease,
	invalidateCanonicalHistory,
	invalidateHistoryPolicy,
	type PersistedIndexerOwnershipState,
	recordChainReorganization,
	releaseReservedConnection,
	runSerializedIndexerLeaseOperation,
	type SeedNetworkOptions,
	type SourceReplayPlan,
	scannerDatabaseOptions,
	withIndexerLease,
	withOptionalIndexerLease,
} from './database/history.ts'
import {
	assertBlockAppend,
	assertContractDeploymentObservation,
	assertIndexerLeaseObservation,
	assertIndexerLeaseReleaseObservation,
	assertLogScanCursorUpdate,
	assertRewindTarget,
	assertStartBlockCompatible,
	contractMetadataFromRow,
	DatabaseConsistencyError,
	type EvidenceProvenance,
	type HistoryInvalidationReason,
	type IndexedBlock,
	IndexerLeaseReleaseError,
	type IntegrityIssue,
	type InterpretationSourceHashes,
	type LiveEvent,
	type LogScanCursor,
	lockLiveEventWriter,
	manifestContractSetChanged,
	type RichListBalance,
	type RichListBalanceTargets,
	rewindDepth,
	serializedInterpretation,
} from './database/records.ts'
import { databaseJsonText } from './database-json.ts'
import { storeLogProjections } from './database-projections.ts'
import { type Address, getAddress, type Hash } from './ethereum.ts'
import { type EntityStateSnapshot, normalizeSnapshotTarget, type StateSnapshotTarget } from './snapshots.ts'
import type { ContractMetadata, NetworkConfig, TokenMetadata } from './types.ts'

export * from './database/history.ts'
export * from './database/records.ts'

export class ScannerDatabase {
	readonly sql: SQL

	constructor(url: string, maxConnections = 10, connectionTimeoutSeconds = 5) {
		this.sql = new SQL(url, scannerDatabaseOptions(maxConnections, connectionTimeoutSeconds))
	}

	async close(timeoutSeconds = 5): Promise<void> {
		await this.sql.close({ timeout: timeoutSeconds })
	}

	async read<T>(operation: (sql: SQL) => Promise<T>, timeoutMs = 10_000): Promise<T> {
		return await this.sql.begin(async (transaction) => {
			await transaction.unsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
			await transaction`SELECT set_config('statement_timeout', ${timeoutMs.toString()}, true)`
			const versions = await transaction`SELECT current_setting('server_version_num')::integer AS version`
			if (Number(versions[0]?.['version'] ?? 0) >= 170_000) await transaction`SELECT set_config('transaction_timeout', ${timeoutMs.toString()}, true)`
			return await operation(transaction)
		})
	}

	async recordIndexerOwnership(
		chainId: number,
		networkId: string,
		state: PersistedIndexerOwnershipState,
		backendPid: number | undefined,
		ownerRunId: string | undefined,
		sql: SQL = this.sql,
	): Promise<void> {
		await sql`
			INSERT INTO indexer_ownership (chain_id, network_id, state, backend_pid, owner_run_id, heartbeat_at, updated_at)
			VALUES (${chainId}, ${networkId}, ${state}, ${backendPid ?? null}, ${ownerRunId ?? null}, now(), now())
			ON CONFLICT (chain_id) DO UPDATE SET network_id = EXCLUDED.network_id, state = EXCLUDED.state,
				backend_pid = EXCLUDED.backend_pid, owner_run_id = EXCLUDED.owner_run_id,
				heartbeat_at = EXCLUDED.heartbeat_at, updated_at = now()
		`
	}

	async latestEventId(): Promise<number> {
		return await this.read(async (sql) => {
			const rows = await sql`
				SELECT GREATEST(state.pruned_through_id, COALESCE((SELECT max(id) FROM live_events), 0)) AS id
				FROM live_event_state state WHERE singleton
			`
			return Number(rows[0]?.['id'] ?? 0)
		}, 3_000)
	}

	async eventsAfter(id: number, limit = 250): Promise<readonly LiveEvent[]> {
		return await this.read(async (sql) => {
			const rows = await sql`
				WITH event_window AS (
					SELECT state.pruned_through_id,
						GREATEST(state.pruned_through_id, COALESCE((SELECT max(id) FROM live_events), 0)) AS latest_id
					FROM live_event_state state WHERE singleton
				), requested AS (
					SELECT event.id, event.event, event.payload
					FROM live_events event, event_window
					WHERE ${id} >= event_window.pruned_through_id AND ${id} <= event_window.latest_id AND event.id > ${id}
					ORDER BY event.id LIMIT ${limit}
				)
				SELECT id, event, payload FROM requested
				UNION ALL
				SELECT latest_id AS id, 'reset' AS event,
					jsonb_build_object('reason', CASE WHEN ${id} < pruned_through_id THEN 'replay-window-expired' ELSE 'cursor-ahead-of-head' END, 'refreshRequired', true) AS payload
				FROM event_window WHERE ${id} < pruned_through_id OR ${id} > latest_id
				ORDER BY id
			`
			return rows.map((row: Record<string, unknown>) => ({ id: Number(row['id']), event: String(row['event']), payload: row['payload'] }))
		}, 3_000)
	}

	async pruneLiveEvents(): Promise<void> {
		await this.sql.begin(async (transaction) => {
			await lockLiveEventWriter(transaction)
			const rows = await transaction`SELECT COALESCE(max(id), 0) AS id FROM live_events WHERE created_at < now() - interval '7 days'`
			const prunedThroughId = String(rows[0]?.['id'] ?? 0)
			await transaction`DELETE FROM live_events WHERE id <= ${prunedThroughId}`
			await transaction`
				UPDATE live_event_state SET pruned_through_id = GREATEST(pruned_through_id, ${prunedThroughId}), updated_at = now()
				WHERE singleton
			`
		})
	}

	async auditIntegrity(sql: SQL = this.sql): Promise<readonly IntegrityIssue[]> {
		const rows = await sql`
			WITH checkpoint_issues AS (
				SELECT n.chain_id, 'checkpoint_missing'::text AS code,
					'The indexed checkpoint does not identify a canonical stored block'::text AS detail
				FROM networks n
				LEFT JOIN blocks b ON b.chain_id = n.chain_id AND b.number = n.indexed_block AND b.hash = n.indexed_hash AND b.canonical
				WHERE n.indexed_block IS NOT NULL AND b.hash IS NULL
			), cursor_issues AS (
				SELECT cursor.chain_id, 'log_cursor_ahead'::text AS code,
					'Log cursor for ' || cursor.contract_address || ' is ahead of the network checkpoint' AS detail
				FROM log_scan_cursors cursor
				JOIN networks network USING (chain_id)
				WHERE network.indexed_block IS NULL OR cursor.last_retrieved_block > network.indexed_block
			), recent_canonical_blocks AS (
				SELECT b.* FROM blocks b JOIN networks n USING (chain_id)
				WHERE b.canonical AND b.number >= GREATEST(n.start_block, n.indexed_block - 10000)
			), continuity_issues AS (
				SELECT chain_id, 'canonical_discontinuity'::text AS code,
					'Canonical block ' || number || ' does not extend the preceding stored block' AS detail
				FROM (
					SELECT chain_id, number, parent_hash, lag(hash) OVER (PARTITION BY chain_id ORDER BY number) AS previous_hash,
						lag(number) OVER (PARTITION BY chain_id ORDER BY number) AS previous_number
					FROM recent_canonical_blocks
				) ordered
				WHERE previous_number IS NOT NULL AND number = previous_number + 1 AND parent_hash <> previous_hash
			)
			SELECT * FROM checkpoint_issues
			UNION ALL SELECT * FROM cursor_issues
			UNION ALL SELECT * FROM continuity_issues
			ORDER BY chain_id, code LIMIT 100
		`
		return rows.map((row: Record<string, unknown>) => ({ chainId: Number(row['chain_id']), code: String(row['code']), detail: String(row['detail']) }))
	}

	async tryAcquireIndexerLock(chainId: number): Promise<IndexerLease | undefined> {
		const connection = await this.sql.reserve()
		let connectionDisposed = false
		const releaseConnection = async (): Promise<void> => {
			if (connectionDisposed) return
			connectionDisposed = true
			await releaseReservedConnection(connection)
		}
		const destroyConnection = async (): Promise<void> => {
			if (connectionDisposed) return
			connectionDisposed = true
			await destroyReservedConnection(connection)
		}
		try {
			const rows = await connection`SELECT pg_try_advisory_lock(92138472, ${chainId}) AS locked, pg_backend_pid() AS backend_pid`
			if (rows[0]?.['locked'] !== true) {
				await releaseConnection()
				return undefined
			}
			const backendPid = Number(rows[0]?.['backend_pid'])
			let released = false
			let releasePromise: Promise<void> | undefined
			const lease: IndexerLease = {
				backendPid,
				connection,
				assertHeld: async (sql = connection) => {
					if (released) throw new Error('Indexer lease was released')
					const leaseRows = await sql`
						SELECT pg_backend_pid() AS backend_pid, EXISTS (
							SELECT 1 FROM pg_locks
							WHERE locktype = 'advisory'
								AND pid = pg_backend_pid()
								AND classid::bigint = 92138472
								AND objid::bigint = ${chainId}
								AND objsubid = 2
								AND granted
						) AS held
					`
					assertIndexerLeaseObservation(backendPid, Number(leaseRows[0]?.['backend_pid']), leaseRows[0]?.['held'] === true)
				},
				release: () => {
					if (releasePromise !== undefined) return releasePromise
					releasePromise = runSerializedIndexerLeaseOperation(lease, async () => {
						released = true
						try {
							const releaseRows = await connection`
								SELECT pg_backend_pid() AS backend_pid,
									CASE WHEN pg_backend_pid() = ${backendPid}
										THEN pg_advisory_unlock(92138472, ${chainId})
										ELSE false
									END AS unlocked
							`
							assertIndexerLeaseReleaseObservation(backendPid, Number(releaseRows[0]?.['backend_pid']), releaseRows[0]?.['unlocked'] === true)
							await releaseConnection()
						} catch (error) {
							try {
								await destroyConnection()
							} catch (cleanupError) {
								throw new IndexerLeaseReleaseError('Indexer lease unlock failed and its PostgreSQL session could not be terminated', false, [
									error,
									cleanupError,
								])
							}
							throw new IndexerLeaseReleaseError('Indexer lease unlock failed; its PostgreSQL session was terminated', true, error)
						}
					})
					return releasePromise
				},
			}
			return lease
		} catch (error) {
			await releaseConnection()
			throw error
		}
	}

	async seedNetwork(network: NetworkConfig, options: SeedNetworkOptions = {}): Promise<boolean> {
		const { lease, resetCanonicalHistoryOnManifestChange = false, preserveStoredStart = false, sourceReplayPlan, appliedSourceHashes } = options
		if (appliedSourceHashes !== undefined && lease === undefined) throw new DatabaseConsistencyError('Applied source hashes require the network indexer lease')
		const operation = async (transaction: SQL): Promise<boolean> => {
			const existingRows = await transaction`
				SELECT start_block, indexed_block, indexed_hash
				FROM networks
				WHERE chain_id = ${network.chainId}
				FOR UPDATE
			`
			const existing = existingRows[0]
			const hasStoredBlocks =
				existing !== undefined &&
				(await transaction`SELECT EXISTS (SELECT 1 FROM blocks WHERE chain_id = ${network.chainId}) AS present`)[0]?.['present'] === true
			const storedManifestRows =
				existing === undefined
					? []
					: await transaction`
						SELECT address, label, kind, configured_deployment_block
						FROM contracts WHERE chain_id = ${network.chainId} AND provenance = 'manifest' AND canonical
					`
			const manifestChanged =
				existing !== undefined &&
				manifestContractSetChanged(
					network.contracts,
					storedManifestRows.map((row: Record<string, unknown>) => {
						const configuredDeploymentBlock = row['configured_deployment_block']
						return {
							address: String(row['address']),
							label: String(row['label']),
							kind: String(row['kind']),
							...(configuredDeploymentBlock === null || configuredDeploymentBlock === undefined
								? {}
								: { configuredDeploymentBlock: BigInt(String(configuredDeploymentBlock)) }),
						}
					}),
				)
			if (existing !== undefined) {
				assertStartBlockCompatible(
					network.startBlock,
					BigInt(String(existing['start_block'])),
					existing['indexed_block'] === null || existing['indexed_block'] === undefined ? undefined : BigInt(String(existing['indexed_block'])),
					hasStoredBlocks || preserveStoredStart,
				)
			}
			await transaction`
				INSERT INTO networks
					(chain_id, id, name, explorer_base_url, start_block, applied_abi_source_hash, applied_application_source_hash,
						applied_projection_source_hash)
				VALUES (${network.chainId}, ${network.id}, ${network.name}, ${network.explorerBaseUrl}, ${network.startBlock.toString()},
					${appliedSourceHashes?.abiSourceHash ?? null}, ${appliedSourceHashes?.applicationSourceHash ?? null},
					${appliedSourceHashes?.projectionSourceHash ?? null})
				ON CONFLICT (chain_id) DO UPDATE SET
					id = EXCLUDED.id,
					name = EXCLUDED.name,
					explorer_base_url = EXCLUDED.explorer_base_url,
					start_block = EXCLUDED.start_block,
					applied_abi_source_hash = COALESCE(EXCLUDED.applied_abi_source_hash, networks.applied_abi_source_hash),
					applied_application_source_hash = COALESCE(EXCLUDED.applied_application_source_hash, networks.applied_application_source_hash),
					applied_projection_source_hash = COALESCE(EXCLUDED.applied_projection_source_hash, networks.applied_projection_source_hash),
					updated_at = now()
			`
			await transaction`UPDATE contracts SET canonical = false WHERE chain_id = ${network.chainId} AND provenance = 'manifest'`
			for (const [address, label, kind, configuredDeploymentBlock] of network.contracts) {
				await this.upsertContract(
					network.chainId,
					{ address, label, kind, provenance: 'manifest', ...(configuredDeploymentBlock === undefined ? {} : { configuredDeploymentBlock }) },
					transaction,
				)
			}
			await transaction`
				UPDATE contracts AS contract SET
					label = discovery.label,
					kind = discovery.kind,
					provenance = discovery.provenance,
					discovery_block = discovery.block_number,
					discovery_tx_hash = discovery.tx_hash,
					canonical = true
				FROM (
					SELECT DISTINCT ON (address) address, label, kind, provenance, block_number, tx_hash
					FROM contract_discoveries
					WHERE chain_id = ${network.chainId} AND canonical
					ORDER BY address, block_number DESC
				) AS discovery
				WHERE contract.chain_id = ${network.chainId}
					AND contract.address = discovery.address
					AND NOT contract.canonical
			`
			await transaction`
				UPDATE contracts AS contract SET
					label = discovery.label,
					kind = discovery.kind,
					provenance = discovery.provenance,
					canonical = true
				FROM (
					SELECT DISTINCT ON (candidate.address)
						candidate.address, candidate.label, candidate.kind, candidate.provenance
					FROM contract_discoveries AS candidate
					JOIN contracts AS retained
						ON retained.chain_id = candidate.chain_id
						AND retained.address = candidate.address
						AND retained.discovery_block = candidate.block_number
						AND retained.discovery_tx_hash = candidate.tx_hash
					JOIN networks AS network ON network.chain_id = candidate.chain_id
					WHERE candidate.chain_id = ${network.chainId} AND candidate.block_number < network.start_block
					ORDER BY candidate.address, candidate.canonical DESC, candidate.block_hash
				) AS discovery
				WHERE contract.chain_id = ${network.chainId}
					AND contract.address = discovery.address
					AND contract.provenance = 'manifest'
					AND NOT contract.canonical
			`
			await transaction`
				UPDATE contracts SET provenance = 'retired-manifest'
				WHERE chain_id = ${network.chainId} AND provenance = 'manifest' AND NOT canonical
			`
			const manifestResetReason = manifestChanged && resetCanonicalHistoryOnManifestChange ? ('manifest-reset' as const) : undefined
			const resetReason = sourceReplayPlan?.reason ?? manifestResetReason
			const resetCauses =
				resetReason === undefined
					? []
					: [...new Set([resetReason, ...(sourceReplayPlan?.causes ?? []), manifestResetReason].filter((reason) => reason !== undefined))]
			if (resetReason !== undefined && existing?.['indexed_block'] !== null && existing?.['indexed_block'] !== undefined) {
				const previousBlock = BigInt(String(existing['indexed_block']))
				const depth = previousBlock - network.startBlock + 1n
				const invalidationId = await recordChainReorganization(
					transaction,
					network.chainId,
					previousBlock,
					typeof existing['indexed_hash'] === 'string' ? existing['indexed_hash'] : undefined,
					-1n,
					undefined,
					depth,
					resetReason,
					resetCauses,
					appliedSourceHashes,
				)
				await captureHistoryInvalidation(transaction, invalidationId, network.chainId)
				await invalidateCanonicalHistory(transaction, network.chainId)
				if (resetReason === 'manifest-reset' || resetReason === 'abi-redecode' || resetReason === 'projection-rebuild')
					await clearInvalidatedDerivedProjections(transaction, invalidationId)
				await transaction`
					UPDATE networks SET indexed_block = NULL, indexed_hash = NULL, indexed_timestamp = NULL, finalized_block = NULL, phase = 'backfilling',
						last_reorg_at = now(), last_reorg_depth = ${depth.toString()}, updated_at = now()
					WHERE chain_id = ${network.chainId}
				`
				await lockLiveEventWriter(transaction)
				await transaction`
					INSERT INTO live_events (event, payload)
					VALUES ('reorg', (${databaseJsonText({ chainId: network.chainId, previousBlock: previousBlock.toString(), ancestor: '-1', depth: depth.toString(), reason: resetReason, reasons: resetCauses })}::text)::jsonb)
				`
			}
			return manifestChanged || resetReason !== undefined
		}
		if (lease === undefined) return await this.sql.begin(operation)
		return await withIndexerLease(lease, operation)
	}

	async sourceReplayPlan(chainId: number, sourceHashes: InterpretationSourceHashes, lease?: IndexerLease): Promise<SourceReplayPlan | undefined> {
		return await withOptionalIndexerLease(this.sql, lease, async (sql) => {
			const rows = await sql`
					SELECT applied_abi_source_hash, applied_application_source_hash, applied_projection_source_hash, indexed_block
				FROM networks
				WHERE chain_id = ${chainId}
			`
			const row = rows[0]
			const appliedAbiSourceHash = row?.['applied_abi_source_hash']
			const appliedApplicationSourceHash = row?.['applied_application_source_hash']
			const appliedProjectionSourceHash = row?.['applied_projection_source_hash']
			if (row?.['indexed_block'] === null || row?.['indexed_block'] === undefined) return undefined
			if (typeof appliedAbiSourceHash !== 'string' || typeof appliedApplicationSourceHash !== 'string' || typeof appliedProjectionSourceHash !== 'string')
				return { reason: 'abi-redecode', causes: ['abi-redecode', 'projection-rebuild'] }
			const causes: Array<Extract<HistoryInvalidationReason, 'abi-redecode' | 'projection-rebuild'>> = []
			if (appliedAbiSourceHash !== sourceHashes.abiSourceHash) causes.push('abi-redecode')
			if (appliedApplicationSourceHash !== sourceHashes.applicationSourceHash || appliedProjectionSourceHash !== sourceHashes.projectionSourceHash)
				causes.push('projection-rebuild')
			const reason = causes[0]
			return reason === undefined ? undefined : { reason, causes }
		})
	}

	async upsertContract(chainId: number, contract: ContractMetadata, sql: SQL = this.sql): Promise<void> {
		await sql`
			INSERT INTO contracts
				(chain_id, address, label, kind, provenance, discovery_block, discovery_tx_hash, configured_deployment_block)
			VALUES (${chainId}, ${contract.address.toLowerCase()}, ${contract.label}, ${contract.kind}, ${contract.provenance},
				${contract.discoveryBlock?.toString() ?? null}, ${contract.discoveryTxHash ?? null}, ${contract.configuredDeploymentBlock?.toString() ?? null})
			ON CONFLICT (chain_id, address) DO UPDATE SET
				label = CASE WHEN EXCLUDED.provenance = 'manifest' THEN EXCLUDED.label WHEN contracts.provenance = 'manifest' THEN contracts.label ELSE EXCLUDED.label END,
				kind = CASE WHEN EXCLUDED.provenance = 'manifest' THEN EXCLUDED.kind WHEN contracts.provenance = 'manifest' THEN contracts.kind ELSE EXCLUDED.kind END,
				provenance = CASE WHEN EXCLUDED.provenance = 'manifest' OR contracts.provenance = 'manifest' THEN 'manifest' ELSE EXCLUDED.provenance END,
				discovery_block = CASE WHEN EXCLUDED.provenance = 'manifest' AND (contracts.canonical OR contracts.provenance = 'manifest') THEN contracts.discovery_block WHEN EXCLUDED.provenance = 'manifest' THEN NULL WHEN contracts.provenance = 'manifest' THEN contracts.discovery_block ELSE EXCLUDED.discovery_block END,
				discovery_tx_hash = CASE WHEN EXCLUDED.provenance = 'manifest' AND (contracts.canonical OR contracts.provenance = 'manifest') THEN contracts.discovery_tx_hash WHEN EXCLUDED.provenance = 'manifest' THEN NULL WHEN contracts.provenance = 'manifest' THEN contracts.discovery_tx_hash ELSE EXCLUDED.discovery_tx_hash END,
				configured_deployment_block = CASE WHEN EXCLUDED.provenance = 'manifest' THEN EXCLUDED.configured_deployment_block WHEN contracts.provenance = 'manifest' THEN contracts.configured_deployment_block ELSE EXCLUDED.configured_deployment_block END,
				canonical = true
		`
	}

	async contracts(chainId: number, lease?: IndexerLease): Promise<Map<string, ContractMetadata>> {
		return await withOptionalIndexerLease(this.sql, lease, async (sql) => {
			const rows =
				await sql`SELECT address, label, kind, provenance, discovery_block, discovery_tx_hash, configured_deployment_block, deployment_block, deployment_timestamp, deployment_block_exact, deployment_checked_block FROM contracts WHERE chain_id = ${chainId} AND canonical ORDER BY address`
			return new Map(rows.map((row: Record<string, unknown>) => [String(row['address']), contractMetadataFromRow(row)]))
		})
	}

	async contractDeploymentCandidates(chainId: number, observedHead: bigint, lease: IndexerLease): Promise<readonly ContractMetadata[]> {
		const staleBefore = observedHead >= 100n ? observedHead - 100n : -1n
		return await withIndexerLease(lease, async (transaction) => {
			const rows = await transaction`
				SELECT address, label, kind, provenance, discovery_block, discovery_tx_hash, configured_deployment_block, deployment_block, deployment_timestamp,
					deployment_block_exact, deployment_checked_block
				FROM contracts
				WHERE chain_id = ${chainId} AND canonical AND deployment_block IS NULL
					AND (deployment_checked_block IS NULL OR deployment_checked_block <= ${staleBefore.toString()})
				ORDER BY deployment_checked_block NULLS FIRST, label, address
			`
			return rows.map((row: Record<string, unknown>) => contractMetadataFromRow(row))
		})
	}

	async recordContractDeployment(
		chainId: number,
		address: Address,
		checkedBlock: bigint,
		deployment: { readonly block: bigint; readonly timestamp: Date; readonly exact: boolean } | undefined,
		lease: IndexerLease,
	): Promise<void> {
		await withIndexerLease(lease, async (transaction) => {
			await transaction`
				UPDATE contracts SET
					deployment_block = ${deployment?.block.toString() ?? null},
					deployment_timestamp = ${deployment?.timestamp ?? null},
					deployment_block_exact = ${deployment?.exact ?? null},
					deployment_checked_block = ${checkedBlock.toString()}
				WHERE chain_id = ${chainId} AND address = ${address.toLowerCase()} AND canonical
			`
		})
	}

	async tokenMetadata(chainId: number, lease?: IndexerLease): Promise<Map<string, TokenMetadata>> {
		return await withOptionalIndexerLease(this.sql, lease, async (sql) => {
			const rows = await sql`
				SELECT metadata.address, metadata.name, metadata.symbol, metadata.decimals, metadata.read_error, metadata.read_block
				FROM token_metadata metadata
				JOIN blocks block ON block.chain_id = metadata.chain_id AND block.hash = metadata.block_hash AND block.canonical
				JOIN networks network ON network.chain_id = metadata.chain_id
				WHERE metadata.chain_id = ${chainId} AND metadata.canonical AND metadata.read_block <= network.indexed_block
			`
			return new Map(
				rows.map((row: Record<string, unknown>) => {
					const address = String(row['address']) as Address
					return [
						address,
						{
							address,
							...(row['name'] === null ? {} : { name: String(row['name']) }),
							...(row['symbol'] === null ? {} : { symbol: String(row['symbol']) }),
							...(row['decimals'] === null ? {} : { decimals: Number(row['decimals']) }),
							...(row['read_error'] === null ? {} : { readError: String(row['read_error']) }),
							readBlock: BigInt(String(row['read_block'])),
						},
					]
				}),
			)
		})
	}

	async logScanCursors(chainId: number, lease?: IndexerLease): Promise<Map<string, LogScanCursor>> {
		return await withOptionalIndexerLease(this.sql, lease, async (sql) => {
			const rows = await sql`
				SELECT contract_address, start_block, last_retrieved_block
				FROM log_scan_cursors
				WHERE chain_id = ${chainId}
				ORDER BY contract_address
			`
			return new Map(
				rows.map((row: Record<string, unknown>) => {
					const contractAddress = getAddress(String(row['contract_address']))
					return [
						contractAddress.toLowerCase(),
						{
							contractAddress,
							startBlock: BigInt(String(row['start_block'])),
							lastRetrievedBlock: BigInt(String(row['last_retrieved_block'])),
						},
					]
				}),
			)
		})
	}

	async richListBalanceTargets(chainId: number, limit = 10, lease?: IndexerLease): Promise<RichListBalanceTargets> {
		return await withOptionalIndexerLease(this.sql, lease, async (sql) => {
			const addressRows = await sql`
				WITH assets AS (
					SELECT address FROM contracts WHERE chain_id = ${chainId} AND canonical AND kind IN ('reputationToken', 'weth')
				)
				SELECT activity.address
				FROM (SELECT DISTINCT address FROM address_activity WHERE chain_id = ${chainId} AND canonical) activity
				LEFT JOIN LATERAL (
					SELECT max(block_number) AS block_number,
						count(DISTINCT asset_address) FILTER (
							WHERE asset_kind = 'native' OR asset_address IN (SELECT address FROM assets)
						) AS sampled_assets
					FROM address_balance_snapshots snapshot
					JOIN blocks block ON block.chain_id = snapshot.chain_id AND block.hash = snapshot.block_hash AND block.canonical
					JOIN networks network ON network.chain_id = snapshot.chain_id
					WHERE snapshot.chain_id = ${chainId} AND snapshot.address = activity.address AND snapshot.canonical
						AND snapshot.block_number <= network.indexed_block
				) latest ON true
				ORDER BY ((SELECT count(*) FROM assets) + 1 - COALESCE(latest.sampled_assets, 0)) DESC,
					latest.block_number ASC NULLS FIRST, activity.address
				LIMIT ${limit}
			`
			const assetRows = await sql`
				SELECT address, kind FROM contracts
				WHERE chain_id = ${chainId} AND canonical AND kind IN ('reputationToken', 'weth')
				ORDER BY kind, address
			`
			return {
				addresses: addressRows.map((row: Record<string, unknown>) => String(row['address']) as Address),
				assets: assetRows.map((row: Record<string, unknown>) => ({
					address: String(row['address']) as Address,
					kind: row['kind'] === 'weth' ? 'weth' : 'rep',
				})),
			}
		})
	}

	async stateSnapshotTargets(chainId: number, throughBlock: bigint, limit = 25, lease?: IndexerLease): Promise<readonly StateSnapshotTarget[]> {
		return await withOptionalIndexerLease(this.sql, lease, async (sql) => {
			const rows = await sql`
				WITH latest_pools AS (
					SELECT DISTINCT ON (pool_address) pool_address, coordinator_address
					FROM pools WHERE chain_id = ${chainId} AND canonical
					ORDER BY pool_address, block_number DESC, log_index DESC
				), pool_escalations AS (
					SELECT DISTINCT ON (pool_address) pool_address, NULLIF(state->>'escalationGame', '0x0000000000000000000000000000000000000000') AS escalation_address
					FROM pool_state_events WHERE chain_id = ${chainId} AND canonical AND event_name = 'EscalationGameSet'
					ORDER BY pool_address, block_number DESC, log_index DESC
				), latest_vaults AS (
					SELECT DISTINCT ON (pool_address, vault_address) pool_address, vault_address
					FROM vault_snapshots WHERE chain_id = ${chainId} AND canonical
					ORDER BY pool_address, vault_address, block_number DESC, log_index DESC
				), candidates AS (
					SELECT 'pool'::text AS entity_type, pool.pool_address AS entity_identity,
						pool.pool_address AS address, NULL::text AS pool_address,
						pool.coordinator_address, escalation.escalation_address
					FROM latest_pools pool LEFT JOIN pool_escalations escalation USING (pool_address)
					UNION ALL
					SELECT 'vault', vault.pool_address || ':' || vault.vault_address, vault.vault_address,
						vault.pool_address, pool.coordinator_address, escalation.escalation_address
					FROM latest_vaults vault JOIN latest_pools pool USING (pool_address)
					LEFT JOIN pool_escalations escalation USING (pool_address)
					UNION ALL
					SELECT 'escalation', game_address, game_address, NULL, NULL, game_address
					FROM (SELECT DISTINCT game_address FROM escalation_game_events WHERE chain_id = ${chainId} AND canonical) game
					UNION ALL
					SELECT 'auction', auction_address, auction_address, NULL, NULL, NULL
					FROM (SELECT DISTINCT auction_address FROM truth_auction_events WHERE chain_id = ${chainId} AND canonical) auction
				), ranked AS (
					SELECT candidate.*, latest.block_number AS latest_snapshot_block
					FROM candidates candidate
					LEFT JOIN LATERAL (
						SELECT snapshot.block_number FROM entity_state_snapshots snapshot
						JOIN blocks block ON block.chain_id = snapshot.chain_id AND block.hash = snapshot.block_hash AND block.canonical
						WHERE snapshot.chain_id = ${chainId} AND snapshot.entity_type = candidate.entity_type
							AND snapshot.entity_identity = candidate.entity_identity AND snapshot.canonical
						ORDER BY snapshot.block_number DESC, snapshot.observed_at DESC LIMIT 1
					) latest ON true
				)
				SELECT entity_type, entity_identity, address, pool_address, coordinator_address, escalation_address
				FROM ranked WHERE latest_snapshot_block IS NULL OR latest_snapshot_block < ${throughBlock.toString()}
				ORDER BY latest_snapshot_block NULLS FIRST, entity_type, entity_identity LIMIT ${limit}
			`
			return rows.map((row: Record<string, unknown>) => normalizeSnapshotTarget(row))
		})
	}

	async storeEntityStateSnapshots(
		chainId: number,
		blockNumber: bigint,
		blockHash: Hash,
		blockTimestamp: Date,
		snapshots: readonly EntityStateSnapshot[],
		lease: IndexerLease,
		provenance?: EvidenceProvenance,
	): Promise<void> {
		await withIndexerLease(lease, async (transaction) => {
			const canonicalRows = await transaction`
				SELECT 1 FROM blocks WHERE chain_id = ${chainId} AND number = ${blockNumber.toString()}
					AND hash = ${blockHash} AND canonical
			`
			if (canonicalRows.length !== 1) throw new DatabaseConsistencyError('Cannot store entity snapshots for a noncanonical block')
			for (const snapshot of snapshots) {
				await transaction`
					INSERT INTO entity_state_observations (
						chain_id, entity_type, entity_identity, block_number, block_hash, block_timestamp,
						source_method, read_status, read_result, read_failure_reason, canonical, observed_at,
						indexer_run_id, abi_source_hash, application_source_hash, projection_source_hash
					) VALUES (
						${chainId}, ${snapshot.entityType}, ${snapshot.entityIdentity}, ${blockNumber.toString()}, ${blockHash}, ${blockTimestamp},
						${snapshot.sourceMethod}, ${snapshot.readStatus}, (${snapshot.readResult === undefined ? null : databaseJsonText(snapshot.readResult)}::text)::jsonb,
						${snapshot.readFailureReason ?? null}, true, now(), ${provenance?.indexerRunId ?? null}, ${provenance?.abiSourceHash ?? null},
						${provenance?.applicationSourceHash ?? null}, ${provenance?.projectionSourceHash ?? null}
					)
				`
				await transaction`
					INSERT INTO entity_state_snapshots (
						chain_id, entity_type, entity_identity, block_number, block_hash, block_timestamp,
						source_method, read_status, read_result, read_failure_reason, canonical, observed_at,
						indexer_run_id, abi_source_hash, application_source_hash, projection_source_hash
					) VALUES (
						${chainId}, ${snapshot.entityType}, ${snapshot.entityIdentity}, ${blockNumber.toString()}, ${blockHash}, ${blockTimestamp},
						${snapshot.sourceMethod}, ${snapshot.readStatus}, (${snapshot.readResult === undefined ? null : databaseJsonText(snapshot.readResult)}::text)::jsonb,
						${snapshot.readFailureReason ?? null}, true, now(), ${provenance?.indexerRunId ?? null}, ${provenance?.abiSourceHash ?? null},
						${provenance?.applicationSourceHash ?? null}, ${provenance?.projectionSourceHash ?? null}
					)
					ON CONFLICT (chain_id, entity_type, entity_identity, block_hash, source_method) DO UPDATE SET
						read_status = EXCLUDED.read_status, read_result = EXCLUDED.read_result,
						read_failure_reason = EXCLUDED.read_failure_reason, canonical = true, observed_at = now(),
						indexer_run_id = EXCLUDED.indexer_run_id, abi_source_hash = EXCLUDED.abi_source_hash,
						application_source_hash = EXCLUDED.application_source_hash, projection_source_hash = EXCLUDED.projection_source_hash
				`
			}
		})
	}

	async storeRichListBalances(
		chainId: number,
		blockNumber: bigint,
		blockHash: Hash,
		balances: readonly RichListBalance[],
		lease: IndexerLease,
		provenance?: EvidenceProvenance,
	): Promise<void> {
		if (balances.length === 0) return
		await withIndexerLease(lease, async (transaction) => {
			const canonicalRows = await transaction`
				SELECT 1 FROM blocks WHERE chain_id = ${chainId} AND number = ${blockNumber.toString()} AND hash = ${blockHash} AND canonical
			`
			if (canonicalRows.length !== 1) throw new DatabaseConsistencyError('Cannot store rich-list balances for a noncanonical block')
			for (const balance of balances) {
				const readStatus = balance.readStatus ?? 'success'
				await transaction`
					INSERT INTO address_balance_observations (
						chain_id, block_hash, block_number, address, asset_address, asset_kind,
						read_status, balance, read_failure_reason, canonical,
						observed_at, indexer_run_id, abi_source_hash, application_source_hash, projection_source_hash
					) VALUES (
						${chainId}, ${blockHash}, ${blockNumber.toString()}, ${balance.owner.toLowerCase()},
						${balance.assetAddress.toLowerCase()}, ${balance.assetKind}, ${readStatus},
						${balance.balance?.toString() ?? null}, ${balance.readFailureReason ?? null}, true,
						now(), ${provenance?.indexerRunId ?? null}, ${provenance?.abiSourceHash ?? null},
						${provenance?.applicationSourceHash ?? null}, ${provenance?.projectionSourceHash ?? null}
					)
				`
				if (balance.readStatus === 'failed') continue
				await transaction`
					INSERT INTO address_balance_snapshots (chain_id, block_hash, block_number, address, asset_address, asset_kind, balance, canonical, observed_at)
					VALUES (${chainId}, ${blockHash}, ${blockNumber.toString()}, ${balance.owner.toLowerCase()}, ${balance.assetAddress.toLowerCase()}, ${balance.assetKind}, ${balance.balance.toString()}, true, now())
					ON CONFLICT (chain_id, block_hash, address, asset_address) DO UPDATE SET
						asset_kind = EXCLUDED.asset_kind, balance = EXCLUDED.balance, canonical = true, observed_at = now()
				`
			}
		})
	}

	async checkpoint(chainId: number, lease?: IndexerLease): Promise<{ readonly number: bigint; readonly hash: Hash } | undefined> {
		return await withOptionalIndexerLease(this.sql, lease, async (sql) => {
			const rows = await sql`SELECT indexed_block, indexed_hash FROM networks WHERE chain_id = ${chainId}`
			const row = rows[0]
			if (row === undefined || row['indexed_block'] === null || row['indexed_hash'] === null) return undefined
			return { number: BigInt(String(row['indexed_block'])), hash: String(row['indexed_hash']) as Hash }
		})
	}

	async networkStartBlock(chainId: number, lease?: IndexerLease): Promise<bigint | undefined> {
		return await withOptionalIndexerLease(this.sql, lease, async (sql) => {
			const rows = await sql`SELECT start_block FROM networks WHERE chain_id = ${chainId}`
			const startBlock = rows[0]?.['start_block']
			return startBlock === undefined ? undefined : BigInt(String(startBlock))
		})
	}

	async hasStoredBlocks(chainId: number, lease?: IndexerLease): Promise<boolean> {
		return await withOptionalIndexerLease(this.sql, lease, async (sql) => {
			const rows = await sql`SELECT EXISTS (SELECT 1 FROM blocks WHERE chain_id = ${chainId}) AS present`
			return rows[0]?.['present'] === true
		})
	}

	async storedBlockTip(chainId: number, lease?: IndexerLease): Promise<bigint | undefined> {
		return await withOptionalIndexerLease(this.sql, lease, async (sql) => {
			const rows = await sql`SELECT max(number) AS number FROM blocks WHERE chain_id = ${chainId}`
			const number = rows[0]?.['number']
			return number === null || number === undefined ? undefined : BigInt(String(number))
		})
	}

	async canonicalHash(chainId: number, number: bigint, lease?: IndexerLease): Promise<Hash | undefined> {
		return await withOptionalIndexerLease(this.sql, lease, async (sql) => {
			const rows = await sql`SELECT hash FROM blocks WHERE chain_id = ${chainId} AND number = ${number.toString()} AND canonical`
			const hash = rows[0]?.['hash']
			return hash === undefined ? undefined : (String(hash) as Hash)
		})
	}

	async canonicalCheckpointAtOrBefore(
		chainId: number,
		number: bigint,
		lease?: IndexerLease,
	): Promise<{ readonly number: bigint; readonly hash: Hash } | undefined> {
		return await withOptionalIndexerLease(this.sql, lease, async (sql) => {
			const rows = await sql`
				SELECT number, hash FROM blocks
				WHERE chain_id = ${chainId} AND number <= ${number.toString()} AND canonical
				ORDER BY number DESC LIMIT 1
			`
			const row = rows[0]
			return row === undefined ? undefined : { number: BigInt(String(row['number'])), hash: String(row['hash']) as Hash }
		})
	}

	async rewind(
		chainId: number,
		ancestor: bigint,
		ancestorHash: Hash | undefined,
		lease: IndexerLease,
		reason: Extract<HistoryInvalidationReason, 'chain-reorg' | 'manifest-reset'> = 'chain-reorg',
		provenance?: EvidenceProvenance,
	): Promise<void> {
		await withIndexerLease(lease, async (transaction) => {
			const checkpointRows = await transaction`SELECT start_block, indexed_block, indexed_hash FROM networks WHERE chain_id = ${chainId} FOR UPDATE`
			const checkpoint = checkpointRows[0]
			if (checkpoint === undefined) throw new Error(`Network ${chainId} must be seeded before rewinding`)
			const targetRows =
				ancestor < 0n
					? []
					: await transaction`SELECT 1 FROM blocks WHERE chain_id = ${chainId} AND number = ${ancestor.toString()} AND hash = ${ancestorHash ?? ''} AND canonical`
			assertRewindTarget(
				ancestor,
				ancestorHash,
				{
					...(checkpoint['indexed_block'] === null ? {} : { indexedBlock: BigInt(String(checkpoint['indexed_block'])) }),
					...(checkpoint['indexed_hash'] === null ? {} : { indexedHash: String(checkpoint['indexed_hash']) }),
				},
				targetRows.length === 1,
			)
			const previousBlock = BigInt(String(checkpoint['indexed_block']))
			const reorgDepth = rewindDepth(previousBlock, BigInt(String(checkpoint['start_block'])), ancestor)
			const invalidationId = await recordChainReorganization(
				transaction,
				chainId,
				previousBlock,
				typeof checkpoint['indexed_hash'] === 'string' ? checkpoint['indexed_hash'] : undefined,
				ancestor,
				ancestorHash,
				reorgDepth,
				reason,
				[reason],
				provenance,
			)
			await captureHistoryInvalidation(transaction, invalidationId, chainId, ancestor)
			await captureDirectObservationInvalidation(transaction, invalidationId, chainId, { afterBlock: ancestor })
			for (const policy of canonicalHistoryPolicies) await invalidateHistoryPolicy(transaction, policy, chainId, { comparison: '>', block: ancestor })
			await transaction`DELETE FROM log_scan_cursors WHERE chain_id = ${chainId} AND start_block > ${ancestor.toString()}`
			await transaction`
				UPDATE log_scan_cursors SET
					last_retrieved_block = GREATEST(start_block - 1, ${ancestor.toString()}::bigint),
					updated_at = now()
				WHERE chain_id = ${chainId} AND last_retrieved_block > ${ancestor.toString()}
			`
			await transaction`
				UPDATE contracts SET
					deployment_block = CASE WHEN deployment_block > ${ancestor.toString()} THEN NULL ELSE deployment_block END,
					deployment_timestamp = CASE WHEN deployment_block > ${ancestor.toString()} THEN NULL ELSE deployment_timestamp END,
					deployment_block_exact = CASE WHEN deployment_block > ${ancestor.toString()} THEN NULL ELSE deployment_block_exact END,
					deployment_checked_block = CASE WHEN deployment_checked_block > ${ancestor.toString()} THEN NULL ELSE deployment_checked_block END
				WHERE chain_id = ${chainId} AND (deployment_block > ${ancestor.toString()} OR deployment_checked_block > ${ancestor.toString()})
			`
			await transaction`
				UPDATE contracts SET canonical = false
				WHERE chain_id = ${chainId} AND provenance <> 'manifest'
					AND (discovery_block IS NULL OR discovery_block >= ${String(checkpoint['start_block'])})
					AND (discovery_block IS NULL OR discovery_block > ${ancestor.toString()})
			`
			await transaction`
				UPDATE contracts AS contract SET
					label = discovery.label,
					kind = discovery.kind,
					provenance = discovery.provenance,
					discovery_block = discovery.block_number,
					discovery_tx_hash = discovery.tx_hash,
					canonical = true
				FROM (
					SELECT DISTINCT ON (address) address, label, kind, provenance, block_number, tx_hash
					FROM contract_discoveries
					WHERE chain_id = ${chainId} AND canonical
					ORDER BY address, block_number DESC
				) AS discovery
				WHERE contract.chain_id = ${chainId}
					AND contract.address = discovery.address
					AND NOT contract.canonical
			`
			await transaction`
				UPDATE token_metadata AS metadata SET canonical = true, updated_at = now()
				FROM (
					SELECT DISTINCT ON (candidate.address) candidate.address, candidate.block_hash
					FROM token_metadata AS candidate
					JOIN blocks AS block ON block.chain_id = candidate.chain_id AND block.hash = candidate.block_hash
					WHERE candidate.chain_id = ${chainId} AND block.canonical
					ORDER BY candidate.address, candidate.read_block DESC, candidate.updated_at DESC
				) AS previous
				WHERE metadata.chain_id = ${chainId}
					AND metadata.address = previous.address
					AND metadata.block_hash = previous.block_hash
					AND NOT metadata.canonical
			`
			await transaction`
				UPDATE networks SET indexed_block = ${ancestor < 0n ? null : ancestor.toString()}, indexed_hash = ${ancestorHash ?? null},
					indexed_timestamp = (SELECT timestamp FROM blocks WHERE chain_id = ${chainId} AND hash = ${ancestorHash ?? null}), phase = 'backfilling',
					last_reorg_at = now(), last_reorg_depth = ${reorgDepth.toString()}, updated_at = now()
				WHERE chain_id = ${chainId}
			`
			await lockLiveEventWriter(transaction)
			await transaction`
				INSERT INTO live_events (event, payload)
				VALUES ('reorg', (${databaseJsonText({ chainId, previousBlock: previousBlock.toString(), ancestor: ancestor.toString(), depth: reorgDepth.toString(), reason })}::text)::jsonb)
			`
		})
	}

	async storeBlock(chainId: number, block: IndexedBlock, lease: IndexerLease, provenance?: EvidenceProvenance): Promise<void> {
		await this.storeBlocks(chainId, [block], lease, provenance)
	}

	async storeBlocks(
		chainId: number,
		blocks: readonly IndexedBlock[],
		lease: IndexerLease,
		provenance?: EvidenceProvenance,
		validateBeforeCommit: () => Promise<void> = async () => {},
	): Promise<void> {
		await withIndexerLease(lease, async (transaction) => {
			for (const block of blocks) await this.#storeBlock(transaction, chainId, block, provenance)
			await validateBeforeCommit()
		})
	}

	async #storeBlock(transaction: SQL, chainId: number, block: IndexedBlock, provenance?: EvidenceProvenance): Promise<void> {
		const checkpointRows = await transaction`SELECT start_block, indexed_block, indexed_hash FROM networks WHERE chain_id = ${chainId} FOR UPDATE`
		const checkpoint = checkpointRows[0]
		if (checkpoint === undefined) throw new Error(`Network ${chainId} must be seeded before indexing`)
		assertBlockAppend(block, {
			startBlock: BigInt(String(checkpoint['start_block'])),
			...(checkpoint['indexed_block'] === null ? {} : { indexedBlock: BigInt(String(checkpoint['indexed_block'])) }),
			...(checkpoint['indexed_hash'] === null ? {} : { indexedHash: String(checkpoint['indexed_hash']) }),
		})
		await transaction`
				INSERT INTO blocks (chain_id, number, hash, parent_hash, timestamp, canonical, finalized)
				VALUES (${chainId}, ${block.number.toString()}, ${block.hash}, ${block.parentHash}, ${block.timestamp}, true, ${block.number <= block.finalizedThrough})
				ON CONFLICT (chain_id, hash) DO UPDATE SET canonical = true, finalized = EXCLUDED.finalized
			`
		for (const metadata of block.tokenMetadata) {
			const readStatus = metadata.readError === undefined ? 'success' : 'failed'
			await transaction`
					INSERT INTO token_metadata_observations (
						chain_id, address, block_hash, name, symbol, decimals, read_status, read_error, read_block, canonical,
						observed_at, indexer_run_id, abi_source_hash, application_source_hash, projection_source_hash
					) VALUES (
						${chainId}, ${metadata.address.toLowerCase()}, ${block.hash}, ${metadata.name ?? null}, ${metadata.symbol ?? null},
						${metadata.decimals ?? null}, ${readStatus}, ${metadata.readError ?? null}, ${metadata.readBlock.toString()}, true,
						now(), ${provenance?.indexerRunId ?? null}, ${provenance?.abiSourceHash ?? null},
						${provenance?.applicationSourceHash ?? null}, ${provenance?.projectionSourceHash ?? null}
					)
				`
			if (readStatus === 'failed') {
				const successfulCurrentMetadata = await transaction`
						SELECT 1 FROM token_metadata
						WHERE chain_id = ${chainId} AND address = ${metadata.address.toLowerCase()}
							AND canonical AND read_error IS NULL
						LIMIT 1
					`
				if (successfulCurrentMetadata.length > 0) continue
			}
			await transaction`UPDATE token_metadata SET canonical = false WHERE chain_id = ${chainId} AND address = ${metadata.address.toLowerCase()} AND canonical AND block_hash <> ${block.hash}`
			await transaction`
					INSERT INTO token_metadata (chain_id, address, block_hash, name, symbol, decimals, read_error, read_block, canonical, updated_at)
					VALUES (${chainId}, ${metadata.address.toLowerCase()}, ${block.hash}, ${metadata.name ?? null}, ${metadata.symbol ?? null}, ${metadata.decimals ?? null}, ${metadata.readError ?? null}, ${metadata.readBlock.toString()}, true, now())
					ON CONFLICT (chain_id, address, block_hash) DO UPDATE SET name = EXCLUDED.name, symbol = EXCLUDED.symbol, decimals = EXCLUDED.decimals, read_error = EXCLUDED.read_error, read_block = EXCLUDED.read_block, canonical = true, updated_at = now()
				`
		}
		for (const contract of block.contracts) {
			if (contract.discoveryTxHash === undefined || contract.discoveryBlock === undefined)
				throw new Error('Dynamic contract discovery is missing its chain position')
			await transaction`
					INSERT INTO contract_discoveries (chain_id, address, block_hash, block_number, tx_hash, label, kind, provenance, canonical)
					VALUES (${chainId}, ${contract.address.toLowerCase()}, ${block.hash}, ${contract.discoveryBlock.toString()}, ${contract.discoveryTxHash}, ${contract.label}, ${contract.kind}, ${contract.provenance}, true)
					ON CONFLICT (chain_id, address, block_hash, tx_hash) DO UPDATE SET canonical = true
				`
			await transaction`
					INSERT INTO contracts (chain_id, address, label, kind, provenance, discovery_block, discovery_tx_hash, canonical, deployment_block, deployment_timestamp, deployment_block_exact, deployment_checked_block)
					VALUES (${chainId}, ${contract.address.toLowerCase()}, ${contract.label}, ${contract.kind}, ${contract.provenance}, ${contract.discoveryBlock?.toString() ?? null}, ${contract.discoveryTxHash ?? null}, true, ${contract.discoveryBlock.toString()}, ${block.timestamp}, true, ${block.number.toString()})
					ON CONFLICT (chain_id, address) DO UPDATE SET
						canonical = true,
						label = CASE WHEN contracts.provenance = 'manifest' THEN contracts.label ELSE EXCLUDED.label END,
						kind = CASE WHEN contracts.provenance = 'manifest' THEN contracts.kind ELSE EXCLUDED.kind END,
						provenance = CASE WHEN contracts.provenance = 'manifest' THEN contracts.provenance ELSE EXCLUDED.provenance END,
						discovery_block = CASE WHEN contracts.provenance = 'manifest' THEN contracts.discovery_block ELSE EXCLUDED.discovery_block END,
						discovery_tx_hash = CASE WHEN contracts.provenance = 'manifest' THEN contracts.discovery_tx_hash ELSE EXCLUDED.discovery_tx_hash END,
						deployment_block = COALESCE(contracts.deployment_block, EXCLUDED.deployment_block),
						deployment_timestamp = COALESCE(contracts.deployment_timestamp, EXCLUDED.deployment_timestamp),
						deployment_block_exact = COALESCE(contracts.deployment_block_exact, EXCLUDED.deployment_block_exact),
						deployment_checked_block = GREATEST(contracts.deployment_checked_block, EXCLUDED.deployment_checked_block)
				`
		}
		for (const observation of block.contractDeploymentObservations) {
			assertContractDeploymentObservation(block.number, observation)
			await transaction`
					UPDATE contracts SET
						deployment_block = ${observation.deployment?.block.toString() ?? null},
						deployment_timestamp = ${observation.deployment?.timestamp ?? null},
						deployment_block_exact = ${observation.deployment?.exact ?? null},
						deployment_checked_block = ${observation.checkedBlock.toString()}
					WHERE chain_id = ${chainId} AND address = ${observation.contractAddress.toLowerCase()} AND canonical
				`
		}
		for (const item of block.transactions) {
			await transaction`
					INSERT INTO transactions (chain_id, hash, block_hash, block_number, transaction_index, from_address, to_address, value, input, status, gas_used, receipt, canonical)
					VALUES (${chainId}, ${item.hash}, ${block.hash}, ${block.number.toString()}, ${item.transactionIndex}, ${item.from.toLowerCase()}, ${item.to?.toLowerCase() ?? null}, ${item.value.toString()}, ${item.input}, ${item.status}, ${item.gasUsed.toString()}, (${databaseJsonText(item.receipt)}::text)::jsonb, true)
					ON CONFLICT (chain_id, block_hash, hash) DO UPDATE SET canonical = true
				`
			await transaction`
					INSERT INTO actions (chain_id, block_hash, tx_hash, contract_address, function_name, function_signature, arguments, display_arguments, argument_schema, decode_status, decode_error, summary)
					VALUES (${chainId}, ${block.hash}, ${item.hash}, ${item.to?.toLowerCase() ?? null}, ${item.decoded.name ?? null}, ${item.decoded.signature ?? null}, (${databaseJsonText(item.decoded.arguments ?? null)}::text)::jsonb, (${databaseJsonText(item.decoded.displayArguments ?? null)}::text)::jsonb, (${databaseJsonText(item.decoded.argumentSchema ?? [])}::text)::jsonb, ${item.decoded.status}, ${item.decoded.error ?? null}, ${item.decoded.summary})
					ON CONFLICT (chain_id, block_hash, tx_hash) DO UPDATE SET function_name = EXCLUDED.function_name, function_signature = EXCLUDED.function_signature, arguments = EXCLUDED.arguments, display_arguments = EXCLUDED.display_arguments, argument_schema = EXCLUDED.argument_schema, decode_status = EXCLUDED.decode_status, decode_error = EXCLUDED.decode_error, summary = EXCLUDED.summary
				`
			if (provenance !== undefined)
				await transaction`
						INSERT INTO action_interpretations
							(chain_id, block_hash, tx_hash, indexer_run_id, abi_source_hash, application_source_hash, interpretation)
						VALUES (${chainId}, ${block.hash}, ${item.hash}, ${provenance.indexerRunId}, ${provenance.abiSourceHash},
							${provenance.applicationSourceHash}, (${serializedInterpretation(item.decoded)}::text)::jsonb)
						ON CONFLICT DO NOTHING
					`
		}
		for (const activity of block.addressActivity) {
			await transaction`
					INSERT INTO address_activity (chain_id, block_hash, block_number, tx_hash, address, pool_address, role, canonical)
					VALUES (${chainId}, ${block.hash}, ${block.number.toString()}, ${activity.transactionHash}, ${activity.address.toLowerCase()}, ${activity.poolAddress?.toLowerCase() ?? '0x0000000000000000000000000000000000000000'}, ${activity.role}, true)
					ON CONFLICT (chain_id, block_hash, tx_hash, address, pool_address) DO UPDATE SET role = CASE WHEN EXCLUDED.role = 'sender' THEN 'sender' ELSE address_activity.role END, canonical = true
				`
		}
		for (const item of block.logs) {
			await transaction`
					INSERT INTO logs (chain_id, tx_hash, block_hash, block_number, transaction_index, log_index, emitter_address, topics, data, event_name, event_signature, arguments, display_arguments, argument_schema, decode_status, decode_error, summary, canonical, finalized)
					VALUES (${chainId}, ${item.transactionHash}, ${item.blockHash}, ${item.blockNumber.toString()}, ${item.transactionIndex}, ${item.logIndex}, ${item.address.toLowerCase()}, (${databaseJsonText(item.topics)}::text)::jsonb, ${item.data}, ${item.decoded.name ?? null}, ${item.decoded.signature ?? null}, (${databaseJsonText(item.decoded.arguments ?? null)}::text)::jsonb, (${databaseJsonText(item.decoded.displayArguments ?? null)}::text)::jsonb, (${databaseJsonText(item.decoded.argumentSchema ?? [])}::text)::jsonb, ${item.decoded.status}, ${item.decoded.error ?? null}, ${item.decoded.summary}, true, ${item.blockNumber <= block.finalizedThrough})
					ON CONFLICT (chain_id, block_hash, tx_hash, log_index) DO UPDATE SET canonical = true, finalized = EXCLUDED.finalized, event_name = EXCLUDED.event_name, event_signature = EXCLUDED.event_signature, arguments = EXCLUDED.arguments, display_arguments = EXCLUDED.display_arguments, argument_schema = EXCLUDED.argument_schema, decode_status = EXCLUDED.decode_status, decode_error = EXCLUDED.decode_error, summary = EXCLUDED.summary
				`
			if (provenance !== undefined)
				await transaction`
						INSERT INTO log_interpretations
							(chain_id, block_hash, tx_hash, log_index, interpretation_kind, interpretation_key,
								indexer_run_id, abi_source_hash, application_source_hash, projection_source_hash, interpretation)
						VALUES (${chainId}, ${item.blockHash}, ${item.transactionHash}, ${item.logIndex}, 'decode', 'decode',
							${provenance.indexerRunId}, ${provenance.abiSourceHash}, ${provenance.applicationSourceHash},
							${provenance.projectionSourceHash}, (${serializedInterpretation(item.decoded)}::text)::jsonb)
						ON CONFLICT DO NOTHING
					`
			await storeLogProjections(transaction, chainId, item, provenance)
		}
		for (const cursor of block.logScanCursors) {
			assertLogScanCursorUpdate(block.number, cursor)
			await transaction`
					INSERT INTO log_scan_cursors (chain_id, contract_address, start_block, last_retrieved_block, updated_at)
					VALUES (${chainId}, ${cursor.contractAddress.toLowerCase()}, ${cursor.startBlock.toString()}, ${cursor.lastRetrievedBlock.toString()}, now())
					ON CONFLICT (chain_id, contract_address) DO UPDATE SET
						start_block = LEAST(log_scan_cursors.start_block, EXCLUDED.start_block),
						last_retrieved_block = EXCLUDED.last_retrieved_block,
						updated_at = now()
					WHERE log_scan_cursors.last_retrieved_block <= EXCLUDED.last_retrieved_block
				`
		}
		await transaction`UPDATE blocks SET finalized = true WHERE chain_id = ${chainId} AND canonical AND NOT finalized AND number <= ${block.finalizedThrough.toString()}`
		await transaction`UPDATE logs SET finalized = true WHERE chain_id = ${chainId} AND canonical AND NOT finalized AND block_number <= ${block.finalizedThrough.toString()}`
		await transaction`
				UPDATE networks SET indexed_block = ${block.number.toString()}, indexed_hash = ${block.hash}, indexed_timestamp = ${block.timestamp}, observed_block = ${block.observedHead.toString()}, finalized_block = ${block.finalizedThrough.toString()}, phase = ${block.number >= block.observedHead ? 'live' : 'backfilling'}, last_poll_at = now(), last_success_at = now(), last_error = null, failure_started_at = null, consecutive_failures = 0, next_retry_at = null, updated_at = now()
				WHERE chain_id = ${chainId}
			`
		await lockLiveEventWriter(transaction)
		await transaction`
				INSERT INTO live_events (event, payload)
				VALUES ('block', (${databaseJsonText({ chainId, blockNumber: block.number.toString(), logs: block.logs.length })}::text)::jsonb)
			`
	}

	async updateObservedHead(chainId: number, head: bigint, phase: string, lease: IndexerLease): Promise<void> {
		await withIndexerLease(lease, async (transaction) => {
			await transaction`UPDATE networks SET observed_block = ${head.toString()}, phase = ${phase}, last_poll_at = now(), last_success_at = now(), last_error = null, failure_started_at = null, consecutive_failures = 0, next_retry_at = null, updated_at = now() WHERE chain_id = ${chainId}`
			await lockLiveEventWriter(transaction)
			await transaction`INSERT INTO live_events (event, payload) VALUES ('status', (${databaseJsonText({ chainId, blockNumber: head.toString() })}::text)::jsonb)`
		})
	}

	async advanceNetworkStartBlock(chainId: number, startBlock: bigint, lease: IndexerLease, provenance?: EvidenceProvenance): Promise<boolean> {
		return await withIndexerLease(lease, async (transaction) => {
			const rows = await transaction`SELECT start_block, indexed_block, indexed_hash FROM networks WHERE chain_id = ${chainId} FOR UPDATE`
			const row = rows[0]
			if (row === undefined) throw new DatabaseConsistencyError(`Network ${chainId} is not initialized`)
			const storedStartBlock = BigInt(String(row['start_block']))
			if (startBlock <= storedStartBlock) return false
			const previousBlock = row['indexed_block'] === null || row['indexed_block'] === undefined ? undefined : BigInt(String(row['indexed_block']))
			const invalidatedDepth = previousBlock === undefined ? 0n : previousBlock - storedStartBlock + 1n
			const invalidationId = await recordChainReorganization(
				transaction,
				chainId,
				previousBlock,
				typeof row['indexed_hash'] === 'string' ? row['indexed_hash'] : undefined,
				-1n,
				undefined,
				invalidatedDepth,
				'start-boundary-advanced',
				['start-boundary-advanced'],
				provenance,
			)
			await captureHistoryInvalidation(transaction, invalidationId, chainId)
			await captureDirectObservationInvalidation(transaction, invalidationId, chainId, { beforeBlock: startBlock })
			await invalidateCanonicalHistory(transaction, chainId, startBlock)
			await transaction`
				UPDATE networks SET start_block = ${startBlock.toString()}, indexed_block = NULL, indexed_hash = NULL,
					indexed_timestamp = NULL, finalized_block = NULL, phase = 'backfilling', last_poll_at = now(),
					last_success_at = now(), last_error = NULL, failure_started_at = NULL, consecutive_failures = 0,
					last_reorg_at = now(), last_reorg_depth = ${invalidatedDepth.toString()},
					next_retry_at = NULL, updated_at = now()
				WHERE chain_id = ${chainId}
			`
			await lockLiveEventWriter(transaction)
			await transaction`
				INSERT INTO live_events (event, payload)
				VALUES ('reorg', (${databaseJsonText({ chainId, previousBlock: previousBlock?.toString(), ancestor: '-1', depth: invalidatedDepth.toString(), startBlock: startBlock.toString(), reason: 'start-boundary-advanced' })}::text)::jsonb)
			`
			return true
		})
	}

	async recordFailure(chainId: number, message: string, nextRetryAt: Date, lease: IndexerLease): Promise<void> {
		await withIndexerLease(lease, async (transaction) => {
			const rows = await transaction`
				UPDATE networks SET phase = 'degraded', last_error = ${message.slice(0, 2000)}, last_poll_at = now(),
					failure_started_at = COALESCE(failure_started_at, now()), consecutive_failures = consecutive_failures + 1,
					next_retry_at = ${nextRetryAt}, updated_at = now()
				WHERE chain_id = ${chainId}
				RETURNING consecutive_failures
			`
			await lockLiveEventWriter(transaction)
			await transaction`
				INSERT INTO live_events (event, payload)
				VALUES ('status', (${databaseJsonText({ chainId, phase: 'degraded', nextRetryAt: nextRetryAt.toISOString(), failures: Number(rows[0]?.['consecutive_failures'] ?? 1) })}::text)::jsonb)
			`
		})
	}
}
