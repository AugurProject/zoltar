import { type ReservedSQL, SQL } from 'bun'
import type { Address, Hash, Hex } from './ethereum.ts'
import { projectionsFrom } from './projections.ts'
import type { ContractMetadata, DecodedRecord, NetworkConfig, StoredLog, TokenMetadata } from './types.ts'

export type StoredTransaction = {
	readonly hash: Hash
	readonly transactionIndex: number
	readonly from: Address
	readonly to: Address | null
	readonly value: bigint
	readonly input: Hex
	readonly status: 'success' | 'reverted'
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

class DatabaseConsistencyError extends Error {
	override name = 'DatabaseConsistencyError'
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

export const assertStartBlockCompatible = (configuredStartBlock: bigint, storedStartBlock: bigint, indexedBlock?: bigint): void => {
	if (configuredStartBlock === storedStartBlock || indexedBlock === undefined) return
	throw new DatabaseConsistencyError(
		`Cannot change the configured start block from ${storedStartBlock} to ${configuredStartBlock} while checkpoint ${indexedBlock} exists; rebuild the augurScan database from the new start block`,
	)
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

export type IndexerLease = {
	readonly backendPid: number
	readonly connection: ReservedSQL
	readonly assertHeld: () => Promise<void>
	readonly release: () => Promise<void>
}

export class ScannerDatabase {
	readonly sql: SQL

	constructor(url: string, maxConnections = 10, connectionTimeoutSeconds = 5) {
		this.sql = new SQL(url, { max: maxConnections, idleTimeout: 30, connectionTimeout: connectionTimeoutSeconds })
	}

	async close(): Promise<void> {
		await this.sql.close()
	}

	async read<T>(operation: (sql: SQL) => Promise<T>, timeoutMs = 10_000): Promise<T> {
		return await this.sql.begin(async (transaction) => {
			await transaction.unsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
			await transaction`SELECT set_config('statement_timeout', ${timeoutMs.toString()}, true)`
			await transaction`SELECT set_config('transaction_timeout', ${timeoutMs.toString()}, true)`
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
				WITH window AS (
					SELECT state.pruned_through_id,
						GREATEST(state.pruned_through_id, COALESCE((SELECT max(id) FROM live_events), 0)) AS latest_id
					FROM live_event_state state WHERE singleton
				), requested AS (
					SELECT event.id, event.event, event.payload
					FROM live_events event, window
					WHERE ${id} >= window.pruned_through_id AND event.id > ${id}
					ORDER BY event.id LIMIT ${limit}
				)
				SELECT id, event, payload FROM requested
				UNION ALL
				SELECT latest_id AS id, 'reset' AS event,
					jsonb_build_object('reason', 'replay-window-expired', 'refreshRequired', true) AS payload
				FROM window WHERE ${id} < pruned_through_id
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
			SELECT * FROM checkpoint_issues UNION ALL SELECT * FROM continuity_issues ORDER BY chain_id, code LIMIT 100
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
			let released = false
			return {
				backendPid: Number(rows[0]?.['backend_pid']),
				connection,
				assertHeld: async () => {
					if (released) throw new Error('Indexer lease was released')
					const leaseRows = await connection`
						SELECT EXISTS (
							SELECT 1 FROM pg_locks
							WHERE locktype = 'advisory'
								AND pid = pg_backend_pid()
								AND classid::bigint = 92138472
								AND objid::bigint = ${chainId}
								AND granted
						) AS held
					`
					if (leaseRows[0]?.['held'] !== true) throw new Error('Indexer lease is no longer held')
				},
				release: async () => {
					if (released) return
					released = true
					try {
						await connection`SELECT pg_advisory_unlock(92138472, ${chainId})`
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

	async seedNetwork(network: NetworkConfig, lease?: IndexerLease): Promise<void> {
		await lease?.assertHeld()
		const sql = lease?.connection ?? this.sql
		await sql.begin(async (transaction) => {
			const existingRows = await transaction`
				SELECT start_block, indexed_block
				FROM networks
				WHERE chain_id = ${network.chainId}
				FOR UPDATE
			`
			const existing = existingRows[0]
			if (existing !== undefined) {
				assertStartBlockCompatible(
					network.startBlock,
					BigInt(String(existing['start_block'])),
					existing['indexed_block'] === null || existing['indexed_block'] === undefined ? undefined : BigInt(String(existing['indexed_block'])),
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
		})
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

	async contracts(chainId: number): Promise<Map<string, ContractMetadata>> {
		const rows = await this
			.sql`SELECT address, label, kind, provenance, discovery_block, discovery_tx_hash, deployment_block, deployment_timestamp, deployment_block_exact, deployment_checked_block FROM contracts WHERE chain_id = ${chainId} AND canonical ORDER BY address`
		return new Map(rows.map((row: Record<string, unknown>) => [String(row['address']), contractMetadataFromRow(row)]))
	}

	async contractDeploymentCandidate(chainId: number, observedHead: bigint, lease: IndexerLease): Promise<ContractMetadata | undefined> {
		await lease.assertHeld()
		const staleBefore = observedHead >= 100n ? observedHead - 100n : -1n
		const rows = await lease.connection`
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
	}

	async recordContractDeployment(
		chainId: number,
		address: Address,
		checkedBlock: bigint,
		deployment: { readonly block: bigint; readonly timestamp: Date; readonly exact: boolean } | undefined,
		lease: IndexerLease,
	): Promise<void> {
		await lease.assertHeld()
		await lease.connection`
			UPDATE contracts SET
				deployment_block = ${deployment?.block.toString() ?? null},
				deployment_timestamp = ${deployment?.timestamp ?? null},
				deployment_block_exact = ${deployment?.exact ?? null},
				deployment_checked_block = ${checkedBlock.toString()}
			WHERE chain_id = ${chainId} AND address = ${address.toLowerCase()} AND canonical
		`
	}

	async tokenMetadata(chainId: number): Promise<Map<string, TokenMetadata>> {
		const rows = await this.sql`SELECT address, name, symbol, decimals, read_error, read_block FROM token_metadata WHERE chain_id = ${chainId} AND canonical`
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
	}

	async richListBalanceTargets(chainId: number, limit = 10): Promise<RichListBalanceTargets> {
		const [addressRows, assetRows] = await Promise.all([
			this.sql`
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
			`,
			this.sql`
				SELECT address, kind FROM contracts
				WHERE chain_id = ${chainId} AND canonical AND kind IN ('reputationToken', 'weth')
				ORDER BY kind, address
			`,
		])
		return {
			addresses: addressRows.map((row: Record<string, unknown>) => String(row['address']) as Address),
			assets: assetRows.map((row: Record<string, unknown>) => ({
				address: String(row['address']) as Address,
				kind: row['kind'] === 'weth' ? 'weth' : 'rep',
			})),
		}
	}

	async storeRichListBalances(chainId: number, blockNumber: bigint, blockHash: Hash, balances: readonly RichListBalance[], lease: IndexerLease): Promise<void> {
		if (balances.length === 0) return
		await lease.assertHeld()
		await lease.connection.begin(async (transaction) => {
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

	async checkpoint(chainId: number): Promise<{ readonly number: bigint; readonly hash: Hash } | undefined> {
		const rows = await this.sql`SELECT indexed_block, indexed_hash FROM networks WHERE chain_id = ${chainId}`
		const row = rows[0]
		if (row === undefined || row['indexed_block'] === null || row['indexed_hash'] === null) return undefined
		return { number: BigInt(String(row['indexed_block'])), hash: String(row['indexed_hash']) as Hash }
	}

	async canonicalHash(chainId: number, number: bigint): Promise<Hash | undefined> {
		const rows = await this.sql`SELECT hash FROM blocks WHERE chain_id = ${chainId} AND number = ${number.toString()} AND canonical`
		const hash = rows[0]?.['hash']
		return hash === undefined ? undefined : (String(hash) as Hash)
	}

	async rewind(chainId: number, ancestor: bigint, ancestorHash: Hash | undefined, lease: IndexerLease): Promise<void> {
		await lease.assertHeld()
		await lease.connection.begin(async (transaction) => {
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
			await transaction`UPDATE address_activity SET canonical = false WHERE chain_id = ${chainId} AND block_number > ${ancestor.toString()} AND canonical`
			await transaction`UPDATE address_balance_snapshots SET canonical = false WHERE chain_id = ${chainId} AND block_number > ${ancestor.toString()} AND canonical`
			await transaction`UPDATE token_metadata SET canonical = false WHERE chain_id = ${chainId} AND read_block > ${ancestor.toString()} AND canonical`
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
				VALUES ('reorg', ${JSON.stringify({ chainId, previousBlock: previousBlock.toString(), ancestor: ancestor.toString(), depth: reorgDepth.toString() })}::jsonb)
			`
		})
	}

	async storeBlock(chainId: number, block: IndexedBlock, lease: IndexerLease): Promise<void> {
		await lease.assertHeld()
		await lease.connection.begin(async (transaction) => {
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
			for (const item of block.transactions) {
				await transaction`
					INSERT INTO transactions (chain_id, hash, block_hash, block_number, transaction_index, from_address, to_address, value, input, status, gas_used, receipt, canonical)
					VALUES (${chainId}, ${item.hash}, ${block.hash}, ${block.number.toString()}, ${item.transactionIndex}, ${item.from.toLowerCase()}, ${item.to?.toLowerCase() ?? null}, ${item.value.toString()}, ${item.input}, ${item.status}, ${item.gasUsed.toString()}, ${JSON.stringify(item.receipt)}, true)
					ON CONFLICT (chain_id, block_hash, hash) DO UPDATE SET canonical = true
				`
				await transaction`
					INSERT INTO actions (chain_id, block_hash, tx_hash, contract_address, function_name, function_signature, arguments, display_arguments, argument_schema, decode_status, decode_error, summary)
					VALUES (${chainId}, ${block.hash}, ${item.hash}, ${item.to?.toLowerCase() ?? null}, ${item.decoded.name ?? null}, ${item.decoded.signature ?? null}, ${JSON.stringify(item.decoded.arguments ?? null)}, ${JSON.stringify(item.decoded.displayArguments ?? null)}, ${JSON.stringify(item.decoded.argumentSchema ?? [])}, ${item.decoded.status}, ${item.decoded.error ?? null}, ${item.decoded.summary})
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
					VALUES (${chainId}, ${item.transactionHash}, ${item.blockHash}, ${item.blockNumber.toString()}, ${item.transactionIndex}, ${item.logIndex}, ${item.address.toLowerCase()}, ${JSON.stringify(item.topics)}, ${item.data}, ${item.decoded.name ?? null}, ${item.decoded.signature ?? null}, ${JSON.stringify(item.decoded.arguments ?? null)}, ${JSON.stringify(item.decoded.displayArguments ?? null)}, ${JSON.stringify(item.decoded.argumentSchema ?? [])}, ${item.decoded.status}, ${item.decoded.error ?? null}, ${item.decoded.summary}, true, ${item.blockNumber <= block.finalizedThrough})
					ON CONFLICT (chain_id, block_hash, tx_hash, log_index) DO UPDATE SET canonical = true, finalized = EXCLUDED.finalized, event_name = EXCLUDED.event_name, event_signature = EXCLUDED.event_signature, arguments = EXCLUDED.arguments, display_arguments = EXCLUDED.display_arguments, argument_schema = EXCLUDED.argument_schema, decode_status = EXCLUDED.decode_status, decode_error = EXCLUDED.decode_error, summary = EXCLUDED.summary
				`
				for (const projection of projectionsFrom(item)) {
					const position = [chainId, item.blockHash, item.transactionHash, item.logIndex, item.blockNumber.toString()] as const
					if (projection.type === 'question') {
						await transaction`
							INSERT INTO questions (chain_id, block_hash, tx_hash, log_index, block_number, question_id, created_timestamp, title, description, start_time, end_time, num_ticks, display_value_min, display_value_max, answer_unit, outcome_options, canonical)
							VALUES (${position[0]}, ${position[1]}, ${position[2]}, ${position[3]}, ${position[4]}, ${projection.questionId}, ${projection.createdTimestamp}, ${projection.title}, ${projection.description}, ${projection.startTime}, ${projection.endTime}, ${projection.numTicks}, ${projection.displayValueMin}, ${projection.displayValueMax}, ${projection.answerUnit}, ${JSON.stringify(projection.outcomeOptions)}, true)
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
							VALUES (${position[0]}, ${position[1]}, ${position[2]}, ${position[3]}, ${position[4]}, ${projection.poolAddress}, ${projection.eventName}, ${JSON.stringify(projection.state)}, true)
							ON CONFLICT (chain_id, block_hash, tx_hash, log_index, pool_address) DO UPDATE SET canonical = true, state = EXCLUDED.state
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
			await transaction`UPDATE blocks SET finalized = true WHERE chain_id = ${chainId} AND canonical AND number <= ${block.finalizedThrough.toString()}`
			await transaction`UPDATE logs SET finalized = true WHERE chain_id = ${chainId} AND canonical AND block_number <= ${block.finalizedThrough.toString()}`
			await transaction`
				UPDATE networks SET indexed_block = ${block.number.toString()}, indexed_hash = ${block.hash}, indexed_timestamp = ${block.timestamp}, observed_block = ${block.observedHead.toString()}, finalized_block = ${block.finalizedThrough.toString()}, phase = ${block.number >= block.observedHead ? 'live' : 'backfilling'}, last_poll_at = now(), last_success_at = now(), last_error = null, failure_started_at = null, consecutive_failures = 0, next_retry_at = null, updated_at = now()
				WHERE chain_id = ${chainId}
			`
			await lockLiveEventWriter(transaction)
			await transaction`
				INSERT INTO live_events (event, payload)
				VALUES ('block', ${JSON.stringify({ chainId, blockNumber: block.number.toString(), logs: block.logs.length })}::jsonb)
			`
		})
	}

	async updateObservedHead(chainId: number, head: bigint, phase: string, lease: IndexerLease): Promise<void> {
		await lease.assertHeld()
		await lease.connection.begin(async (transaction) => {
			await transaction`UPDATE networks SET observed_block = ${head.toString()}, phase = ${phase}, last_poll_at = now(), last_success_at = now(), last_error = null, failure_started_at = null, consecutive_failures = 0, next_retry_at = null, updated_at = now() WHERE chain_id = ${chainId}`
			await lockLiveEventWriter(transaction)
			await transaction`INSERT INTO live_events (event, payload) VALUES ('status', ${JSON.stringify({ chainId, blockNumber: head.toString() })}::jsonb)`
		})
	}

	async recordFailure(chainId: number, message: string, nextRetryAt: Date, lease: IndexerLease): Promise<void> {
		await lease.assertHeld()
		await lease.connection.begin(async (transaction) => {
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
				VALUES ('status', ${JSON.stringify({ chainId, phase: 'degraded', nextRetryAt: nextRetryAt.toISOString(), failures: Number(rows[0]?.['consecutive_failures'] ?? 1) })}::jsonb)
			`
		})
	}
}
