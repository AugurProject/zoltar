import { SQL } from 'bun'
import {
	destroyReservedConnection,
	type IndexerLease,
	type PersistedIndexerOwnershipState,
	releaseReservedConnection,
	runSerializedIndexerLeaseOperation,
	scannerDatabaseOptions,
} from './history.ts'
import {
	assertIndexerLeaseObservation,
	assertIndexerLeaseReleaseObservation,
	IndexerLeaseReleaseError,
	type IntegrityIssue,
	type LiveEvent,
	lockLiveEventWriter,
} from './records.ts'

export class ScannerDatabaseConnection {
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
}
