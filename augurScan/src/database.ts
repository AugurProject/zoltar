import { type ReservedSQL, SQL, type TransactionSQL } from 'bun'
import { type Address, getAddress, type Hash, type Hex, zeroAddress } from './ethereum.ts'
import { projectionsFrom } from './projections.ts'
import { type EntityStateSnapshot, normalizeSnapshotTarget, type StateSnapshotTarget } from './snapshots.ts'
import type { ContractMetadata, DecodedRecord, ManifestContract, NetworkConfig, StoredLog, TokenMetadata } from './types.ts'
import { isSupportedUniswapV4Market } from './uniswap.ts'

export type StoredTransaction = {
	readonly hash: Hash
	readonly transactionIndex: number
	readonly from: Address
	readonly to: Address | null
	readonly value: bigint
	readonly input: Hex
	readonly status: 'success'
	readonly gasUsed: bigint
	readonly receipt: unknown
	readonly decoded: DecodedRecord
}

export type IndexedBlock = {
	readonly number: bigint
	readonly hash: Hash
	readonly parentHash: Hash
	readonly timestamp: Date
	readonly observedHead: bigint
	readonly finalizedThrough: bigint
	readonly contracts: readonly ContractMetadata[]
	readonly tokenMetadata: readonly TokenMetadata[]
	readonly transactions: readonly StoredTransaction[]
	readonly logs: readonly StoredLog[]
	readonly addressActivity: readonly AddressActivity[]
	readonly contractDeploymentObservations: readonly ContractDeploymentObservation[]
	readonly logScanCursors: readonly LogScanCursor[]
}

export type ContractDeploymentObservation = {
	readonly contractAddress: Address
	readonly checkedBlock: bigint
	readonly deployment?: {
		readonly block: bigint
		readonly timestamp: Date
		readonly exact: boolean
	}
}

export type LogScanCursor = {
	readonly contractAddress: Address
	readonly startBlock: bigint
	readonly lastRetrievedBlock: bigint
}

export const manifestContractSetChanged = (
	configured: readonly ManifestContract[],
	stored: readonly { readonly address: string; readonly label: string; readonly kind: string }[],
): boolean => {
	const identity = ({ address, label, kind }: { readonly address: string; readonly label: string; readonly kind: string }): string =>
		`${address.toLowerCase()}\u0000${label}\u0000${kind}`
	const configuredIdentities = configured.map(([address, label, kind]) => identity({ address, label, kind })).sort()
	const storedIdentities = stored.map(identity).sort()
	return configuredIdentities.length !== storedIdentities.length || configuredIdentities.some((value, index) => value !== storedIdentities[index])
}

export type AddressActivity = {
	readonly transactionHash: Hash
	readonly address: Address
	readonly poolAddress?: Address
	readonly role: 'sender' | 'referenced'
}

type RichListAsset = {
	readonly address: Address
	readonly kind: 'rep' | 'weth'
}

export type RichListBalance = {
	readonly owner: Address
	readonly assetAddress: Address
	readonly assetKind: 'native' | 'rep' | 'weth'
	readonly balance: bigint
}

export type RichListBalanceTargets = {
	readonly addresses: readonly Address[]
	readonly assets: readonly RichListAsset[]
}

export type LiveEvent = {
	readonly id: number
	readonly event: string
	readonly payload: unknown
}

export type IntegrityIssue = {
	readonly chainId: number
	readonly code: string
	readonly detail: string
}

type StoredCheckpoint = {
	readonly startBlock: bigint
	readonly indexedBlock?: bigint
	readonly indexedHash?: string
}

const contractMetadataFromRow = (row: Record<string, unknown>): ContractMetadata => {
	const address = String(row['address']) as Address
	return {
		address,
		label: String(row['label']),
		kind: String(row['kind']),
		provenance: String(row['provenance']),
		...(row['discovery_block'] === null || row['discovery_block'] === undefined ? {} : { discoveryBlock: BigInt(String(row['discovery_block'])) }),
		...(row['discovery_tx_hash'] === null || row['discovery_tx_hash'] === undefined ? {} : { discoveryTxHash: String(row['discovery_tx_hash']) as Hash }),
		...(row['deployment_block'] === null || row['deployment_block'] === undefined ? {} : { deploymentBlock: BigInt(String(row['deployment_block'])) }),
		...(row['deployment_timestamp'] === null || row['deployment_timestamp'] === undefined
			? {}
			: { deploymentTimestamp: new Date(String(row['deployment_timestamp'])) }),
		...(row['deployment_block_exact'] === null || row['deployment_block_exact'] === undefined
			? {}
			: { deploymentBlockExact: row['deployment_block_exact'] === true || row['deployment_block_exact'] === 'true' }),
		...(row['deployment_checked_block'] === null || row['deployment_checked_block'] === undefined
			? {}
			: { deploymentCheckedBlock: BigInt(String(row['deployment_checked_block'])) }),
	}
}

type RewindCheckpoint = {
	readonly indexedBlock?: bigint
	readonly indexedHash?: string
}

type DatabaseConsistencyDiagnostic =
	| { readonly code: 'lease-backend-moved'; readonly expectedBackendPid: number; readonly observedBackendPid: number }
	| { readonly code: 'lease-not-held'; readonly expectedBackendPid: number }
	| { readonly code: 'lease-release-failed'; readonly expectedBackendPid: number }
	| { readonly code: 'checkpoint-before-start'; readonly indexedBlock: bigint; readonly storedStartBlock: bigint }
	| { readonly code: 'manifest-backfill-ancestor-missing'; readonly ancestor: bigint }
	| { readonly code: 'manifest-history-before-start'; readonly replayStart: bigint; readonly storedStartBlock: bigint }
	| { readonly code: 'start-block-history-mismatch'; readonly configuredStartBlock: bigint; readonly storedStartBlock: bigint }
	| {
			readonly code: 'start-block-mismatch'
			readonly configuredStartBlock: bigint
			readonly storedStartBlock: bigint
			readonly indexedBlock: bigint
	  }

export class DatabaseConsistencyError extends Error {
	override name = 'DatabaseConsistencyError'

	constructor(
		message: string,
		readonly diagnostic?: DatabaseConsistencyDiagnostic,
	) {
		super(message)
	}
}

export const databaseConsistencyDiagnosticMessage = (error: DatabaseConsistencyError): string | undefined => {
	const diagnostic = error.diagnostic
	if (diagnostic?.code === 'lease-backend-moved') {
		if (!Number.isSafeInteger(diagnostic.expectedBackendPid) || !Number.isSafeInteger(diagnostic.observedBackendPid)) return undefined
		return `Indexer lease moved from PostgreSQL backend ${diagnostic.expectedBackendPid} to ${diagnostic.observedBackendPid}; use a direct connection or a session-mode pooler`
	}
	if (diagnostic?.code === 'lease-not-held') {
		if (!Number.isSafeInteger(diagnostic.expectedBackendPid)) return undefined
		return `Indexer lease is no longer held by PostgreSQL backend ${diagnostic.expectedBackendPid}`
	}
	if (diagnostic?.code === 'lease-release-failed') {
		if (!Number.isSafeInteger(diagnostic.expectedBackendPid)) return undefined
		return `Indexer lease unlock failed on PostgreSQL backend ${diagnostic.expectedBackendPid}; lock ownership may already be lost`
	}
	if (diagnostic?.code === 'checkpoint-before-start') {
		if (typeof diagnostic.indexedBlock !== 'bigint' || typeof diagnostic.storedStartBlock !== 'bigint') return undefined
		return `Stored checkpoint ${diagnostic.indexedBlock} is below configured start block ${diagnostic.storedStartBlock}; rebuild the augurScan database from the configured start block`
	}
	if (diagnostic?.code === 'manifest-backfill-ancestor-missing') {
		if (typeof diagnostic.ancestor !== 'bigint' || diagnostic.ancestor < 0n) return undefined
		return `Manifest backfill cannot find canonical block ${diagnostic.ancestor}; rebuild the augurScan database from the configured start block`
	}
	if (diagnostic?.code === 'manifest-history-before-start') {
		if (typeof diagnostic.replayStart !== 'bigint' || typeof diagnostic.storedStartBlock !== 'bigint') return undefined
		return `Newly tracked deployment block ${diagnostic.replayStart} predates the stored index start ${diagnostic.storedStartBlock}; rebuild the augurScan database to capture its complete history`
	}
	if (diagnostic?.code === 'start-block-history-mismatch') {
		if (typeof diagnostic.configuredStartBlock !== 'bigint' || typeof diagnostic.storedStartBlock !== 'bigint') return undefined
		return `Cannot change the configured start block from ${diagnostic.storedStartBlock} to ${diagnostic.configuredStartBlock} while an effective index start is retained; rebuild the augurScan database from the new start block`
	}
	if (diagnostic?.code === 'start-block-mismatch') {
		if (typeof diagnostic.configuredStartBlock !== 'bigint' || typeof diagnostic.storedStartBlock !== 'bigint' || typeof diagnostic.indexedBlock !== 'bigint')
			return undefined
		return `Cannot change the configured start block from ${diagnostic.storedStartBlock} to ${diagnostic.configuredStartBlock} while checkpoint ${diagnostic.indexedBlock} exists; rebuild the augurScan database from the new start block`
	}
	return undefined
}

export const assertIndexerLeaseObservation = (expectedBackendPid: number, observedBackendPid: number, held: boolean): void => {
	if (observedBackendPid !== expectedBackendPid)
		throw new DatabaseConsistencyError(
			`Indexer lease moved from PostgreSQL backend ${expectedBackendPid} to ${observedBackendPid}; use a direct connection or a session-mode pooler`,
			{ code: 'lease-backend-moved', expectedBackendPid, observedBackendPid },
		)
	if (!held)
		throw new DatabaseConsistencyError(`Indexer lease is no longer held by PostgreSQL backend ${expectedBackendPid}`, {
			code: 'lease-not-held',
			expectedBackendPid,
		})
}

export const assertIndexerLeaseReleaseObservation = (expectedBackendPid: number, observedBackendPid: number, unlocked: boolean): void => {
	assertIndexerLeaseObservation(expectedBackendPid, observedBackendPid, true)
	if (!unlocked)
		throw new DatabaseConsistencyError(`Indexer lease unlock failed on PostgreSQL backend ${expectedBackendPid}; lock ownership may already be lost`, {
			code: 'lease-release-failed',
			expectedBackendPid,
		})
}

export const assertBlockAppend = (block: Pick<IndexedBlock, 'number' | 'parentHash'>, checkpoint: StoredCheckpoint): void => {
	if (checkpoint.indexedBlock === undefined) {
		if (checkpoint.indexedHash !== undefined) throw new DatabaseConsistencyError('The database checkpoint has a block hash without a block number')
		if (block.number !== checkpoint.startBlock)
			throw new DatabaseConsistencyError(`Cannot index block ${block.number}; the network must start at block ${checkpoint.startBlock}`)
		return
	}
	if (checkpoint.indexedHash === undefined) throw new DatabaseConsistencyError('The database checkpoint has a block number without a block hash')
	const expectedNumber = checkpoint.indexedBlock + 1n
	if (block.number !== expectedNumber)
		throw new DatabaseConsistencyError(`Cannot index block ${block.number}; the next database checkpoint must be block ${expectedNumber}`)
	if (block.parentHash !== checkpoint.indexedHash) throw new DatabaseConsistencyError(`Block ${block.number} does not extend the current database checkpoint`)
}

export const assertStartBlockCompatible = (configuredStartBlock: bigint, storedStartBlock: bigint, indexedBlock?: bigint, hasStoredBlocks = false): void => {
	if (indexedBlock === undefined) {
		if (!hasStoredBlocks || configuredStartBlock === storedStartBlock) return
		throw new DatabaseConsistencyError(
			`Cannot change the configured start block from ${storedStartBlock} to ${configuredStartBlock} while an effective index start is retained; rebuild the augurScan database from the new start block`,
			{ code: 'start-block-history-mismatch', configuredStartBlock, storedStartBlock },
		)
	}
	if (indexedBlock < storedStartBlock)
		throw new DatabaseConsistencyError(
			`Stored checkpoint ${indexedBlock} is below configured start block ${storedStartBlock}; rebuild the augurScan database from the configured start block`,
			{ code: 'checkpoint-before-start', indexedBlock, storedStartBlock },
		)
	if (configuredStartBlock === storedStartBlock) return
	throw new DatabaseConsistencyError(
		`Cannot change the configured start block from ${storedStartBlock} to ${configuredStartBlock} while checkpoint ${indexedBlock} exists; rebuild the augurScan database from the new start block`,
		{ code: 'start-block-mismatch', configuredStartBlock, storedStartBlock, indexedBlock },
	)
}

export const assertLogScanCursorUpdate = (blockNumber: bigint, cursor: LogScanCursor): void => {
	if (cursor.lastRetrievedBlock !== blockNumber)
		throw new DatabaseConsistencyError(`Log cursor ${cursor.contractAddress} must advance to committed block ${blockNumber}`)
	if (cursor.startBlock < 0n || cursor.lastRetrievedBlock < cursor.startBlock)
		throw new DatabaseConsistencyError(`Log cursor ${cursor.contractAddress} has an invalid retrieval boundary`)
}

export const assertContractDeploymentObservation = (blockNumber: bigint, observation: ContractDeploymentObservation): void => {
	if (observation.checkedBlock !== blockNumber)
		throw new DatabaseConsistencyError(`Contract deployment observation ${observation.contractAddress} must be anchored to committed block ${blockNumber}`)
	if (observation.deployment !== undefined && (observation.deployment.block < 0n || observation.deployment.block > observation.checkedBlock))
		throw new DatabaseConsistencyError(`Contract deployment observation ${observation.contractAddress} has an invalid deployment boundary`)
}

export const assertRewindTarget = (ancestor: bigint, ancestorHash: string | undefined, checkpoint: RewindCheckpoint, targetIsCanonical: boolean): void => {
	if (checkpoint.indexedBlock === undefined || checkpoint.indexedHash === undefined)
		throw new DatabaseConsistencyError('Cannot rewind a network without a complete indexed checkpoint')
	if (ancestor < -1n || ancestor >= checkpoint.indexedBlock)
		throw new DatabaseConsistencyError('The rewind target must precede the current database checkpoint')
	if (ancestor === -1n) {
		if (ancestorHash !== undefined) throw new DatabaseConsistencyError('A full rewind must not specify an ancestor hash')
		return
	}
	if (ancestorHash === undefined || !targetIsCanonical) throw new DatabaseConsistencyError('The rewind target is not a canonical stored block')
}

export const rewindDepth = (previousBlock: bigint, startBlock: bigint, ancestor: bigint): bigint => previousBlock - (ancestor < 0n ? startBlock - 1n : ancestor)

export const replayWindowExpired = (cursor: number, prunedThroughId: number): boolean => cursor < prunedThroughId

export const lockLiveEventWriter = async (sql: SQL): Promise<void> => {
	await sql`SELECT singleton FROM live_event_state WHERE singleton FOR UPDATE`
}

export const releaseReservedConnection = async (connection: Pick<ReservedSQL, 'release'>): Promise<void> => {
	await connection.release()
}

export const runFencedIndexerTransaction = async <TTransaction, TResult>(
	begin: (operation: (transaction: TTransaction) => Promise<TResult>) => Promise<TResult>,
	assertHeld: (transaction: TTransaction) => Promise<void>,
	operation: (transaction: TTransaction) => Promise<TResult>,
): Promise<TResult> =>
	await begin(async (transaction) => {
		await assertHeld(transaction)
		return await operation(transaction)
	})

export type IndexerLease = {
	readonly backendPid: number
	readonly connection: ReservedSQL
	readonly assertHeld: (sql?: SQL) => Promise<void>
	readonly release: () => Promise<void>
}

const withIndexerLease = async <T>(lease: IndexerLease, operation: (transaction: TransactionSQL) => Promise<T>): Promise<T> =>
	await runFencedIndexerTransaction(
		async (fencedOperation) => await lease.connection.begin(fencedOperation),
		async (transaction) => await lease.assertHeld(transaction),
		operation,
	)

const withOptionalIndexerLease = async <T>(sql: SQL, lease: IndexerLease | undefined, operation: (sql: SQL) => Promise<T>): Promise<T> =>
	lease === undefined ? await operation(sql) : await withIndexerLease(lease, operation)

export const scannerDatabaseOptions = (maxConnections: number, connectionTimeoutSeconds: number) => ({
	max: maxConnections,
	idleTimeout: 0,
	maxLifetime: 0,
	connectionTimeout: connectionTimeoutSeconds,
})

export class ScannerDatabase {
	readonly sql: SQL

	constructor(url: string, maxConnections = 10, connectionTimeoutSeconds = 5) {
		this.sql = new SQL(url, scannerDatabaseOptions(maxConnections, connectionTimeoutSeconds))
	}

	async close(): Promise<void> {
		await this.sql.close()
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

	async latestEventId(): Promise<number> {
		return await this.read(async (sql) => {
			const rows = await sql`SELECT COALESCE(max(id), 0) AS id FROM live_events`
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
					WHERE ${id} >= event_window.pruned_through_id AND event.id > ${id}
					ORDER BY event.id LIMIT ${limit}
				)
				SELECT id, event, payload FROM requested
				UNION ALL
				SELECT latest_id AS id, 'reset' AS event,
					jsonb_build_object('reason', 'replay-window-expired', 'refreshRequired', true) AS payload
				FROM event_window WHERE ${id} < pruned_through_id
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
				WHERE previous_number IS NOT NULL AND (number <> previous_number + 1 OR parent_hash <> previous_hash)
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
		let connectionReleased = false
		const releaseConnection = async (): Promise<void> => {
			if (connectionReleased) return
			connectionReleased = true
			await releaseReservedConnection(connection)
		}
		try {
			const rows = await connection`SELECT pg_try_advisory_lock(92138472, ${chainId}) AS locked, pg_backend_pid() AS backend_pid`
			if (rows[0]?.['locked'] !== true) {
				await releaseConnection()
				return undefined
			}
			const backendPid = Number(rows[0]?.['backend_pid'])
			let released = false
			return {
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
				release: async () => {
					if (released) return
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
					} finally {
						await releaseConnection()
					}
				},
			}
		} catch (error) {
			await releaseConnection()
			throw error
		}
	}

	async seedNetwork(
		network: NetworkConfig,
		lease?: IndexerLease,
		resetCanonicalHistoryOnManifestChange = false,
		preserveStoredStart = false,
	): Promise<boolean> {
		const operation = async (transaction: TransactionSQL): Promise<boolean> => {
			const existingRows = await transaction`
				SELECT start_block, indexed_block
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
					: await transaction`SELECT address, label, kind FROM contracts WHERE chain_id = ${network.chainId} AND provenance = 'manifest' AND canonical`
			const manifestChanged =
				existing !== undefined &&
				manifestContractSetChanged(
					network.contracts,
					storedManifestRows.map((row: Record<string, unknown>) => ({
						address: String(row['address']),
						label: String(row['label']),
						kind: String(row['kind']),
					})),
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
				INSERT INTO networks (chain_id, id, name, explorer_base_url, start_block)
				VALUES (${network.chainId}, ${network.id}, ${network.name}, ${network.explorerBaseUrl}, ${network.startBlock.toString()})
				ON CONFLICT (chain_id) DO UPDATE SET
					id = EXCLUDED.id,
					name = EXCLUDED.name,
					explorer_base_url = EXCLUDED.explorer_base_url,
					start_block = EXCLUDED.start_block,
					updated_at = now()
			`
			await transaction`UPDATE contracts SET canonical = false WHERE chain_id = ${network.chainId} AND provenance = 'manifest'`
			for (const [address, label, kind] of network.contracts) {
				await this.upsertContract(network.chainId, { address, label, kind, provenance: 'manifest' }, transaction)
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
				UPDATE contracts SET provenance = 'retired-manifest'
				WHERE chain_id = ${network.chainId} AND provenance = 'manifest' AND NOT canonical
			`
			if (manifestChanged && resetCanonicalHistoryOnManifestChange && existing?.['indexed_block'] !== null && existing?.['indexed_block'] !== undefined) {
				for (const table of [
					'blocks',
					'transactions',
					'logs',
					'contract_discoveries',
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
					'address_activity',
					'address_balance_snapshots',
					'token_metadata',
				])
					await transaction.unsafe(`UPDATE ${table} SET canonical = false WHERE chain_id = $1 AND canonical`, [network.chainId])
				await transaction`UPDATE entity_state_snapshots SET read_status = 'stale' WHERE chain_id = ${network.chainId} AND read_status <> 'stale'`
				await transaction`UPDATE blocks SET finalized = false WHERE chain_id = ${network.chainId}`
				await transaction`UPDATE logs SET finalized = false WHERE chain_id = ${network.chainId}`
				await transaction`DELETE FROM log_scan_cursors WHERE chain_id = ${network.chainId}`
				await transaction`
					UPDATE contracts SET deployment_block = NULL, deployment_timestamp = NULL,
						deployment_block_exact = NULL, deployment_checked_block = NULL
					WHERE chain_id = ${network.chainId}
				`
				await transaction`UPDATE contracts SET canonical = false WHERE chain_id = ${network.chainId} AND provenance <> 'manifest'`
				const previousBlock = BigInt(String(existing['indexed_block']))
				await transaction`
					UPDATE networks SET indexed_block = NULL, indexed_hash = NULL, indexed_timestamp = NULL, finalized_block = NULL, phase = 'backfilling',
						last_reorg_at = now(), last_reorg_depth = ${(previousBlock - network.startBlock + 1n).toString()}, updated_at = now()
					WHERE chain_id = ${network.chainId}
				`
				await lockLiveEventWriter(transaction)
				await transaction`
					INSERT INTO live_events (event, payload)
					VALUES ('reorg', (${JSON.stringify({ chainId: network.chainId, previousBlock: previousBlock.toString(), ancestor: '-1', depth: (previousBlock - network.startBlock + 1n).toString() })}::text)::jsonb)
				`
			}
			return manifestChanged
		}
		if (lease === undefined) return await this.sql.begin(operation)
		return await withIndexerLease(lease, operation)
	}

	async upsertContract(chainId: number, contract: ContractMetadata, sql: SQL = this.sql): Promise<void> {
		await sql`
			INSERT INTO contracts (chain_id, address, label, kind, provenance, discovery_block, discovery_tx_hash)
			VALUES (${chainId}, ${contract.address.toLowerCase()}, ${contract.label}, ${contract.kind}, ${contract.provenance}, ${contract.discoveryBlock?.toString() ?? null}, ${contract.discoveryTxHash ?? null})
			ON CONFLICT (chain_id, address) DO UPDATE SET
				label = CASE WHEN EXCLUDED.provenance = 'manifest' THEN EXCLUDED.label WHEN contracts.provenance = 'manifest' THEN contracts.label ELSE EXCLUDED.label END,
				kind = CASE WHEN EXCLUDED.provenance = 'manifest' THEN EXCLUDED.kind WHEN contracts.provenance = 'manifest' THEN contracts.kind ELSE EXCLUDED.kind END,
				provenance = CASE WHEN EXCLUDED.provenance = 'manifest' OR contracts.provenance = 'manifest' THEN 'manifest' ELSE EXCLUDED.provenance END,
				discovery_block = CASE WHEN EXCLUDED.provenance = 'manifest' THEN NULL WHEN contracts.provenance = 'manifest' THEN contracts.discovery_block ELSE EXCLUDED.discovery_block END,
				discovery_tx_hash = CASE WHEN EXCLUDED.provenance = 'manifest' THEN NULL WHEN contracts.provenance = 'manifest' THEN contracts.discovery_tx_hash ELSE EXCLUDED.discovery_tx_hash END,
				canonical = true
		`
	}

	async contracts(chainId: number, lease?: IndexerLease): Promise<Map<string, ContractMetadata>> {
		return await withOptionalIndexerLease(this.sql, lease, async (sql) => {
			const rows =
				await sql`SELECT address, label, kind, provenance, discovery_block, discovery_tx_hash, deployment_block, deployment_timestamp, deployment_block_exact, deployment_checked_block FROM contracts WHERE chain_id = ${chainId} AND canonical ORDER BY address`
			return new Map(rows.map((row: Record<string, unknown>) => [String(row['address']), contractMetadataFromRow(row)]))
		})
	}

	async contractDeploymentCandidate(chainId: number, observedHead: bigint, lease: IndexerLease): Promise<ContractMetadata | undefined> {
		const staleBefore = observedHead >= 100n ? observedHead - 100n : -1n
		return await withIndexerLease(lease, async (transaction) => {
			const rows = await transaction`
				SELECT address, label, kind, provenance, discovery_block, discovery_tx_hash, deployment_block, deployment_timestamp,
					deployment_block_exact, deployment_checked_block
				FROM contracts
				WHERE chain_id = ${chainId} AND canonical AND deployment_block IS NULL
					AND (deployment_checked_block IS NULL OR deployment_checked_block <= ${staleBefore.toString()})
				ORDER BY deployment_checked_block NULLS FIRST, label, address
				LIMIT 1
			`
			const row = rows[0]
			return row === undefined ? undefined : contractMetadataFromRow(row)
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
			const rows = await sql`SELECT address, name, symbol, decimals, read_error, read_block FROM token_metadata WHERE chain_id = ${chainId} AND canonical`
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
					WHERE snapshot.chain_id = ${chainId} AND snapshot.address = activity.address AND snapshot.canonical
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
	): Promise<void> {
		await withIndexerLease(lease, async (transaction) => {
			const canonicalRows = await transaction`
				SELECT 1 FROM blocks WHERE chain_id = ${chainId} AND number = ${blockNumber.toString()}
					AND hash = ${blockHash} AND canonical
			`
			if (canonicalRows.length !== 1) throw new DatabaseConsistencyError('Cannot store entity snapshots for a noncanonical block')
			for (const snapshot of snapshots) {
				await transaction`
					INSERT INTO entity_state_snapshots (
						chain_id, entity_type, entity_identity, block_number, block_hash, block_timestamp,
						source_method, read_status, read_result, read_failure_reason, canonical, observed_at
					) VALUES (
						${chainId}, ${snapshot.entityType}, ${snapshot.entityIdentity}, ${blockNumber.toString()}, ${blockHash}, ${blockTimestamp},
						${snapshot.sourceMethod}, ${snapshot.readStatus}, (${snapshot.readResult === undefined ? null : JSON.stringify(snapshot.readResult)}::text)::jsonb,
						${snapshot.readFailureReason ?? null}, true, now()
					)
					ON CONFLICT (chain_id, entity_type, entity_identity, block_hash, source_method) DO UPDATE SET
						read_status = EXCLUDED.read_status, read_result = EXCLUDED.read_result,
						read_failure_reason = EXCLUDED.read_failure_reason, canonical = true, observed_at = now()
				`
			}
		})
	}

	async storeRichListBalances(chainId: number, blockNumber: bigint, blockHash: Hash, balances: readonly RichListBalance[], lease: IndexerLease): Promise<void> {
		if (balances.length === 0) return
		await withIndexerLease(lease, async (transaction) => {
			const canonicalRows = await transaction`
				SELECT 1 FROM blocks WHERE chain_id = ${chainId} AND number = ${blockNumber.toString()} AND hash = ${blockHash} AND canonical
			`
			if (canonicalRows.length !== 1) throw new DatabaseConsistencyError('Cannot store rich-list balances for a noncanonical block')
			for (const balance of balances) {
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

	async rewind(chainId: number, ancestor: bigint, ancestorHash: Hash | undefined, lease: IndexerLease): Promise<void> {
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
			await transaction`UPDATE blocks SET canonical = false, finalized = false WHERE chain_id = ${chainId} AND number > ${ancestor.toString()} AND canonical`
			await transaction`UPDATE transactions SET canonical = false WHERE chain_id = ${chainId} AND block_number > ${ancestor.toString()} AND canonical`
			await transaction`UPDATE logs SET canonical = false, finalized = false WHERE chain_id = ${chainId} AND block_number > ${ancestor.toString()} AND canonical`
			await transaction`UPDATE contract_discoveries SET canonical = false WHERE chain_id = ${chainId} AND block_number > ${ancestor.toString()} AND canonical`
			await transaction`UPDATE questions SET canonical = false WHERE chain_id = ${chainId} AND block_number > ${ancestor.toString()} AND canonical`
			await transaction`UPDATE pools SET canonical = false WHERE chain_id = ${chainId} AND block_number > ${ancestor.toString()} AND canonical`
			await transaction`UPDATE pool_snapshots SET canonical = false WHERE chain_id = ${chainId} AND block_number > ${ancestor.toString()} AND canonical`
			await transaction`UPDATE pool_state_events SET canonical = false WHERE chain_id = ${chainId} AND block_number > ${ancestor.toString()} AND canonical`
			await transaction`UPDATE vault_snapshots SET canonical = false WHERE chain_id = ${chainId} AND block_number > ${ancestor.toString()} AND canonical`
			await transaction`UPDATE universe_events SET canonical = false WHERE chain_id = ${chainId} AND block_number > ${ancestor.toString()} AND canonical`
			await transaction`UPDATE amm_markets SET canonical = false WHERE chain_id = ${chainId} AND block_number > ${ancestor.toString()} AND canonical`
			await transaction`UPDATE amm_price_snapshots SET canonical = false WHERE chain_id = ${chainId} AND block_number > ${ancestor.toString()} AND canonical`
			await transaction`UPDATE rep_eth_price_snapshots SET canonical = false WHERE chain_id = ${chainId} AND block_number > ${ancestor.toString()} AND canonical`
			await transaction`UPDATE uniswap_rep_eth_markets SET canonical = false WHERE chain_id = ${chainId} AND block_number > ${ancestor.toString()} AND canonical`
			await transaction`UPDATE uniswap_rep_eth_price_observations SET canonical = false WHERE chain_id = ${chainId} AND block_number > ${ancestor.toString()} AND canonical`
			await transaction`UPDATE protocol_timeline_entries SET canonical = false WHERE chain_id = ${chainId} AND block_number > ${ancestor.toString()} AND canonical`
			await transaction`UPDATE open_oracle_report_events SET canonical = false WHERE chain_id = ${chainId} AND block_number > ${ancestor.toString()} AND canonical`
			await transaction`UPDATE escalation_game_events SET canonical = false WHERE chain_id = ${chainId} AND block_number > ${ancestor.toString()} AND canonical`
			await transaction`UPDATE truth_auction_events SET canonical = false WHERE chain_id = ${chainId} AND block_number > ${ancestor.toString()} AND canonical`
			await transaction`UPDATE amm_trade_events SET canonical = false WHERE chain_id = ${chainId} AND block_number > ${ancestor.toString()} AND canonical`
			await transaction`UPDATE fork_migration_events SET canonical = false WHERE chain_id = ${chainId} AND block_number > ${ancestor.toString()} AND canonical`
			await transaction`UPDATE entity_state_snapshots SET read_status = 'stale', canonical = false WHERE chain_id = ${chainId} AND block_number > ${ancestor.toString()} AND canonical`
			await transaction`UPDATE address_activity SET canonical = false WHERE chain_id = ${chainId} AND block_number > ${ancestor.toString()} AND canonical`
			await transaction`UPDATE address_balance_snapshots SET canonical = false WHERE chain_id = ${chainId} AND block_number > ${ancestor.toString()} AND canonical`
			await transaction`UPDATE token_metadata SET canonical = false WHERE chain_id = ${chainId} AND read_block > ${ancestor.toString()} AND canonical`
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
			await transaction`UPDATE contracts SET deployment_checked_block = NULL WHERE chain_id = ${chainId} AND deployment_checked_block > ${ancestor.toString()}`
			await transaction`UPDATE contracts SET canonical = false WHERE chain_id = ${chainId} AND provenance <> 'manifest' AND discovery_block > ${ancestor.toString()}`
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
			const previousBlock = BigInt(String(checkpoint['indexed_block']))
			const reorgDepth = rewindDepth(previousBlock, BigInt(String(checkpoint['start_block'])), ancestor)
			await transaction`
				UPDATE networks SET indexed_block = ${ancestor < 0n ? null : ancestor.toString()}, indexed_hash = ${ancestorHash ?? null},
					indexed_timestamp = (SELECT timestamp FROM blocks WHERE chain_id = ${chainId} AND hash = ${ancestorHash ?? null}), phase = 'backfilling',
					last_reorg_at = now(), last_reorg_depth = ${reorgDepth.toString()}, updated_at = now()
				WHERE chain_id = ${chainId}
			`
			await lockLiveEventWriter(transaction)
			await transaction`
				INSERT INTO live_events (event, payload)
				VALUES ('reorg', (${JSON.stringify({ chainId, previousBlock: previousBlock.toString(), ancestor: ancestor.toString(), depth: reorgDepth.toString() })}::text)::jsonb)
			`
		})
	}

	async storeBlock(chainId: number, block: IndexedBlock, lease: IndexerLease): Promise<void> {
		await withIndexerLease(lease, async (transaction) => {
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
					VALUES (${chainId}, ${item.hash}, ${block.hash}, ${block.number.toString()}, ${item.transactionIndex}, ${item.from.toLowerCase()}, ${item.to?.toLowerCase() ?? null}, ${item.value.toString()}, ${item.input}, ${item.status}, ${item.gasUsed.toString()}, (${JSON.stringify(item.receipt)}::text)::jsonb, true)
					ON CONFLICT (chain_id, block_hash, hash) DO UPDATE SET canonical = true
				`
				await transaction`
					INSERT INTO actions (chain_id, block_hash, tx_hash, contract_address, function_name, function_signature, arguments, display_arguments, argument_schema, decode_status, decode_error, summary)
					VALUES (${chainId}, ${block.hash}, ${item.hash}, ${item.to?.toLowerCase() ?? null}, ${item.decoded.name ?? null}, ${item.decoded.signature ?? null}, (${JSON.stringify(item.decoded.arguments ?? null)}::text)::jsonb, (${JSON.stringify(item.decoded.displayArguments ?? null)}::text)::jsonb, (${JSON.stringify(item.decoded.argumentSchema ?? [])}::text)::jsonb, ${item.decoded.status}, ${item.decoded.error ?? null}, ${item.decoded.summary})
					ON CONFLICT (chain_id, block_hash, tx_hash) DO UPDATE SET function_name = EXCLUDED.function_name, function_signature = EXCLUDED.function_signature, arguments = EXCLUDED.arguments, display_arguments = EXCLUDED.display_arguments, argument_schema = EXCLUDED.argument_schema, decode_status = EXCLUDED.decode_status, decode_error = EXCLUDED.decode_error, summary = EXCLUDED.summary
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
					VALUES (${chainId}, ${item.transactionHash}, ${item.blockHash}, ${item.blockNumber.toString()}, ${item.transactionIndex}, ${item.logIndex}, ${item.address.toLowerCase()}, (${JSON.stringify(item.topics)}::text)::jsonb, ${item.data}, ${item.decoded.name ?? null}, ${item.decoded.signature ?? null}, (${JSON.stringify(item.decoded.arguments ?? null)}::text)::jsonb, (${JSON.stringify(item.decoded.displayArguments ?? null)}::text)::jsonb, (${JSON.stringify(item.decoded.argumentSchema ?? [])}::text)::jsonb, ${item.decoded.status}, ${item.decoded.error ?? null}, ${item.decoded.summary}, true, ${item.blockNumber <= block.finalizedThrough})
					ON CONFLICT (chain_id, block_hash, tx_hash, log_index) DO UPDATE SET canonical = true, finalized = EXCLUDED.finalized, event_name = EXCLUDED.event_name, event_signature = EXCLUDED.event_signature, arguments = EXCLUDED.arguments, display_arguments = EXCLUDED.display_arguments, argument_schema = EXCLUDED.argument_schema, decode_status = EXCLUDED.decode_status, decode_error = EXCLUDED.decode_error, summary = EXCLUDED.summary
				`
				for (const projection of projectionsFrom(item)) {
					const position = [chainId, item.blockHash, item.transactionHash, item.logIndex, item.blockNumber.toString()] as const
					if (projection.type === 'domainEvent') {
						await transaction`
							INSERT INTO protocol_timeline_entries (chain_id, block_hash, tx_hash, log_index, block_number, entity_type, entity_identity, semantic_event_kind, summary_data, related_entities, source_contract, source_event, canonical)
							VALUES (${position[0]}, ${position[1]}, ${position[2]}, ${position[3]}, ${position[4]}, ${projection.entityType}, ${projection.entityIdentity}, ${projection.semanticEventKind}, (${JSON.stringify(projection.data)}::text)::jsonb, (${JSON.stringify(projection.relatedEntities)}::text)::jsonb, ${item.address.toLowerCase()}, ${projection.semanticEventKind}, true)
							ON CONFLICT (chain_id, block_hash, tx_hash, log_index, entity_type, entity_identity) DO UPDATE SET canonical = true, summary_data = EXCLUDED.summary_data, related_entities = EXCLUDED.related_entities
						`
						if (projection.domain === 'report') {
							const reportId = projection.data['reportId']
							const roundNumber = projection.data['numReports']
							if (typeof reportId !== 'string') throw new Error(`${projection.semanticEventKind} is missing reportId`)
							await transaction`
								INSERT INTO open_oracle_report_events (chain_id, block_hash, tx_hash, log_index, block_number, open_oracle_address, report_id, event_name, round_number, report_data, canonical)
								VALUES (${position[0]}, ${position[1]}, ${position[2]}, ${position[3]}, ${position[4]}, ${item.address.toLowerCase()}, ${reportId}, ${projection.semanticEventKind}, ${typeof roundNumber === 'string' ? roundNumber : null}, (${JSON.stringify(projection.data)}::text)::jsonb, true)
								ON CONFLICT (chain_id, block_hash, tx_hash, log_index, open_oracle_address, report_id) DO UPDATE SET canonical = true, report_data = EXCLUDED.report_data
							`
						}
						if (projection.domain === 'escalation')
							await transaction`
								INSERT INTO escalation_game_events (chain_id, block_hash, tx_hash, log_index, block_number, game_address, event_name, event_data, canonical)
								VALUES (${position[0]}, ${position[1]}, ${position[2]}, ${position[3]}, ${position[4]}, ${item.address.toLowerCase()}, ${projection.semanticEventKind}, (${JSON.stringify(projection.data)}::text)::jsonb, true)
								ON CONFLICT (chain_id, block_hash, tx_hash, log_index, game_address) DO UPDATE SET canonical = true, event_data = EXCLUDED.event_data
							`
						if (projection.domain === 'auction')
							await transaction`
								INSERT INTO truth_auction_events (chain_id, block_hash, tx_hash, log_index, block_number, auction_address, event_name, event_data, canonical)
								VALUES (${position[0]}, ${position[1]}, ${position[2]}, ${position[3]}, ${position[4]}, ${item.address.toLowerCase()}, ${projection.semanticEventKind}, (${JSON.stringify(projection.data)}::text)::jsonb, true)
								ON CONFLICT (chain_id, block_hash, tx_hash, log_index, auction_address) DO UPDATE SET canonical = true, event_data = EXCLUDED.event_data
							`
						if (projection.domain === 'trading')
							await transaction`
								INSERT INTO amm_trade_events (chain_id, block_hash, tx_hash, log_index, block_number, market_address, event_name, event_data, canonical)
								VALUES (${position[0]}, ${position[1]}, ${position[2]}, ${position[3]}, ${position[4]}, ${item.address.toLowerCase()}, ${projection.semanticEventKind}, (${JSON.stringify(projection.data)}::text)::jsonb, true)
								ON CONFLICT (chain_id, block_hash, tx_hash, log_index, market_address) DO UPDATE SET canonical = true, event_data = EXCLUDED.event_data
							`
						if (projection.domain === 'fork')
							await transaction`
								INSERT INTO fork_migration_events (chain_id, block_hash, tx_hash, log_index, block_number, universe_identity, event_name, event_data, canonical)
								VALUES (${position[0]}, ${position[1]}, ${position[2]}, ${position[3]}, ${position[4]}, ${projection.entityIdentity}, ${projection.semanticEventKind}, (${JSON.stringify(projection.data)}::text)::jsonb, true)
								ON CONFLICT (chain_id, block_hash, tx_hash, log_index, universe_identity) DO UPDATE SET canonical = true, event_data = EXCLUDED.event_data
							`
						continue
					}
					if (projection.type === 'question') {
						await transaction`
							INSERT INTO questions (chain_id, block_hash, tx_hash, log_index, block_number, question_id, created_timestamp, title, description, start_time, end_time, num_ticks, display_value_min, display_value_max, answer_unit, outcome_options, canonical)
							VALUES (${position[0]}, ${position[1]}, ${position[2]}, ${position[3]}, ${position[4]}, ${projection.questionId}, ${projection.createdTimestamp}, ${projection.title}, ${projection.description}, ${projection.startTime}, ${projection.endTime}, ${projection.numTicks}, ${projection.displayValueMin}, ${projection.displayValueMax}, ${projection.answerUnit}, (${JSON.stringify(projection.outcomeOptions)}::text)::jsonb, true)
							ON CONFLICT (chain_id, block_hash, tx_hash, log_index, question_id) DO UPDATE SET canonical = true
						`
						continue
					}
					if (projection.type === 'pool') {
						await transaction`
							INSERT INTO pools (chain_id, block_hash, tx_hash, log_index, block_number, pool_address, parent_address, universe_id, question_id, truth_auction_address, coordinator_address, share_token_address, security_multiplier_bps, initial_priority_fee_atto_eth_per_gas, initial_retention_rate, initial_settlement_collateral_atto_eth, canonical)
							VALUES (${position[0]}, ${position[1]}, ${position[2]}, ${position[3]}, ${position[4]}, ${projection.poolAddress}, ${projection.parentAddress}, ${projection.universeId}, ${projection.questionId}, ${projection.truthAuctionAddress}, ${projection.coordinatorAddress}, ${projection.shareTokenAddress}, ${projection.securityMultiplierBps}, ${projection.initialPriorityFeeAttoEthPerGas}, ${projection.initialRetentionRate}, ${projection.initialSettlementCollateralAttoEth}, true)
							ON CONFLICT (chain_id, block_hash, tx_hash, log_index, pool_address) DO UPDATE SET canonical = true
						`
						continue
					}
					if (projection.type === 'poolSnapshot') {
						await transaction`
							INSERT INTO pool_snapshots (chain_id, block_hash, tx_hash, log_index, block_number, pool_address, reason, vault_address, settlement_collateral_atto_eth, total_capacity_ownership_atto_rep, fee_eligible_capacity_ownership_atto_rep, total_claimable_vault_fees_atto_eth, unallocated_accrued_fees_atto_eth, fee_index, fee_index_remainder, total_fees_owed_remainder, uncheckpointed_fee_eligible_capacity_ownership_atto_rep, last_updated_fee_accumulator, current_retention_rate, canonical)
							VALUES (${position[0]}, ${position[1]}, ${position[2]}, ${position[3]}, ${position[4]}, ${projection.poolAddress}, ${projection.reason}, ${projection.vaultAddress}, ${projection.settlementCollateralAttoEth}, ${projection.totalCapacityOwnershipAttoRep}, ${projection.feeEligibleCapacityOwnershipAttoRep}, ${projection.totalClaimableVaultFeesAttoEth}, ${projection.unallocatedAccruedFeesAttoEth}, ${projection.feeIndex}, ${projection.feeIndexRemainder}, ${projection.totalFeesOwedRemainder}, ${projection.uncheckpointedFeeEligibleCapacityOwnershipAttoRep}, ${projection.lastUpdatedFeeAccumulator}, ${projection.currentRetentionRate}, true)
							ON CONFLICT (chain_id, block_hash, tx_hash, log_index, pool_address) DO UPDATE SET canonical = true
						`
						continue
					}
					if (projection.type === 'vaultSnapshot') {
						await transaction`
							INSERT INTO vault_snapshots (chain_id, block_hash, tx_hash, log_index, block_number, pool_address, vault_address, rep_backing_units, capacity_ownership_atto_rep, claimable_fees_atto_eth, fee_index, vault_fee_remainder, resulting_total_rep_backing_units, resulting_fee_eligible_capacity_ownership_atto_rep, canonical)
							VALUES (${position[0]}, ${position[1]}, ${position[2]}, ${position[3]}, ${position[4]}, ${projection.poolAddress}, ${projection.vaultAddress}, ${projection.repBackingUnits}, ${projection.capacityOwnershipAttoRep}, ${projection.claimableFeesAttoEth}, ${projection.feeIndex}, ${projection.vaultFeeRemainder}, ${projection.resultingTotalRepBackingUnits}, ${projection.resultingFeeEligibleCapacityOwnershipAttoRep}, true)
							ON CONFLICT (chain_id, block_hash, tx_hash, log_index, pool_address, vault_address) DO UPDATE SET canonical = true
						`
						continue
					}
					if (projection.type === 'poolState') {
						await transaction`
							INSERT INTO pool_state_events (chain_id, block_hash, tx_hash, log_index, block_number, pool_address, event_name, state, canonical)
							VALUES (${position[0]}, ${position[1]}, ${position[2]}, ${position[3]}, ${position[4]}, ${projection.poolAddress}, ${projection.eventName}, (${JSON.stringify(projection.state)}::text)::jsonb, true)
							ON CONFLICT (chain_id, block_hash, tx_hash, log_index, pool_address) DO UPDATE SET canonical = true, state = EXCLUDED.state
						`
						continue
					}
					if (projection.type === 'ammMarket') {
						await transaction`
							INSERT INTO amm_markets (chain_id, block_hash, tx_hash, log_index, block_number, pair_address, pool_address, share_token_address, universe_id, fee_bps, canonical)
							VALUES (${position[0]}, ${position[1]}, ${position[2]}, ${position[3]}, ${position[4]}, ${projection.pairAddress}, ${projection.poolAddress}, ${projection.shareTokenAddress}, ${projection.universeId}, ${projection.feeBps}, true)
							ON CONFLICT (chain_id, block_hash, tx_hash, log_index, pair_address) DO UPDATE SET canonical = true
						`
						continue
					}
					if (projection.type === 'ammPrice') {
						await transaction`
							INSERT INTO amm_price_snapshots (chain_id, block_hash, tx_hash, log_index, block_number, pair_address, yes_reserve_atto_shares, no_reserve_atto_shares, conditional_yes_bps, conditional_no_bps, canonical)
							VALUES (${position[0]}, ${position[1]}, ${position[2]}, ${position[3]}, ${position[4]}, ${projection.pairAddress}, ${projection.yesReserveAttoShares}, ${projection.noReserveAttoShares}, ${projection.conditionalYesBps}, ${projection.conditionalNoBps}, true)
							ON CONFLICT (chain_id, block_hash, tx_hash, log_index, pair_address) DO UPDATE SET canonical = true
						`
						continue
					}
					if (projection.type === 'repEthPrice') {
						await transaction`
							INSERT INTO rep_eth_price_snapshots (chain_id, block_hash, tx_hash, log_index, block_number, coordinator_address, event_name, report_id, rep_per_eth_1e18, settlement_timestamp, canonical)
							VALUES (${position[0]}, ${position[1]}, ${position[2]}, ${position[3]}, ${position[4]}, ${projection.coordinatorAddress}, ${projection.eventName}, ${projection.reportId ?? null}, ${projection.repPerEth1e18}, ${projection.settlementTimestamp ?? null}, true)
							ON CONFLICT (chain_id, block_hash, tx_hash, log_index, coordinator_address) DO UPDATE SET canonical = true
						`
						continue
					}
					if (projection.type === 'uniswapMarket') {
						const supportedV4Market = projection.venue === 'v4' && isSupportedUniswapV4Market(projection)
						await transaction`
							INSERT INTO uniswap_rep_eth_markets (chain_id, block_hash, tx_hash, log_index, block_number, venue, market_id, contract_address, token0_address, token1_address, fee_hundredths_bip, tick_spacing, hooks_address, canonical)
							SELECT ${position[0]}, ${position[1]}, ${position[2]}, ${position[3]}, ${position[4]}, ${projection.venue}, ${projection.marketId}, ${projection.contractAddress}, ${projection.token0Address}, ${projection.token1Address}, ${projection.feeHundredthsBip}, ${projection.tickSpacing ?? null}, ${projection.hooksAddress ?? null}, true
							WHERE (
								${projection.venue} IN ('v2', 'v3') AND (
									EXISTS (SELECT 1 FROM contracts WHERE chain_id = ${chainId} AND address = ${projection.token0Address} AND kind = 'reputationToken' AND canonical)
									AND EXISTS (SELECT 1 FROM contracts WHERE chain_id = ${chainId} AND address = ${projection.token1Address} AND kind IN ('weth', 'usdc') AND canonical)
									OR EXISTS (SELECT 1 FROM contracts WHERE chain_id = ${chainId} AND address = ${projection.token1Address} AND kind = 'reputationToken' AND canonical)
									AND EXISTS (SELECT 1 FROM contracts WHERE chain_id = ${chainId} AND address = ${projection.token0Address} AND kind IN ('weth', 'usdc') AND canonical)
								)
								) OR (
									${projection.venue} = 'v4'
									AND ${supportedV4Market}
									AND EXISTS (SELECT 1 FROM contracts WHERE chain_id = ${chainId} AND address = ${projection.contractAddress} AND kind = 'uniswapV4PoolManager' AND canonical)
									AND (
										${projection.token0Address} = ${zeroAddress}
										AND EXISTS (SELECT 1 FROM contracts WHERE chain_id = ${chainId} AND address = ${projection.token1Address} AND kind = 'reputationToken' AND canonical)
										OR EXISTS (SELECT 1 FROM contracts WHERE chain_id = ${chainId} AND address = ${projection.token0Address} AND kind = 'reputationToken' AND canonical)
										AND EXISTS (SELECT 1 FROM contracts WHERE chain_id = ${chainId} AND address = ${projection.token1Address} AND kind = 'usdc' AND canonical)
										OR EXISTS (SELECT 1 FROM contracts WHERE chain_id = ${chainId} AND address = ${projection.token1Address} AND kind = 'reputationToken' AND canonical)
										AND EXISTS (SELECT 1 FROM contracts WHERE chain_id = ${chainId} AND address = ${projection.token0Address} AND kind = 'usdc' AND canonical)
									)
								)
							ON CONFLICT (chain_id, block_hash, tx_hash, log_index, market_id) DO UPDATE SET canonical = true
						`
						continue
					}
					if (projection.type === 'uniswapPrice') {
						await transaction`
							INSERT INTO uniswap_rep_eth_price_observations (chain_id, block_hash, tx_hash, log_index, block_number, venue, market_id, event_name, reserve0, reserve1, sqrt_price_x96, liquidity, canonical)
							SELECT ${position[0]}, ${position[1]}, ${position[2]}, ${position[3]}, ${position[4]}, ${projection.venue}, ${projection.marketId}, ${projection.eventName}, ${projection.reserve0 ?? null}, ${projection.reserve1 ?? null}, ${projection.sqrtPriceX96 ?? null}, ${projection.liquidity ?? null}, true
							WHERE EXISTS (
								SELECT 1 FROM uniswap_rep_eth_markets
								WHERE chain_id = ${chainId} AND venue = ${projection.venue} AND market_id = ${projection.marketId} AND canonical
							)
							ON CONFLICT (chain_id, block_hash, tx_hash, log_index, market_id) DO UPDATE SET canonical = true
						`
						continue
					}
					await transaction`
						INSERT INTO universe_events (chain_id, block_hash, tx_hash, log_index, block_number, universe_id, event_name, parent_universe_id, forking_outcome_index, reputation_token_address, fork_question_id, fork_time, forker_address, fork_threshold_atto_rep, migration_rep_balance_atto_rep, theoretical_supply_atto_rep, canonical)
						VALUES (${position[0]}, ${position[1]}, ${position[2]}, ${position[3]}, ${position[4]}, ${projection.universeId}, ${projection.eventName}, ${projection.parentUniverseId ?? null}, ${projection.forkingOutcomeIndex ?? null}, ${projection.reputationTokenAddress ?? null}, ${projection.forkQuestionId ?? null}, ${projection.forkTime ?? null}, ${projection.forkerAddress ?? null}, ${projection.forkThresholdAttoRep ?? null}, ${projection.migrationRepBalanceAttoRep ?? null}, ${projection.theoreticalSupplyAttoRep ?? null}, true)
						ON CONFLICT (chain_id, block_hash, tx_hash, log_index, universe_id) DO UPDATE SET canonical = true
					`
				}
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
			await transaction`UPDATE blocks SET finalized = true WHERE chain_id = ${chainId} AND canonical AND number <= ${block.finalizedThrough.toString()}`
			await transaction`UPDATE logs SET finalized = true WHERE chain_id = ${chainId} AND canonical AND block_number <= ${block.finalizedThrough.toString()}`
			await transaction`
				UPDATE networks SET indexed_block = ${block.number.toString()}, indexed_hash = ${block.hash}, indexed_timestamp = ${block.timestamp}, observed_block = ${block.observedHead.toString()}, finalized_block = ${block.finalizedThrough.toString()}, phase = ${block.number >= block.observedHead ? 'live' : 'backfilling'}, last_poll_at = now(), last_success_at = now(), last_error = null, failure_started_at = null, consecutive_failures = 0, next_retry_at = null, updated_at = now()
				WHERE chain_id = ${chainId}
			`
			await lockLiveEventWriter(transaction)
			await transaction`
				INSERT INTO live_events (event, payload)
				VALUES ('block', (${JSON.stringify({ chainId, blockNumber: block.number.toString(), logs: block.logs.length })}::text)::jsonb)
			`
		})
	}

	async updateObservedHead(chainId: number, head: bigint, phase: string, lease: IndexerLease): Promise<void> {
		await withIndexerLease(lease, async (transaction) => {
			await transaction`UPDATE networks SET observed_block = ${head.toString()}, phase = ${phase}, last_poll_at = now(), last_success_at = now(), last_error = null, failure_started_at = null, consecutive_failures = 0, next_retry_at = null, updated_at = now() WHERE chain_id = ${chainId}`
			await lockLiveEventWriter(transaction)
			await transaction`INSERT INTO live_events (event, payload) VALUES ('status', (${JSON.stringify({ chainId, blockNumber: head.toString() })}::text)::jsonb)`
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
				VALUES ('status', (${JSON.stringify({ chainId, phase: 'degraded', nextRetryAt: nextRetryAt.toISOString(), failures: Number(rows[0]?.['consecutive_failures'] ?? 1) })}::text)::jsonb)
			`
		})
	}
}
