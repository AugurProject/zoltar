import type { SQL } from 'bun'

class ApiRequestError extends Error {}

const integer = (value: string | null, name: string): number | undefined => {
	if (value === null || value === '') return undefined
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

const listLogs = async (sql: SQL, url: URL): Promise<Response> => {
	const chainId = integer(url.searchParams.get('chainId'), 'chainId')
	const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 100
	const limit = Math.min(Math.max(requestedLimit, 1), 250)
	const cursor = parseCursor(url.searchParams.get('cursor'))
	const event = url.searchParams.get('event')?.trim() || undefined
	const address = evmAddress(url.searchParams.get('address'), 'address')
	const decoded = url.searchParams.get('decoded')
	const values: Array<string | number> = []
	const clauses = ['l.canonical = true']
	const bind = (value: string | number): string => {
		values.push(value)
		return `$${values.length}`
	}
	if (chainId !== undefined) clauses.push(`l.chain_id = ${bind(chainId)}`)
	if (event !== undefined) clauses.push(`l.event_name ILIKE ${bind(`%${event}%`)}`)
	if (address !== undefined) clauses.push(`(l.emitter_address = ${bind(address)} OR l.arguments::text ILIKE ${bind(`%${address}%`)})`)
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
		`SELECT l.*, b.timestamp AS block_timestamp, b.hash AS canonical_block_hash, c.label AS contract_label, c.kind AS contract_kind, n.id AS network_id, n.name AS network_name, n.explorer_base_url
		FROM logs l
		JOIN blocks b ON b.chain_id = l.chain_id AND b.hash = l.block_hash
		JOIN networks n ON n.chain_id = l.chain_id
		LEFT JOIN contracts c ON c.chain_id = l.chain_id AND c.address = l.emitter_address
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
	const chainId = Number(parts[0])
	const blockHash = parts[1]
	const hash = parts[2]
	const logIndex = Number(parts[3])
	if (
		!Number.isSafeInteger(chainId) ||
		blockHash === undefined ||
		!/^0x[0-9a-fA-F]{64}$/.test(blockHash) ||
		hash === undefined ||
		!/^0x[0-9a-fA-F]{64}$/.test(hash) ||
		!Number.isSafeInteger(logIndex)
	)
		return json({ error: 'Invalid log identifier' }, 400)
	const rows = await sql`
		SELECT l.*, b.timestamp AS block_timestamp, c.label AS contract_label, c.kind AS contract_kind, c.provenance AS contract_provenance,
			t.from_address, t.to_address, t.value, t.input, t.status AS transaction_status, t.gas_used, t.receipt, a.function_name, a.function_signature, a.arguments AS action_arguments, a.display_arguments AS action_display_arguments, a.argument_schema AS action_argument_schema, a.summary AS action_summary,
			n.id AS network_id, n.explorer_base_url
		FROM logs l
		JOIN blocks b ON b.chain_id = l.chain_id AND b.hash = l.block_hash
		JOIN transactions t ON t.chain_id = l.chain_id AND t.block_hash = l.block_hash AND t.hash = l.tx_hash
		LEFT JOIN actions a ON a.chain_id = l.chain_id AND a.block_hash = l.block_hash AND a.tx_hash = l.tx_hash
		LEFT JOIN contracts c ON c.chain_id = l.chain_id AND c.address = l.emitter_address
		JOIN networks n ON n.chain_id = l.chain_id
		WHERE l.chain_id = ${chainId} AND l.block_hash = ${blockHash.toLowerCase()} AND l.tx_hash = ${hash.toLowerCase()} AND l.log_index = ${logIndex}
	`
	if (rows.length === 0) return json({ error: 'Log not found' }, 404)
	const related =
		await sql`SELECT log_index, emitter_address, event_name, summary FROM logs WHERE chain_id = ${chainId} AND block_hash = ${blockHash.toLowerCase()} AND tx_hash = ${hash.toLowerCase()} ORDER BY log_index`
	return json({ ...rows[0], relatedLogs: related })
}

const stateCatalog = async (sql: SQL, url: URL): Promise<Response> => {
	const chainId = integer(url.searchParams.get('chainId'), 'chainId')
	const questions =
		chainId === undefined
			? await sql`SELECT q.*, n.id AS network_id,
				(SELECT count(*) FROM pools p WHERE p.chain_id = q.chain_id AND p.question_id = q.question_id AND p.canonical) AS pool_count,
				(SELECT count(*) FROM universe_events u WHERE u.chain_id = q.chain_id AND u.fork_question_id = q.question_id AND u.event_name = 'UniverseForked' AND u.canonical) AS fork_count
				FROM questions q JOIN networks n USING (chain_id) WHERE q.canonical ORDER BY q.created_timestamp DESC`
			: await sql`SELECT q.*, n.id AS network_id,
				(SELECT count(*) FROM pools p WHERE p.chain_id = q.chain_id AND p.question_id = q.question_id AND p.canonical) AS pool_count,
				(SELECT count(*) FROM universe_events u WHERE u.chain_id = q.chain_id AND u.fork_question_id = q.question_id AND u.event_name = 'UniverseForked' AND u.canonical) AS fork_count
				FROM questions q JOIN networks n USING (chain_id) WHERE q.canonical AND q.chain_id = ${chainId} ORDER BY q.created_timestamp DESC`
	const pools =
		chainId === undefined
			? await sql`SELECT p.*, n.id AS network_id, q.title AS question_title,
				ps.settlement_collateral_atto_eth, ps.total_coverage_commitment_atto_eth, ps.fee_eligible_coverage_commitment_atto_eth, ps.total_claimable_vault_fees_atto_eth, ps.unallocated_accrued_fees_atto_eth, ps.current_retention_rate, ps.block_number AS snapshot_block,
				(SELECT count(DISTINCT v.vault_address) FROM vault_snapshots v WHERE v.chain_id = p.chain_id AND v.pool_address = p.pool_address AND v.canonical) AS vault_count,
				(SELECT count(*) FROM pools child WHERE child.chain_id = p.chain_id AND child.parent_address = p.pool_address AND child.canonical) AS child_count
				FROM pools p JOIN networks n USING (chain_id)
				LEFT JOIN questions q ON q.chain_id = p.chain_id AND q.question_id = p.question_id AND q.canonical
				LEFT JOIN LATERAL (SELECT * FROM pool_snapshots snapshot WHERE snapshot.chain_id = p.chain_id AND snapshot.pool_address = p.pool_address AND snapshot.canonical ORDER BY snapshot.block_number DESC, snapshot.log_index DESC LIMIT 1) ps ON true
				WHERE p.canonical ORDER BY p.block_number DESC`
			: await sql`SELECT p.*, n.id AS network_id, q.title AS question_title,
				ps.settlement_collateral_atto_eth, ps.total_coverage_commitment_atto_eth, ps.fee_eligible_coverage_commitment_atto_eth, ps.total_claimable_vault_fees_atto_eth, ps.unallocated_accrued_fees_atto_eth, ps.current_retention_rate, ps.block_number AS snapshot_block,
				(SELECT count(DISTINCT v.vault_address) FROM vault_snapshots v WHERE v.chain_id = p.chain_id AND v.pool_address = p.pool_address AND v.canonical) AS vault_count,
				(SELECT count(*) FROM pools child WHERE child.chain_id = p.chain_id AND child.parent_address = p.pool_address AND child.canonical) AS child_count
				FROM pools p JOIN networks n USING (chain_id)
				LEFT JOIN questions q ON q.chain_id = p.chain_id AND q.question_id = p.question_id AND q.canonical
				LEFT JOIN LATERAL (SELECT * FROM pool_snapshots snapshot WHERE snapshot.chain_id = p.chain_id AND snapshot.pool_address = p.pool_address AND snapshot.canonical ORDER BY snapshot.block_number DESC, snapshot.log_index DESC LIMIT 1) ps ON true
				WHERE p.canonical AND p.chain_id = ${chainId} ORDER BY p.block_number DESC`
	const vaults =
		chainId === undefined
			? await sql`SELECT DISTINCT ON (v.chain_id, v.pool_address, v.vault_address) v.*, n.id AS network_id, q.title AS question_title
				FROM vault_snapshots v JOIN networks n USING (chain_id) LEFT JOIN pools p ON p.chain_id = v.chain_id AND p.pool_address = v.pool_address AND p.canonical LEFT JOIN questions q ON q.chain_id = p.chain_id AND q.question_id = p.question_id AND q.canonical
				WHERE v.canonical ORDER BY v.chain_id, v.pool_address, v.vault_address, v.block_number DESC, v.log_index DESC`
			: await sql`SELECT DISTINCT ON (v.chain_id, v.pool_address, v.vault_address) v.*, n.id AS network_id, q.title AS question_title
				FROM vault_snapshots v JOIN networks n USING (chain_id) LEFT JOIN pools p ON p.chain_id = v.chain_id AND p.pool_address = v.pool_address AND p.canonical LEFT JOIN questions q ON q.chain_id = p.chain_id AND q.question_id = p.question_id AND q.canonical
				WHERE v.canonical AND v.chain_id = ${chainId} ORDER BY v.chain_id, v.pool_address, v.vault_address, v.block_number DESC, v.log_index DESC`
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
				FROM identity i JOIN networks n USING (chain_id) LEFT JOIN latest_supply s USING (chain_id, universe_id) LEFT JOIN fork f USING (chain_id, universe_id) ORDER BY i.chain_id, i.block_number`
			: await sql`WITH identity AS (
				SELECT DISTINCT ON (chain_id, universe_id) * FROM universe_events WHERE canonical AND event_name IN ('UniverseInitialized', 'DeployChild') AND chain_id = ${chainId} ORDER BY chain_id, universe_id, block_number, log_index
			), latest_supply AS (
				SELECT DISTINCT ON (chain_id, universe_id) chain_id, universe_id, theoretical_supply_atto_rep, block_number AS supply_block FROM universe_events WHERE canonical AND theoretical_supply_atto_rep IS NOT NULL AND chain_id = ${chainId} ORDER BY chain_id, universe_id, block_number DESC, log_index DESC
			), fork AS (
				SELECT DISTINCT ON (chain_id, universe_id) chain_id, universe_id, fork_question_id, fork_time, forker_address, fork_threshold_atto_rep, migration_rep_balance_atto_rep FROM universe_events WHERE canonical AND event_name = 'UniverseForked' AND chain_id = ${chainId} ORDER BY chain_id, universe_id, block_number DESC, log_index DESC
			) SELECT i.*, n.id AS network_id, s.theoretical_supply_atto_rep, s.supply_block, f.fork_question_id AS active_fork_question_id, f.fork_time AS active_fork_time, f.forker_address, f.fork_threshold_atto_rep, f.migration_rep_balance_atto_rep,
				(SELECT count(*) FROM identity child WHERE child.chain_id = i.chain_id AND child.parent_universe_id = i.universe_id AND child.universe_id <> i.universe_id) AS child_count,
				(SELECT count(*) FROM pools p WHERE p.chain_id = i.chain_id AND p.universe_id = i.universe_id AND p.canonical) AS pool_count
				FROM identity i JOIN networks n USING (chain_id) LEFT JOIN latest_supply s USING (chain_id, universe_id) LEFT JOIN fork f USING (chain_id, universe_id) ORDER BY i.chain_id, i.block_number`
	const poolStates =
		chainId === undefined
			? await sql`SELECT DISTINCT ON (chain_id, pool_address, event_name) chain_id, pool_address, event_name, state, block_number, log_index FROM pool_state_events WHERE canonical ORDER BY chain_id, pool_address, event_name, block_number DESC, log_index DESC`
			: await sql`SELECT DISTINCT ON (chain_id, pool_address, event_name) chain_id, pool_address, event_name, state, block_number, log_index FROM pool_state_events WHERE canonical AND chain_id = ${chainId} ORDER BY chain_id, pool_address, event_name, block_number DESC, log_index DESC`
	return json({ questions, pools, vaults, universes, poolStates })
}

const stateHistory = async (sql: SQL, parts: readonly string[]): Promise<Response> => {
	const type = parts[0]
	const chainId = Number(parts[1])
	if (!Number.isSafeInteger(chainId) || chainId < 0) return json({ error: 'Invalid state identifier' }, 400)
	if (type === 'pools') {
		const address = parts[2]?.toLowerCase()
		if (address === undefined || !/^0x[0-9a-f]{40}$/.test(address)) return json({ error: 'Invalid pool address' }, 400)
		const [snapshots, events] = await Promise.all([
			sql`SELECT s.*, b.timestamp FROM pool_snapshots s JOIN blocks b ON b.chain_id = s.chain_id AND b.hash = s.block_hash WHERE s.chain_id = ${chainId} AND s.pool_address = ${address} AND s.canonical ORDER BY s.block_number, s.log_index`,
			sql`SELECT e.*, b.timestamp FROM pool_state_events e JOIN blocks b ON b.chain_id = e.chain_id AND b.hash = e.block_hash WHERE e.chain_id = ${chainId} AND e.pool_address = ${address} AND e.canonical ORDER BY e.block_number, e.log_index`,
		])
		return json({ snapshots, events })
	}
	if (type === 'vaults') {
		const pool = parts[2]?.toLowerCase()
		const vault = parts[3]?.toLowerCase()
		if (pool === undefined || vault === undefined || !/^0x[0-9a-f]{40}$/.test(pool) || !/^0x[0-9a-f]{40}$/.test(vault))
			return json({ error: 'Invalid vault identifier' }, 400)
		const snapshots =
			await sql`SELECT v.*, b.timestamp FROM vault_snapshots v JOIN blocks b ON b.chain_id = v.chain_id AND b.hash = v.block_hash WHERE v.chain_id = ${chainId} AND v.pool_address = ${pool} AND v.vault_address = ${vault} AND v.canonical ORDER BY v.block_number, v.log_index`
		return json({ snapshots })
	}
	if (type === 'universes') {
		const universeId = parts[2]
		if (universeId === undefined || !/^\d+$/.test(universeId)) return json({ error: 'Invalid universe identifier' }, 400)
		const events =
			await sql`SELECT u.*, b.timestamp FROM universe_events u JOIN blocks b ON b.chain_id = u.chain_id AND b.hash = u.block_hash WHERE u.chain_id = ${chainId} AND u.universe_id = ${universeId} AND u.canonical ORDER BY u.block_number, u.log_index`
		return json({ events })
	}
	if (type === 'questions') {
		const questionId = parts[2]
		if (questionId === undefined || !/^\d+$/.test(questionId)) return json({ error: 'Invalid question identifier' }, 400)
		const [pools, forks] = await Promise.all([
			sql`SELECT p.pool_address, p.universe_id, p.block_number, b.timestamp FROM pools p JOIN blocks b ON b.chain_id = p.chain_id AND b.hash = p.block_hash WHERE p.chain_id = ${chainId} AND p.question_id = ${questionId} AND p.canonical ORDER BY p.block_number`,
			sql`SELECT u.universe_id, u.block_number, u.fork_time AS timestamp FROM universe_events u WHERE u.chain_id = ${chainId} AND u.fork_question_id = ${questionId} AND u.event_name = 'UniverseForked' AND u.canonical ORDER BY u.block_number`,
		])
		return json({ pools, forks })
	}
	return json({ error: 'Unknown state history type' }, 404)
}

export const handleApi = async (request: Request, sql: SQL): Promise<Response | undefined> => {
	const url = new URL(request.url)
	if (request.method !== 'GET') return json({ error: 'Read-only API' }, 405)
	try {
		if (url.pathname === '/api/v1/networks') {
			const rows =
				await sql`SELECT chain_id, id, name, explorer_base_url, start_block, indexed_block, indexed_hash, indexed_timestamp, observed_block, finalized_block, phase, last_poll_at, last_error, updated_at FROM networks ORDER BY chain_id`
			return json({ items: rows })
		}
		if (url.pathname === '/api/v1/logs') return await listLogs(sql, url)
		if (url.pathname.startsWith('/api/v1/logs/')) return await logDetail(sql, url.pathname.slice('/api/v1/logs/'.length).split('/'))
		if (url.pathname === '/api/v1/state/catalog') return await stateCatalog(sql, url)
		if (url.pathname.startsWith('/api/v1/state/')) return await stateHistory(sql, url.pathname.slice('/api/v1/state/'.length).split('/'))
		if (url.pathname === '/api/v1/actions') {
			const chainId = integer(url.searchParams.get('chainId'), 'chainId')
			const rows =
				chainId === undefined
					? await sql`SELECT a.*, t.block_number, t.transaction_index, t.from_address, t.to_address, t.status, t.value, n.id AS network_id FROM actions a JOIN transactions t ON t.chain_id = a.chain_id AND t.block_hash = a.block_hash AND t.hash = a.tx_hash JOIN networks n ON n.chain_id = a.chain_id WHERE t.canonical ORDER BY t.block_number DESC, t.transaction_index DESC LIMIT 100`
					: await sql`SELECT a.*, t.block_number, t.transaction_index, t.from_address, t.to_address, t.status, t.value, n.id AS network_id FROM actions a JOIN transactions t ON t.chain_id = a.chain_id AND t.block_hash = a.block_hash AND t.hash = a.tx_hash JOIN networks n ON n.chain_id = a.chain_id WHERE t.canonical AND a.chain_id = ${chainId} ORDER BY t.block_number DESC, t.transaction_index DESC LIMIT 100`
			return json({ items: rows })
		}
		if (url.pathname.startsWith('/api/v1/contracts/')) {
			const [chain, address] = url.pathname.slice('/api/v1/contracts/'.length).split('/')
			const chainId = integer(chain ?? null, 'chainId')
			if (chainId === undefined || address === undefined || !/^0x[0-9a-fA-F]{40}$/.test(address)) return json({ error: 'Invalid contract identifier' }, 400)
			const rows = await sql`SELECT * FROM contracts WHERE chain_id = ${chainId} AND address = ${address.toLowerCase()}`
			return rows.length === 0 ? json({ error: 'Contract not found' }, 404) : json(rows[0])
		}
	} catch (error) {
		if (error instanceof ApiRequestError) return json({ error: error.message }, 400)
		console.error(`augurScan API request failed (${error instanceof Error ? error.name : typeof error})`)
		return json({ error: 'Internal server error' }, 500)
	}
	return undefined
}
