import type { SQL } from 'bun'

class ApiRequestError extends Error {}
class ApiConflictError extends Error {}

const integer = (value: string | null, name: string): number | undefined => {
	if (value === null || value === '') return undefined
	if (!/^\d+$/.test(value)) throw new ApiRequestError(`${name} must be a non-negative integer`)
	const result = Number(value)
	if (!Number.isSafeInteger(result) || result < 0) throw new ApiRequestError(`${name} must be a non-negative integer`)
	return result
}

const evmAddress = (value: string | null, name: string): string | undefined => {
	if (value === null || value.trim() === '') return undefined
	const result = value.trim().toLowerCase()
	if (!/^0x[0-9a-f]{40}$/.test(result)) throw new ApiRequestError(`${name} must be a complete 20-byte EVM address`)
	return result
}

const normalize = (value: unknown): unknown => {
	if (typeof value === 'bigint') return value.toString()
	if (value instanceof Date) return value.toISOString()
	if (Array.isArray(value)) return value.map(normalize)
	if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]))
	return value
}

const json = (value: unknown, status = 200): Response =>
	Response.json(normalize(value), {
		status,
		headers: { 'cache-control': 'no-store' },
	})

const isExactIsoTimestamp = (value: string): boolean => {
	if (!/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false
	const parsed = new Date(value)
	return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value
}

const isNonNegativeSafeInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const isPostgresInteger = (value: unknown): value is number => isNonNegativeSafeInteger(value) && value <= 2_147_483_647
const routeInteger = (value: string | undefined, postgresInteger = false): number | undefined => {
	if (value === undefined || !/^\d+$/.test(value)) return undefined
	const result = Number(value)
	return (postgresInteger ? isPostgresInteger(result) : isNonNegativeSafeInteger(result)) ? result : undefined
}

export const parseCursor = (value: string | null): readonly [string, number, number, number, number] | undefined => {
	if (value === null) return undefined
	try {
		const parsed = JSON.parse(atob(value)) as unknown
		const parts = Array.isArray(parsed) ? parsed : []
		if (
			parts.length !== 5 ||
			typeof parts[0] !== 'string' ||
			!isExactIsoTimestamp(parts[0]) ||
			!isNonNegativeSafeInteger(parts[1]) ||
			!isNonNegativeSafeInteger(parts[2]) ||
			!isPostgresInteger(parts[3]) ||
			!isPostgresInteger(parts[4])
		)
			throw new Error('shape')
		return parts as [string, number, number, number, number]
	} catch (error) {
		throw new ApiRequestError('cursor is invalid', { cause: error })
	}
}

export const cursorFor = (row: Record<string, unknown>): string =>
	btoa(
		JSON.stringify([row['block_timestamp'], Number(row['chain_id']), Number(row['block_number']), Number(row['transaction_index']), Number(row['log_index'])]),
	)

type AddressTransactionCursor = readonly [
	chainId: number,
	address: string,
	snapshotBlock: string,
	snapshotHash: string,
	total: number,
	block: string,
	transaction: number,
]

const isPostgresBigint = (value: unknown): value is string => {
	if (typeof value !== 'string' || !/^(0|[1-9]\d{0,18})$/.test(value)) return false
	return BigInt(value) <= 9_223_372_036_854_775_807n
}

const parseAddressTransactionCursor = (value: string | null): AddressTransactionCursor | undefined => {
	if (value === null) return undefined
	try {
		const parsed = JSON.parse(atob(value)) as unknown
		const parts = Array.isArray(parsed) ? parsed : []
		if (
			parts.length !== 7 ||
			!isNonNegativeSafeInteger(parts[0]) ||
			typeof parts[1] !== 'string' ||
			!/^0x[0-9a-f]{40}$/.test(parts[1]) ||
			!isPostgresBigint(parts[2]) ||
			typeof parts[3] !== 'string' ||
			!/^0x[0-9a-f]{64}$/.test(parts[3]) ||
			!isNonNegativeSafeInteger(parts[4]) ||
			!isPostgresBigint(parts[5]) ||
			!isPostgresInteger(parts[6]) ||
			BigInt(parts[5]) > BigInt(parts[2])
		)
			throw new Error('shape')
		return parts as [number, string, string, string, number, string, number]
	} catch (error) {
		throw new ApiRequestError('cursor is invalid', { cause: error })
	}
}

const addressTransactionCursorFor = (
	chainId: number,
	address: string,
	snapshotBlock: string,
	snapshotHash: string,
	total: number,
	row: Record<string, unknown>,
): string => btoa(JSON.stringify([chainId, address, snapshotBlock, snapshotHash, total, String(row['block_number']), Number(row['transaction_index'])]))

const listLogs = async (sql: SQL, url: URL): Promise<Response> => {
	const chainId = integer(url.searchParams.get('chainId'), 'chainId')
	const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 100
	const limit = Math.min(Math.max(requestedLimit, 1), 250)
	const cursor = parseCursor(url.searchParams.get('cursor'))
	const event = url.searchParams.get('event')?.trim() || undefined
	const address = evmAddress(url.searchParams.get('address'), 'address')
	const decoded = url.searchParams.get('decoded')
	if (decoded !== null && decoded !== '' && decoded !== 'true' && decoded !== 'false') throw new ApiRequestError('decoded must be true or false')
	const values: Array<string | number> = []
	const clauses = ['l.canonical = true']
	const bind = (value: string | number): string => {
		values.push(value)
		return `$${values.length}`
	}
	if (chainId !== undefined) clauses.push(`l.chain_id = ${bind(chainId)}`)
	if (event !== undefined) clauses.push(`l.event_name ILIKE ${bind(`%${event}%`)}`)
	if (address !== undefined) {
		const addressParameter = bind(address)
		const addressPatternParameter = bind(`%${address}%`)
		clauses.push(`(
			l.emitter_address = ${addressParameter}
			OR l.arguments::text ILIKE ${addressPatternParameter}
			OR EXISTS (
				SELECT 1 FROM address_activity activity
				WHERE activity.canonical
					AND activity.chain_id = l.chain_id
					AND activity.block_hash = l.block_hash
					AND activity.tx_hash = l.tx_hash
					AND activity.address = ${addressParameter}
			)
		)`)
	}
	if (decoded === 'true') clauses.push("l.decode_status = 'decoded'")
	if (decoded === 'false') clauses.push("l.decode_status <> 'decoded'")
	if (cursor !== undefined) {
		const [timestamp, cursorChain, block, transaction, log] = cursor
		clauses.push(
			`(b.timestamp, l.chain_id, l.block_number, l.transaction_index, l.log_index) < (${bind(timestamp)}::timestamptz, ${bind(cursorChain)}, ${bind(block)}, ${bind(transaction)}, ${bind(log)})`,
		)
	}
	values.push(limit + 1)
	const rows = await sql.unsafe(
		`SELECT l.*, b.timestamp AS block_timestamp, b.hash AS canonical_block_hash, t.from_address AS origin_address, c.label AS contract_label, c.kind AS contract_kind, n.id AS network_id, n.name AS network_name, n.explorer_base_url
		FROM logs l
		JOIN blocks b ON b.chain_id = l.chain_id AND b.hash = l.block_hash
		JOIN transactions t ON t.chain_id = l.chain_id AND t.block_hash = l.block_hash AND t.hash = l.tx_hash AND t.canonical
		JOIN networks n ON n.chain_id = l.chain_id
		LEFT JOIN contracts c ON c.chain_id = l.chain_id AND c.address = l.emitter_address AND c.canonical
		WHERE ${clauses.join(' AND ')}
		ORDER BY b.timestamp DESC, l.chain_id DESC, l.block_number DESC, l.transaction_index DESC, l.log_index DESC
		LIMIT $${values.length}`,
		values,
	)
	const hasMore = rows.length > limit
	const items = rows.slice(0, limit)
	return json({ items, nextCursor: hasMore && items.length > 0 ? cursorFor(items[items.length - 1] as Record<string, unknown>) : undefined })
}

const logDetail = async (sql: SQL, parts: readonly string[]): Promise<Response> => {
	const chainId = routeInteger(parts[0])
	const blockHash = parts[1]
	const hash = parts[2]
	const logIndex = routeInteger(parts[3], true)
	if (
		parts.length !== 4 ||
		chainId === undefined ||
		blockHash === undefined ||
		!/^0x[0-9a-fA-F]{64}$/.test(blockHash) ||
		hash === undefined ||
		!/^0x[0-9a-fA-F]{64}$/.test(hash) ||
		logIndex === undefined
	)
		return json({ error: 'Invalid log identifier' }, 400)
	const rows = await sql`
		SELECT l.*, b.timestamp AS block_timestamp, c.label AS contract_label, c.kind AS contract_kind, c.provenance AS contract_provenance,
			t.from_address AS origin_address, t.to_address, t.value, t.input, t.gas_used, t.receipt, a.function_name, a.function_signature, a.arguments AS action_arguments, a.display_arguments AS action_display_arguments, a.argument_schema AS action_argument_schema, a.summary AS action_summary,
			n.id AS network_id, n.explorer_base_url
		FROM logs l
		JOIN blocks b ON b.chain_id = l.chain_id AND b.hash = l.block_hash
		JOIN transactions t ON t.chain_id = l.chain_id AND t.block_hash = l.block_hash AND t.hash = l.tx_hash
		LEFT JOIN actions a ON a.chain_id = l.chain_id AND a.block_hash = l.block_hash AND a.tx_hash = l.tx_hash
		LEFT JOIN contracts c ON c.chain_id = l.chain_id AND c.address = l.emitter_address AND c.canonical
		JOIN networks n ON n.chain_id = l.chain_id
		WHERE l.canonical AND b.canonical AND t.canonical
			AND l.chain_id = ${chainId} AND l.block_hash = ${blockHash.toLowerCase()} AND l.tx_hash = ${hash.toLowerCase()} AND l.log_index = ${logIndex}
	`
	if (rows.length === 0) return json({ error: 'Log not found' }, 404)
	const related =
		await sql`SELECT log_index, emitter_address, event_name, summary FROM logs WHERE canonical AND chain_id = ${chainId} AND block_hash = ${blockHash.toLowerCase()} AND tx_hash = ${hash.toLowerCase()} ORDER BY log_index`
	return json({ ...rows[0], relatedLogs: related })
}

const stateCatalog = async (sql: SQL, url: URL): Promise<Response> => {
	const chainId = integer(url.searchParams.get('chainId'), 'chainId')
	const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 500
	const limit = Math.min(Math.max(requestedLimit, 1), 1_000)
	const queryLimit = limit + 1
	const questions =
		chainId === undefined
			? await sql`SELECT q.*, n.id AS network_id,
				(SELECT count(*) FROM pools p WHERE p.chain_id = q.chain_id AND p.question_id = q.question_id AND p.canonical) AS pool_count,
				(SELECT count(*) FROM universe_events u WHERE u.chain_id = q.chain_id AND u.fork_question_id = q.question_id AND u.event_name = 'UniverseForked' AND u.canonical) AS fork_count
				FROM questions q JOIN networks n USING (chain_id) WHERE q.canonical ORDER BY q.created_timestamp DESC LIMIT ${queryLimit}`
			: await sql`SELECT q.*, n.id AS network_id,
				(SELECT count(*) FROM pools p WHERE p.chain_id = q.chain_id AND p.question_id = q.question_id AND p.canonical) AS pool_count,
				(SELECT count(*) FROM universe_events u WHERE u.chain_id = q.chain_id AND u.fork_question_id = q.question_id AND u.event_name = 'UniverseForked' AND u.canonical) AS fork_count
				FROM questions q JOIN networks n USING (chain_id) WHERE q.canonical AND q.chain_id = ${chainId} ORDER BY q.created_timestamp DESC LIMIT ${queryLimit}`
	const pools =
		chainId === undefined
			? await sql`SELECT p.*, n.id AS network_id, q.title AS question_title,
				ps.settlement_collateral_atto_eth, ps.total_capacity_ownership_atto_rep, ps.fee_eligible_capacity_ownership_atto_rep, ps.total_claimable_vault_fees_atto_eth, ps.unallocated_accrued_fees_atto_eth, ps.current_retention_rate, ps.block_number AS snapshot_block,
				(SELECT count(DISTINCT v.vault_address) FROM vault_snapshots v WHERE v.chain_id = p.chain_id AND v.pool_address = p.pool_address AND v.canonical) AS vault_count,
				(SELECT count(*) FROM pools child WHERE child.chain_id = p.chain_id AND child.parent_address = p.pool_address AND child.canonical) AS child_count
				FROM pools p JOIN networks n USING (chain_id)
				LEFT JOIN questions q ON q.chain_id = p.chain_id AND q.question_id = p.question_id AND q.canonical
				LEFT JOIN LATERAL (SELECT * FROM pool_snapshots snapshot WHERE snapshot.chain_id = p.chain_id AND snapshot.pool_address = p.pool_address AND snapshot.canonical ORDER BY snapshot.block_number DESC, snapshot.log_index DESC LIMIT 1) ps ON true
				WHERE p.canonical ORDER BY p.block_number DESC LIMIT ${queryLimit}`
			: await sql`SELECT p.*, n.id AS network_id, q.title AS question_title,
				ps.settlement_collateral_atto_eth, ps.total_capacity_ownership_atto_rep, ps.fee_eligible_capacity_ownership_atto_rep, ps.total_claimable_vault_fees_atto_eth, ps.unallocated_accrued_fees_atto_eth, ps.current_retention_rate, ps.block_number AS snapshot_block,
				(SELECT count(DISTINCT v.vault_address) FROM vault_snapshots v WHERE v.chain_id = p.chain_id AND v.pool_address = p.pool_address AND v.canonical) AS vault_count,
				(SELECT count(*) FROM pools child WHERE child.chain_id = p.chain_id AND child.parent_address = p.pool_address AND child.canonical) AS child_count
				FROM pools p JOIN networks n USING (chain_id)
				LEFT JOIN questions q ON q.chain_id = p.chain_id AND q.question_id = p.question_id AND q.canonical
				LEFT JOIN LATERAL (SELECT * FROM pool_snapshots snapshot WHERE snapshot.chain_id = p.chain_id AND snapshot.pool_address = p.pool_address AND snapshot.canonical ORDER BY snapshot.block_number DESC, snapshot.log_index DESC LIMIT 1) ps ON true
				WHERE p.canonical AND p.chain_id = ${chainId} ORDER BY p.block_number DESC LIMIT ${queryLimit}`
	const vaults =
		chainId === undefined
			? await sql`SELECT DISTINCT ON (v.chain_id, v.pool_address, v.vault_address) v.*, n.id AS network_id, q.title AS question_title
				FROM vault_snapshots v JOIN networks n USING (chain_id) LEFT JOIN pools p ON p.chain_id = v.chain_id AND p.pool_address = v.pool_address AND p.canonical LEFT JOIN questions q ON q.chain_id = p.chain_id AND q.question_id = p.question_id AND q.canonical
				WHERE v.canonical ORDER BY v.chain_id, v.pool_address, v.vault_address, v.block_number DESC, v.log_index DESC LIMIT ${queryLimit}`
			: await sql`SELECT DISTINCT ON (v.chain_id, v.pool_address, v.vault_address) v.*, n.id AS network_id, q.title AS question_title
				FROM vault_snapshots v JOIN networks n USING (chain_id) LEFT JOIN pools p ON p.chain_id = v.chain_id AND p.pool_address = v.pool_address AND p.canonical LEFT JOIN questions q ON q.chain_id = p.chain_id AND q.question_id = p.question_id AND q.canonical
				WHERE v.canonical AND v.chain_id = ${chainId} ORDER BY v.chain_id, v.pool_address, v.vault_address, v.block_number DESC, v.log_index DESC LIMIT ${queryLimit}`
	const universes =
		chainId === undefined
			? await sql`WITH identity AS (
				SELECT DISTINCT ON (chain_id, universe_id) * FROM universe_events WHERE canonical AND event_name IN ('UniverseInitialized', 'DeployChild') ORDER BY chain_id, universe_id, block_number, log_index
			), latest_supply AS (
				SELECT DISTINCT ON (chain_id, universe_id) chain_id, universe_id, theoretical_supply_atto_rep, block_number AS supply_block FROM universe_events WHERE canonical AND theoretical_supply_atto_rep IS NOT NULL ORDER BY chain_id, universe_id, block_number DESC, log_index DESC
			), fork AS (
				SELECT DISTINCT ON (chain_id, universe_id) chain_id, universe_id, fork_question_id, fork_time, forker_address, fork_threshold_atto_rep, migration_rep_balance_atto_rep FROM universe_events WHERE canonical AND event_name = 'UniverseForked' ORDER BY chain_id, universe_id, block_number DESC, log_index DESC
			) SELECT i.*, n.id AS network_id, s.theoretical_supply_atto_rep, s.supply_block, f.fork_question_id AS active_fork_question_id, f.fork_time AS active_fork_time, f.forker_address, f.fork_threshold_atto_rep, f.migration_rep_balance_atto_rep,
				(SELECT count(*) FROM identity child WHERE child.chain_id = i.chain_id AND child.parent_universe_id = i.universe_id AND child.universe_id <> i.universe_id) AS child_count,
				(SELECT count(*) FROM pools p WHERE p.chain_id = i.chain_id AND p.universe_id = i.universe_id AND p.canonical) AS pool_count
				FROM identity i JOIN networks n USING (chain_id) LEFT JOIN latest_supply s USING (chain_id, universe_id) LEFT JOIN fork f USING (chain_id, universe_id) ORDER BY i.chain_id, i.block_number LIMIT ${queryLimit}`
			: await sql`WITH identity AS (
				SELECT DISTINCT ON (chain_id, universe_id) * FROM universe_events WHERE canonical AND event_name IN ('UniverseInitialized', 'DeployChild') AND chain_id = ${chainId} ORDER BY chain_id, universe_id, block_number, log_index
			), latest_supply AS (
				SELECT DISTINCT ON (chain_id, universe_id) chain_id, universe_id, theoretical_supply_atto_rep, block_number AS supply_block FROM universe_events WHERE canonical AND theoretical_supply_atto_rep IS NOT NULL AND chain_id = ${chainId} ORDER BY chain_id, universe_id, block_number DESC, log_index DESC
			), fork AS (
				SELECT DISTINCT ON (chain_id, universe_id) chain_id, universe_id, fork_question_id, fork_time, forker_address, fork_threshold_atto_rep, migration_rep_balance_atto_rep FROM universe_events WHERE canonical AND event_name = 'UniverseForked' AND chain_id = ${chainId} ORDER BY chain_id, universe_id, block_number DESC, log_index DESC
			) SELECT i.*, n.id AS network_id, s.theoretical_supply_atto_rep, s.supply_block, f.fork_question_id AS active_fork_question_id, f.fork_time AS active_fork_time, f.forker_address, f.fork_threshold_atto_rep, f.migration_rep_balance_atto_rep,
				(SELECT count(*) FROM identity child WHERE child.chain_id = i.chain_id AND child.parent_universe_id = i.universe_id AND child.universe_id <> i.universe_id) AS child_count,
				(SELECT count(*) FROM pools p WHERE p.chain_id = i.chain_id AND p.universe_id = i.universe_id AND p.canonical) AS pool_count
				FROM identity i JOIN networks n USING (chain_id) LEFT JOIN latest_supply s USING (chain_id, universe_id) LEFT JOIN fork f USING (chain_id, universe_id) ORDER BY i.chain_id, i.block_number LIMIT ${queryLimit}`
	const poolStates =
		chainId === undefined
			? await sql`SELECT DISTINCT ON (chain_id, pool_address, event_name) chain_id, pool_address, event_name, state, block_number, log_index FROM pool_state_events WHERE canonical ORDER BY chain_id, pool_address, event_name, block_number DESC, log_index DESC LIMIT ${queryLimit}`
			: await sql`SELECT DISTINCT ON (chain_id, pool_address, event_name) chain_id, pool_address, event_name, state, block_number, log_index FROM pool_state_events WHERE canonical AND chain_id = ${chainId} ORDER BY chain_id, pool_address, event_name, block_number DESC, log_index DESC LIMIT ${queryLimit}`
	const truncate = (rows: readonly unknown[]): readonly unknown[] => rows.slice(0, limit)
	return json({
		questions: truncate(questions),
		pools: truncate(pools),
		vaults: truncate(vaults),
		universes: truncate(universes),
		poolStates: truncate(poolStates),
		limit,
		truncated: {
			questions: questions.length > limit,
			pools: pools.length > limit,
			vaults: vaults.length > limit,
			universes: universes.length > limit,
			poolStates: poolStates.length > limit,
		},
	})
}

const stateHistory = async (sql: SQL, parts: readonly string[], url: URL): Promise<Response> => {
	const type = parts[0]
	const chainId = routeInteger(parts[1])
	const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 1_000
	const limit = Math.min(Math.max(requestedLimit, 1), 2_000)
	const queryLimit = limit + 1
	const chronological = <T>(rows: readonly T[]): T[] => rows.slice(0, limit).reverse()
	if (chainId === undefined) return json({ error: 'Invalid state identifier' }, 400)
	if (type === 'pools') {
		const address = parts[2]?.toLowerCase()
		if (parts.length !== 3 || address === undefined || !/^0x[0-9a-f]{40}$/.test(address)) return json({ error: 'Invalid pool address' }, 400)
		const [snapshots, events] = await Promise.all([
			sql`SELECT s.*, b.timestamp FROM pool_snapshots s JOIN blocks b ON b.chain_id = s.chain_id AND b.hash = s.block_hash WHERE s.chain_id = ${chainId} AND s.pool_address = ${address} AND s.canonical ORDER BY s.block_number DESC, s.log_index DESC LIMIT ${queryLimit}`,
			sql`SELECT e.*, b.timestamp FROM pool_state_events e JOIN blocks b ON b.chain_id = e.chain_id AND b.hash = e.block_hash WHERE e.chain_id = ${chainId} AND e.pool_address = ${address} AND e.canonical ORDER BY e.block_number DESC, e.log_index DESC LIMIT ${queryLimit}`,
		])
		return json({ snapshots: chronological(snapshots), events: chronological(events), truncated: snapshots.length > limit || events.length > limit, limit })
	}
	if (type === 'vaults') {
		const pool = parts[2]?.toLowerCase()
		const vault = parts[3]?.toLowerCase()
		if (parts.length !== 4 || pool === undefined || vault === undefined || !/^0x[0-9a-f]{40}$/.test(pool) || !/^0x[0-9a-f]{40}$/.test(vault))
			return json({ error: 'Invalid vault identifier' }, 400)
		const snapshots =
			await sql`SELECT v.*, b.timestamp FROM vault_snapshots v JOIN blocks b ON b.chain_id = v.chain_id AND b.hash = v.block_hash WHERE v.chain_id = ${chainId} AND v.pool_address = ${pool} AND v.vault_address = ${vault} AND v.canonical ORDER BY v.block_number DESC, v.log_index DESC LIMIT ${queryLimit}`
		return json({ snapshots: chronological(snapshots), truncated: snapshots.length > limit, limit })
	}
	if (type === 'universes') {
		const universeId = parts[2]
		if (parts.length !== 3 || universeId === undefined || !/^\d+$/.test(universeId)) return json({ error: 'Invalid universe identifier' }, 400)
		const events =
			await sql`SELECT u.*, b.timestamp FROM universe_events u JOIN blocks b ON b.chain_id = u.chain_id AND b.hash = u.block_hash WHERE u.chain_id = ${chainId} AND u.universe_id = ${universeId} AND u.canonical ORDER BY u.block_number DESC, u.log_index DESC LIMIT ${queryLimit}`
		return json({ events: chronological(events), truncated: events.length > limit, limit })
	}
	if (type === 'questions') {
		const questionId = parts[2]
		if (parts.length !== 3 || questionId === undefined || !/^\d+$/.test(questionId)) return json({ error: 'Invalid question identifier' }, 400)
		const [pools, forks] = await Promise.all([
			sql`SELECT p.pool_address, p.universe_id, p.block_number, b.timestamp FROM pools p JOIN blocks b ON b.chain_id = p.chain_id AND b.hash = p.block_hash WHERE p.chain_id = ${chainId} AND p.question_id = ${questionId} AND p.canonical ORDER BY p.block_number DESC LIMIT ${queryLimit}`,
			sql`SELECT u.universe_id, u.block_number, u.fork_time AS timestamp FROM universe_events u WHERE u.chain_id = ${chainId} AND u.fork_question_id = ${questionId} AND u.event_name = 'UniverseForked' AND u.canonical ORDER BY u.block_number DESC LIMIT ${queryLimit}`,
		])
		return json({ pools: chronological(pools), forks: chronological(forks), truncated: pools.length > limit || forks.length > limit, limit })
	}
	return json({ error: 'Unknown state history type' }, 404)
}

const addressTransactions = async (sql: SQL, url: URL): Promise<Response> => {
	const chainId = integer(url.searchParams.get('chainId'), 'chainId')
	if (chainId === undefined) throw new ApiRequestError('chainId is required')
	const address = evmAddress(url.searchParams.get('address'), 'address')
	if (address === undefined) throw new ApiRequestError('address is required')
	const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 50
	const limit = Math.min(Math.max(requestedLimit, 1), 100)
	const cursor = parseAddressTransactionCursor(url.searchParams.get('cursor'))
	if (cursor !== undefined && (cursor[0] !== chainId || cursor[1] !== address)) throw new ApiRequestError('cursor does not match the requested account')
	const anchorRows =
		cursor === undefined
			? await sql`SELECT transaction.block_number AS snapshot_block, transaction.block_hash AS snapshot_hash
				FROM transactions transaction
				JOIN blocks block ON block.chain_id = transaction.chain_id AND block.hash = transaction.block_hash AND block.canonical
				WHERE transaction.canonical AND transaction.chain_id = ${chainId} AND transaction.from_address = ${address}
				ORDER BY transaction.block_number DESC, transaction.transaction_index DESC LIMIT 1`
			: []
	const snapshotBlock = cursor?.[2] ?? String(anchorRows[0]?.['snapshot_block'] ?? 0)
	const snapshotHash = cursor?.[3] ?? String(anchorRows[0]?.['snapshot_hash'] ?? '')
	if (cursor !== undefined) {
		const validationRows = await sql`
			SELECT
				EXISTS (SELECT 1 FROM blocks WHERE chain_id = ${chainId} AND number = ${snapshotBlock} AND hash = ${snapshotHash} AND canonical) AS snapshot_canonical,
				(SELECT count(*) FROM transactions transaction
					JOIN blocks block ON block.chain_id = transaction.chain_id AND block.hash = transaction.block_hash AND block.canonical
					WHERE transaction.canonical AND transaction.chain_id = ${chainId} AND transaction.from_address = ${address}
						AND transaction.block_number <= ${snapshotBlock}) AS snapshot_total
		`
		if (validationRows[0]?.['snapshot_canonical'] !== true || Number(validationRows[0]?.['snapshot_total'] ?? -1) !== cursor[4])
			throw new ApiConflictError('Transaction history changed; restart pagination')
	}
	const values: Array<string | number> = [chainId, address, snapshotBlock]
	const cursorClause =
		cursor === undefined
			? ''
			: (() => {
					values.push(cursor[5], cursor[6])
					return `AND (t.block_number, t.transaction_index) < ($${values.length - 1}::bigint, $${values.length}::integer)`
				})()
	values.push(limit + 1)
	const rows = await sql.unsafe(
		`WITH snapshot_transactions AS (
			SELECT t.*, count(*) OVER () AS snapshot_total
			FROM transactions t
			JOIN blocks canonical_block ON canonical_block.chain_id = t.chain_id AND canonical_block.hash = t.block_hash AND canonical_block.canonical
			WHERE t.canonical AND t.chain_id = $1 AND t.from_address = $2 AND t.block_number <= $3::bigint
		)
		SELECT t.chain_id, t.hash AS tx_hash, t.block_hash, t.block_number, t.transaction_index,
			t.from_address, t.to_address, t.value, t.status, t.gas_used, t.snapshot_total, b.timestamp AS block_timestamp,
			a.function_name, a.function_signature, a.arguments AS action_arguments,
			a.display_arguments AS action_display_arguments, a.argument_schema AS action_argument_schema,
			a.decode_status AS action_decode_status, a.summary AS action_summary,
			c.label AS to_label, c.kind AS to_kind, n.explorer_base_url
		FROM snapshot_transactions t
		JOIN blocks b ON b.chain_id = t.chain_id AND b.hash = t.block_hash AND b.canonical
		JOIN networks n ON n.chain_id = t.chain_id
		LEFT JOIN actions a ON a.chain_id = t.chain_id AND a.block_hash = t.block_hash AND a.tx_hash = t.hash
		LEFT JOIN contracts c ON c.chain_id = t.chain_id AND c.address = t.to_address AND c.canonical
		WHERE true ${cursorClause}
		ORDER BY t.block_number DESC, t.transaction_index DESC
		LIMIT $${values.length}`,
		values,
	)
	const total = cursor?.[4] ?? Number(rows[0]?.['snapshot_total'] ?? 0)
	const hasMore = rows.length > limit
	const pageRows = rows.slice(0, limit)
	const items = pageRows.map((row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'snapshot_total')))
	return json({
		items,
		total,
		limit,
		snapshotBlock,
		nextCursor:
			hasMore && pageRows.length > 0
				? addressTransactionCursorFor(chainId, address, snapshotBlock, snapshotHash, total, pageRows[pageRows.length - 1] as Record<string, unknown>)
				: undefined,
	})
}

const addressInteractions = async (sql: SQL, url: URL): Promise<Response> => {
	const chainId = integer(url.searchParams.get('chainId'), 'chainId')
	if (chainId === undefined) throw new ApiRequestError('chainId is required')
	const address = evmAddress(url.searchParams.get('address'), 'address')
	if (address === undefined) throw new ApiRequestError('address is required')
	const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 20
	const limit = Math.min(Math.max(requestedLimit, 1), 100)
	const rows = await sql`
		WITH interactions AS (
			SELECT activity.chain_id, activity.block_hash, activity.block_number, activity.tx_hash,
				array_agg(DISTINCT activity.role ORDER BY activity.role) AS roles,
				array_agg(DISTINCT activity.pool_address ORDER BY activity.pool_address)
					FILTER (WHERE activity.pool_address <> '0x0000000000000000000000000000000000000000') AS pool_addresses
			FROM address_activity activity
			JOIN blocks canonical_block ON canonical_block.chain_id = activity.chain_id AND canonical_block.hash = activity.block_hash AND canonical_block.canonical
			JOIN transactions canonical_transaction ON canonical_transaction.chain_id = activity.chain_id
				AND canonical_transaction.block_hash = activity.block_hash AND canonical_transaction.hash = activity.tx_hash AND canonical_transaction.canonical
			WHERE activity.canonical AND activity.role = 'referenced' AND activity.chain_id = ${chainId} AND activity.address = ${address}
			GROUP BY activity.chain_id, activity.block_hash, activity.block_number, activity.tx_hash
			ORDER BY activity.block_number DESC, max(canonical_transaction.transaction_index) DESC
			LIMIT ${limit}
		)
		SELECT interaction.*, transaction.transaction_index, transaction.from_address, transaction.to_address,
			transaction.value, transaction.status, transaction.gas_used, block.timestamp AS block_timestamp,
			action.function_name, action.function_signature, action.arguments AS action_arguments,
			action.display_arguments AS action_display_arguments, action.argument_schema AS action_argument_schema,
			action.decode_status AS action_decode_status, action.summary AS action_summary,
			destination.label AS to_label, destination.kind AS to_kind, network.explorer_base_url
		FROM interactions interaction
		JOIN transactions transaction ON transaction.chain_id = interaction.chain_id
			AND transaction.block_hash = interaction.block_hash AND transaction.hash = interaction.tx_hash AND transaction.canonical
		JOIN blocks block ON block.chain_id = interaction.chain_id AND block.hash = interaction.block_hash AND block.canonical
		JOIN networks network ON network.chain_id = interaction.chain_id
		LEFT JOIN actions action ON action.chain_id = interaction.chain_id AND action.block_hash = interaction.block_hash AND action.tx_hash = interaction.tx_hash
		LEFT JOIN contracts destination ON destination.chain_id = interaction.chain_id AND destination.address = transaction.to_address AND destination.canonical
		ORDER BY interaction.block_number DESC, transaction.transaction_index DESC
	`
	return json({ items: rows, limit })
}

const addressIdentity = async (sql: SQL, url: URL): Promise<Response> => {
	const chainId = integer(url.searchParams.get('chainId'), 'chainId')
	if (chainId === undefined) throw new ApiRequestError('chainId is required')
	const address = evmAddress(url.searchParams.get('address'), 'address')
	if (address === undefined) throw new ApiRequestError('address is required')
	const rows = await sql`SELECT label, kind, provenance FROM contracts WHERE canonical AND chain_id = ${chainId} AND address = ${address}`
	return json({ chainId, address, ...(rows[0] ?? {}) })
}

const richList = async (sql: SQL, url: URL): Promise<Response> => {
	const chainId = integer(url.searchParams.get('chainId'), 'chainId')
	const address = evmAddress(url.searchParams.get('address'), 'address')
	if (address !== undefined && chainId === undefined) throw new ApiRequestError('chainId is required when filtering by address')
	const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 50
	const limit = Math.min(Math.max(requestedLimit, 1), 100)
	const offset = Math.min(integer(url.searchParams.get('offset'), 'offset') ?? 0, 100_000)
	const sort = url.searchParams.get('sort') ?? 'transactions'
	const orderBy = {
		eth: 'native_balance DESC, transaction_count DESC',
		weth: 'weth_balance DESC, transaction_count DESC',
		transactions: 'transaction_count DESC, interaction_count DESC',
	}[sort]
	if (orderBy === undefined) throw new ApiRequestError('sort must be eth, weth, or transactions')
	const values: Array<string | number> = []
	const chainClause =
		chainId === undefined
			? ''
			: (() => {
					values.push(chainId)
					return `AND activity.chain_id = $${values.length}`
				})()
	const addressClause =
		address === undefined
			? ''
			: (() => {
					values.push(address)
					return `AND activity.address = $${values.length}`
				})()
	values.push(limit, offset)
	const rowsPromise = sql.unsafe(
		`WITH activity_summary AS (
			SELECT activity.chain_id, activity.address, min(activity.block_number) AS first_seen_block,
				max(activity.block_number) AS last_seen_block,
				count(DISTINCT activity.tx_hash) FILTER (WHERE activity.role = 'sender') AS transaction_count,
				count(DISTINCT activity.tx_hash) AS interaction_count,
				count(DISTINCT NULLIF(activity.pool_address, '0x0000000000000000000000000000000000000000')) AS pool_count
			FROM address_activity activity WHERE activity.canonical ${chainClause} ${addressClause}
			GROUP BY activity.chain_id, activity.address
		), latest_balances AS (
			SELECT DISTINCT ON (snapshot.chain_id, snapshot.address, snapshot.asset_address)
				snapshot.chain_id, snapshot.address, snapshot.asset_address, snapshot.asset_kind, snapshot.balance,
				snapshot.block_number, snapshot.observed_at
			FROM address_balance_snapshots snapshot
			WHERE snapshot.canonical AND (
				snapshot.asset_kind = 'native' OR EXISTS (
					SELECT 1 FROM contracts asset
					WHERE asset.chain_id = snapshot.chain_id AND asset.address = snapshot.asset_address AND asset.canonical
						AND asset.kind IN ('reputationToken', 'weth')
				)
			)
			ORDER BY snapshot.chain_id, snapshot.address, snapshot.asset_address, snapshot.block_number DESC
		), balance_summary AS (
			SELECT chain_id, address,
				COALESCE(sum(balance) FILTER (WHERE asset_kind = 'weth'), 0) AS weth_balance,
				COALESCE(max(balance) FILTER (WHERE asset_kind = 'native'), 0) AS native_balance,
				count(*) FILTER (WHERE asset_kind = 'rep') AS sampled_rep_token_count,
				count(*) FILTER (WHERE asset_kind = 'weth') AS sampled_weth_token_count,
				count(*) FILTER (WHERE asset_kind = 'native') AS sampled_native_count,
				min(block_number) AS oldest_balance_block, max(observed_at) AS last_balance_refresh
			FROM latest_balances GROUP BY chain_id, address
		), asset_summary AS (
			SELECT chain_id,
				count(*) FILTER (WHERE kind = 'reputationToken') AS rep_token_count,
				count(*) FILTER (WHERE kind = 'weth') AS weth_token_count
			FROM contracts WHERE canonical GROUP BY chain_id
		), latest_token_metadata AS (
			SELECT DISTINCT ON (chain_id, address) chain_id, address, name, symbol, decimals
			FROM token_metadata WHERE canonical
			ORDER BY chain_id, address, read_block DESC
		), latest_vaults AS (
			SELECT DISTINCT ON (chain_id, pool_address, vault_address) chain_id, pool_address, vault_address,
				rep_backing_units, capacity_ownership_atto_rep, claimable_fees_atto_eth, block_number
			FROM vault_snapshots WHERE canonical
			ORDER BY chain_id, pool_address, vault_address, block_number DESC, log_index DESC
		), vault_summary AS (
			SELECT chain_id, vault_address AS address, count(*) AS vault_count,
				count(*) FILTER (WHERE rep_backing_units > 0 OR capacity_ownership_atto_rep > 0 OR claimable_fees_atto_eth > 0) AS active_vault_count
			FROM latest_vaults GROUP BY chain_id, vault_address
		), ranked AS (
			SELECT activity.*, n.id AS network_id, n.explorer_base_url, c.label, c.kind,
				COALESCE(balance.weth_balance, 0) AS weth_balance,
				COALESCE(balance.native_balance, 0) AS native_balance,
				COALESCE(balance.sampled_rep_token_count, 0) AS sampled_rep_token_count,
				COALESCE(balance.sampled_weth_token_count, 0) AS sampled_weth_token_count,
				COALESCE(balance.sampled_native_count, 0) AS sampled_native_count,
				LEAST(COALESCE(balance.sampled_rep_token_count, 0), 100) AS returned_rep_token_count,
				LEAST(COALESCE(balance.sampled_weth_token_count, 0), 100) AS returned_weth_token_count,
				COALESCE(balance.sampled_rep_token_count, 0) > 100 AS rep_balances_truncated,
				COALESCE(balance.sampled_weth_token_count, 0) > 100 AS weth_balances_truncated,
				COALESCE(assets.rep_token_count, 0) AS rep_token_count,
				COALESCE(assets.weth_token_count, 0) AS weth_token_count,
				balance.oldest_balance_block, balance.last_balance_refresh,
				COALESCE(vault.vault_count, 0) AS vault_count, COALESCE(vault.active_vault_count, 0) AS active_vault_count
			FROM activity_summary activity
			JOIN networks n USING (chain_id)
			LEFT JOIN asset_summary assets USING (chain_id)
			LEFT JOIN balance_summary balance USING (chain_id, address)
			LEFT JOIN vault_summary vault USING (chain_id, address)
			LEFT JOIN contracts c ON c.chain_id = activity.chain_id AND c.address = activity.address AND c.canonical
		), page AS (
			SELECT *, row_number() OVER (ORDER BY ${orderBy}, chain_id, address) AS page_order FROM ranked
			ORDER BY ${orderBy}, chain_id, address
			LIMIT $${values.length - 1} OFFSET $${values.length}
		), totals AS (
			SELECT count(*) AS total FROM ranked
		), enriched AS (
			SELECT page.*,
				COALESCE((
					SELECT jsonb_agg(jsonb_build_object(
						'address', association.pool_address, 'label', pool_contract.label, 'questionTitle', question.title
					) ORDER BY association.pool_address)
					FROM (
						SELECT DISTINCT pool_activity.pool_address
						FROM address_activity pool_activity
						WHERE pool_activity.chain_id = page.chain_id AND pool_activity.address = page.address
							AND pool_activity.canonical AND pool_activity.pool_address <> '0x0000000000000000000000000000000000000000'
						ORDER BY pool_activity.pool_address LIMIT 100
					) association
					LEFT JOIN contracts pool_contract ON pool_contract.chain_id = page.chain_id
						AND pool_contract.address = association.pool_address AND pool_contract.canonical
					LEFT JOIN LATERAL (
						SELECT pool.question_id FROM pools pool
						WHERE pool.chain_id = page.chain_id AND pool.pool_address = association.pool_address AND pool.canonical
						ORDER BY pool.block_number DESC LIMIT 1
					) pool ON true
					LEFT JOIN questions question ON question.chain_id = page.chain_id AND question.question_id = pool.question_id AND question.canonical
				), '[]'::jsonb) AS pool_associations,
				COALESCE((
					SELECT jsonb_agg(jsonb_build_object(
						'poolAddress', position.pool_address, 'questionTitle', question.title,
						'repBackingUnits', position.rep_backing_units::text,
						'capacityOwnershipAttoRep', position.capacity_ownership_atto_rep::text,
						'claimableFeesAttoEth', position.claimable_fees_atto_eth::text,
						'blockNumber', position.block_number::text
					) ORDER BY position.pool_address)
					FROM (
						SELECT * FROM latest_vaults latest_position
						WHERE latest_position.chain_id = page.chain_id AND latest_position.vault_address = page.address
						ORDER BY latest_position.pool_address LIMIT 100
					) position
					LEFT JOIN LATERAL (
						SELECT pool.question_id FROM pools pool
						WHERE pool.chain_id = page.chain_id AND pool.pool_address = position.pool_address AND pool.canonical
						ORDER BY pool.block_number DESC LIMIT 1
					) pool ON true
					LEFT JOIN questions question ON question.chain_id = page.chain_id AND question.question_id = pool.question_id AND question.canonical
				), '[]'::jsonb) AS vault_positions,
				COALESCE((
					SELECT jsonb_agg(jsonb_build_object(
						'address', token.asset_address, 'balance', token.balance::text, 'blockNumber', token.block_number::text,
						'name', metadata.name, 'symbol', metadata.symbol, 'decimals', metadata.decimals,
						'contractLabel', token_contract.label, 'universeId', universe.universe_id::text
					) ORDER BY token.asset_address)
					FROM (
						SELECT * FROM latest_balances rep_token
						WHERE rep_token.chain_id = page.chain_id AND rep_token.address = page.address AND rep_token.asset_kind = 'rep'
						ORDER BY rep_token.asset_address LIMIT 100
					) token
					LEFT JOIN latest_token_metadata metadata ON metadata.chain_id = token.chain_id AND metadata.address = token.asset_address
					LEFT JOIN contracts token_contract ON token_contract.chain_id = token.chain_id
						AND token_contract.address = token.asset_address AND token_contract.canonical
					LEFT JOIN LATERAL (
						SELECT event.universe_id FROM universe_events event
						WHERE event.chain_id = token.chain_id AND event.reputation_token_address = token.asset_address AND event.canonical
						ORDER BY event.block_number DESC, event.log_index DESC LIMIT 1
					) universe ON true
				), '[]'::jsonb) AS rep_balances,
				COALESCE((
					SELECT jsonb_agg(jsonb_build_object(
						'address', token.asset_address, 'balance', token.balance::text, 'blockNumber', token.block_number::text,
						'name', metadata.name, 'symbol', metadata.symbol, 'decimals', metadata.decimals
					) ORDER BY token.balance DESC, token.asset_address)
					FROM (
						SELECT * FROM latest_balances weth_token
						WHERE weth_token.chain_id = page.chain_id AND weth_token.address = page.address AND weth_token.asset_kind = 'weth'
						ORDER BY weth_token.balance DESC, weth_token.asset_address LIMIT 100
					) token
					LEFT JOIN latest_token_metadata metadata ON metadata.chain_id = token.chain_id AND metadata.address = token.asset_address
				), '[]'::jsonb) AS weth_balances,
				(
					SELECT jsonb_build_object('balance', native.balance::text, 'blockNumber', native.block_number::text)
					FROM latest_balances native
					WHERE native.chain_id = page.chain_id AND native.address = page.address AND native.asset_kind = 'native'
					LIMIT 1
				) AS native_balance_detail
			FROM page
		)
		SELECT enriched.*, totals.total FROM totals LEFT JOIN enriched ON true ORDER BY enriched.page_order`,
		values,
	)
	const rows = await rowsPromise
	return json({
		items: rows.filter((row: Record<string, unknown>) => row['address'] !== null),
		total: Number(rows[0]?.['total'] ?? 0),
		limit,
		offset,
		sort,
		positionLimit: 100,
		assetLimit: 100,
	})
}

export const handleApi = async (request: Request, sql: SQL, freshnessThresholdMs = 48_000): Promise<Response | undefined> => {
	const url = new URL(request.url)
	if (request.method !== 'GET') return json({ error: 'Read-only API' }, 405)
	try {
		if (url.pathname === '/api/v1/networks') {
			const rows =
				await sql`SELECT chain_id, id, name, explorer_base_url, start_block, indexed_block, indexed_hash, indexed_timestamp, observed_block, finalized_block, phase, last_poll_at, last_success_at, failure_started_at, consecutive_failures, next_retry_at, last_reorg_at, last_reorg_depth, last_error, updated_at FROM networks ORDER BY chain_id`
			return json({ items: rows, serverTime: new Date(), freshnessThresholdMs })
		}
		if (url.pathname === '/api/v1/contracts') {
			const chainId = integer(url.searchParams.get('chainId'), 'chainId')
			if (chainId === undefined) throw new ApiRequestError('chainId is required')
			const rows = await sql`
				SELECT contract.*, network.explorer_base_url
				FROM contracts contract
				JOIN networks network USING (chain_id)
				WHERE contract.chain_id = ${chainId} AND contract.canonical
				ORDER BY (contract.deployment_block IS NOT NULL) DESC, contract.label, contract.address
			`
			return json({ items: rows })
		}
		if (url.pathname === '/api/v1/logs') return await listLogs(sql, url)
		if (url.pathname.startsWith('/api/v1/logs/')) return await logDetail(sql, url.pathname.slice('/api/v1/logs/'.length).split('/'))
		if (url.pathname === '/api/v1/state/catalog') return await stateCatalog(sql, url)
		if (url.pathname.startsWith('/api/v1/state/')) return await stateHistory(sql, url.pathname.slice('/api/v1/state/'.length).split('/'), url)
		if (url.pathname === '/api/v1/richlist') return await richList(sql, url)
		if (url.pathname === '/api/v1/address-identity') return await addressIdentity(sql, url)
		if (url.pathname === '/api/v1/address-transactions') return await addressTransactions(sql, url)
		if (url.pathname === '/api/v1/address-interactions') return await addressInteractions(sql, url)
		if (url.pathname === '/api/v1/actions') {
			const chainId = integer(url.searchParams.get('chainId'), 'chainId')
			const rows =
				chainId === undefined
					? await sql`SELECT a.*, t.block_number, t.transaction_index, t.from_address, t.to_address, t.status, t.value, n.id AS network_id FROM actions a JOIN transactions t ON t.chain_id = a.chain_id AND t.block_hash = a.block_hash AND t.hash = a.tx_hash JOIN networks n ON n.chain_id = a.chain_id WHERE t.canonical ORDER BY t.block_number DESC, t.transaction_index DESC LIMIT 100`
					: await sql`SELECT a.*, t.block_number, t.transaction_index, t.from_address, t.to_address, t.status, t.value, n.id AS network_id FROM actions a JOIN transactions t ON t.chain_id = a.chain_id AND t.block_hash = a.block_hash AND t.hash = a.tx_hash JOIN networks n ON n.chain_id = a.chain_id WHERE t.canonical AND a.chain_id = ${chainId} ORDER BY t.block_number DESC, t.transaction_index DESC LIMIT 100`
			return json({ items: rows })
		}
		if (url.pathname.startsWith('/api/v1/contracts/')) {
			const parts = url.pathname.slice('/api/v1/contracts/'.length).split('/')
			const [chain, address] = parts
			const chainId = routeInteger(chain)
			if (parts.length !== 2 || chainId === undefined || address === undefined || !/^0x[0-9a-fA-F]{40}$/.test(address))
				return json({ error: 'Invalid contract identifier' }, 400)
			const rows = await sql`
				SELECT contract.*, network.explorer_base_url
				FROM contracts contract
				JOIN networks network USING (chain_id)
				WHERE contract.chain_id = ${chainId} AND contract.address = ${address.toLowerCase()} AND contract.canonical
			`
			return rows.length === 0 ? json({ error: 'Contract not found' }, 404) : json(rows[0])
		}
	} catch (error) {
		if (error instanceof ApiRequestError) return json({ error: error.message }, 400)
		if (error instanceof ApiConflictError) return json({ error: error.message }, 409)
		console.error(`augurScan API request failed (${error instanceof Error ? error.name : typeof error})`)
		return json({ error: 'Internal server error' }, 500)
	}
	return undefined
}
