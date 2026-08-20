import type { SQL } from 'bun'
import {
	auctionDemandCurve,
	auctionLifecycle,
	candlestickBuckets,
	ESCALATION_OUTCOME,
	ETH_QUOTE_DECIMALS,
	fixedWindowTwap,
	poolCapacity,
	reportLifecycle,
	swapAnalytics,
	USDC_QUOTE_DECIMALS,
	vaultRisk,
} from './operations.ts'

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

const jsonRecord = (value: unknown): Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {}

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

const operationsAsOf = async (sql: SQL, chainId: number): Promise<Record<string, unknown>> => {
	const rows = await sql`
		SELECT indexed_block::text AS "blockNumber", indexed_hash AS "blockHash",
			EXTRACT(EPOCH FROM indexed_timestamp)::bigint::text AS "blockTimestamp",
			observed_block::text AS "observedHead",
			GREATEST(COALESCE(observed_block, indexed_block, 0) - COALESCE(indexed_block, observed_block, 0), 0)::text AS "lagBlocks",
			phase, last_success_at AS "lastSuccessfulRefresh"
		FROM networks WHERE chain_id = ${chainId}
	`
	const row = rows[0]
	if (row === undefined) throw new ApiRequestError('chainId is not configured')
	return {
		...row,
		blockNumber: row['blockNumber'] ?? '0',
		blockHash: row['blockHash'] ?? `0x${'0'.repeat(64)}`,
		blockTimestamp: row['blockTimestamp'] ?? '0',
		observedHead: row['observedHead'] ?? '0',
		availability: row['blockNumber'] === null || row['blockNumber'] === undefined ? 'Awaiting indexed evidence' : 'available',
	}
}

const reportCatalogData = async (
	sql: SQL,
	chainId: number,
	asOf: Record<string, unknown>,
	cursorBlock = String(asOf['blockNumber']),
	cursorTx = `0x${'f'.repeat(64)}`,
	cursorLog = 2_147_483_647,
	queryLimit = 250,
) => {
	const rows = await sql`
		WITH identities AS (
			SELECT DISTINCT open_oracle_address, report_id FROM open_oracle_report_events WHERE chain_id = ${chainId} AND canonical
		)
		SELECT identity.open_oracle_address, identity.report_id::text AS report_id,
			latest.event_name, latest.block_number::text AS block_number, latest.block_hash, latest.tx_hash, latest.log_index,
			round.report_data, round.round_number::text AS round_number,
			(SELECT count(*) FROM open_oracle_report_events evidence WHERE evidence.chain_id = ${chainId}
				AND evidence.open_oracle_address = identity.open_oracle_address AND evidence.report_id = identity.report_id
				AND evidence.canonical AND evidence.event_name IN ('ReportSubmitted', 'ReportDisputed'))::integer AS observed_rounds,
			block.timestamp AS block_timestamp
		FROM identities identity
		JOIN LATERAL (
			SELECT * FROM open_oracle_report_events evidence WHERE evidence.chain_id = ${chainId}
				AND evidence.open_oracle_address = identity.open_oracle_address AND evidence.report_id = identity.report_id AND evidence.canonical
			ORDER BY evidence.block_number DESC, evidence.tx_hash DESC, evidence.log_index DESC LIMIT 1
		) latest ON true
		LEFT JOIN LATERAL (
			SELECT * FROM open_oracle_report_events evidence WHERE evidence.chain_id = ${chainId}
				AND evidence.open_oracle_address = identity.open_oracle_address AND evidence.report_id = identity.report_id
				AND evidence.canonical AND evidence.event_name IN ('ReportSubmitted', 'ReportDisputed')
			ORDER BY evidence.block_number DESC, evidence.tx_hash DESC, evidence.log_index DESC LIMIT 1
		) round ON true
		JOIN blocks block ON block.chain_id = ${chainId} AND block.hash = latest.block_hash
		WHERE (latest.block_number, latest.tx_hash, latest.log_index) < (${cursorBlock}::bigint, ${cursorTx}, ${cursorLog}::integer)
		ORDER BY latest.block_number DESC, latest.tx_hash DESC, latest.log_index DESC LIMIT ${queryLimit}
	`
	const indexedBlock = String(asOf['blockNumber'] ?? '')
	const indexedTimestamp = String(asOf['blockTimestamp'] ?? '')
	return rows.map((row: Record<string, unknown>) => {
		const data = jsonRecord(row['report_data'])
		const eventName = String(row['event_name'])
		const lifecycle = reportLifecycle({
			eventName: eventName === 'ReportSettled' ? 'ReportSettled' : eventName === 'ReportDisputed' ? 'ReportDisputed' : 'ReportSubmitted',
			flags: typeof data['flags'] === 'string' ? data['flags'] : undefined,
			reportTimestamp: typeof data['reportTimestamp'] === 'string' ? data['reportTimestamp'] : undefined,
			disputeDelay: typeof data['disputeDelay'] === 'string' ? data['disputeDelay'] : undefined,
			settlementTime: typeof data['settlementTime'] === 'string' ? data['settlementTime'] : undefined,
			indexedBlock,
			indexedTimestamp,
		})
		return { ...row, report_data: data, lifecycle }
	})
}

const escalationCatalogData = async (
	sql: SQL,
	chainId: number,
	cursorBlock: string,
	cursorTx = `0x${'f'.repeat(64)}`,
	cursorLog = 2_147_483_647,
	queryLimit = 250,
) =>
	await sql`
		WITH games AS (SELECT DISTINCT game_address FROM escalation_game_events WHERE chain_id = ${chainId} AND canonical)
		SELECT game.game_address,
			latest.event_name, latest.event_data, latest.block_number::text AS block_number, latest.block_hash, latest.tx_hash, latest.log_index,
			COALESCE((SELECT sum((event_data->>'attoRepAmount')::numeric)::text FROM escalation_game_events event
				WHERE event.chain_id = ${chainId} AND event.game_address = game.game_address AND event.canonical
				AND event.event_name = 'DepositOnOutcome' AND event.event_data->>'outcome' = ${ESCALATION_OUTCOME.invalid}), '0') AS invalid_stake_atto_rep,
			COALESCE((SELECT sum((event_data->>'attoRepAmount')::numeric)::text FROM escalation_game_events event
				WHERE event.chain_id = ${chainId} AND event.game_address = game.game_address AND event.canonical
				AND event.event_name = 'DepositOnOutcome' AND event.event_data->>'outcome' = ${ESCALATION_OUTCOME.no}), '0') AS no_stake_atto_rep,
			COALESCE((SELECT sum((event_data->>'attoRepAmount')::numeric)::text FROM escalation_game_events event
				WHERE event.chain_id = ${chainId} AND event.game_address = game.game_address AND event.canonical
				AND event.event_name = 'DepositOnOutcome' AND event.event_data->>'outcome' = ${ESCALATION_OUTCOME.yes}), '0') AS yes_stake_atto_rep
		FROM games game JOIN LATERAL (
			SELECT * FROM escalation_game_events event WHERE event.chain_id = ${chainId} AND event.game_address = game.game_address AND event.canonical
			ORDER BY event.block_number DESC, event.tx_hash DESC, event.log_index DESC LIMIT 1
		) latest ON true WHERE (latest.block_number, latest.tx_hash, latest.log_index) < (${cursorBlock}::bigint, ${cursorTx}, ${cursorLog}::integer)
		ORDER BY latest.block_number DESC, latest.tx_hash DESC, latest.log_index DESC LIMIT ${queryLimit}
	`

const auctionCatalogData = async (
	sql: SQL,
	chainId: number,
	asOf: Record<string, unknown>,
	cursorBlock = String(asOf['blockNumber']),
	cursorTx = `0x${'f'.repeat(64)}`,
	cursorLog = 2_147_483_647,
	queryLimit = 250,
) => {
	const rows = await sql`
		WITH auctions AS (SELECT DISTINCT auction_address FROM truth_auction_events WHERE chain_id = ${chainId} AND canonical)
		SELECT auction.auction_address,
			started.event_data AS start_data, finalized.event_data AS final_data,
			latest.event_name, latest.block_number::text AS block_number, latest.block_hash, latest.tx_hash, latest.log_index,
			(SELECT count(*) FROM truth_auction_events event WHERE event.chain_id = ${chainId} AND event.auction_address = auction.auction_address AND event.canonical AND event.event_name = 'BidSubmitted')::integer AS bid_count,
			(SELECT count(DISTINCT event.event_data->>'bidder') FROM truth_auction_events event WHERE event.chain_id = ${chainId} AND event.auction_address = auction.auction_address AND event.canonical AND event.event_name = 'BidSubmitted')::integer AS bidder_count,
			(SELECT count(*) FROM truth_auction_events event WHERE event.chain_id = ${chainId} AND event.auction_address = auction.auction_address AND event.canonical AND event.event_name = 'BidSettled')::integer AS settlement_count
		FROM auctions auction
		JOIN LATERAL (SELECT * FROM truth_auction_events event WHERE event.chain_id = ${chainId} AND event.auction_address = auction.auction_address AND event.canonical ORDER BY event.block_number DESC, event.tx_hash DESC, event.log_index DESC LIMIT 1) latest ON true
		LEFT JOIN LATERAL (SELECT * FROM truth_auction_events event WHERE event.chain_id = ${chainId} AND event.auction_address = auction.auction_address AND event.canonical AND event.event_name = 'AuctionStarted' ORDER BY event.block_number DESC, event.tx_hash DESC, event.log_index DESC LIMIT 1) started ON true
		LEFT JOIN LATERAL (SELECT * FROM truth_auction_events event WHERE event.chain_id = ${chainId} AND event.auction_address = auction.auction_address AND event.canonical AND event.event_name = 'AuctionFinalized' ORDER BY event.block_number DESC, event.tx_hash DESC, event.log_index DESC LIMIT 1) finalized ON true
		WHERE (latest.block_number, latest.tx_hash, latest.log_index) < (${cursorBlock}::bigint, ${cursorTx}, ${cursorLog}::integer)
		ORDER BY latest.block_number DESC, latest.tx_hash DESC, latest.log_index DESC LIMIT ${queryLimit}
	`
	return rows.map((row: Record<string, unknown>) => {
		const startData = jsonRecord(row['start_data'])
		return {
			...row,
			status: auctionLifecycle({
				started: row['start_data'] !== null,
				finalized: row['final_data'] !== null,
				startTimestamp: typeof startData['startTimestamp'] === 'string' ? startData['startTimestamp'] : undefined,
				endTimestamp: typeof startData['endTimestamp'] === 'string' ? startData['endTimestamp'] : undefined,
				indexedTimestamp: String(asOf['blockTimestamp'] ?? ''),
				bidCount: Number(row['bid_count'] ?? 0),
				settlementCount: Number(row['settlement_count'] ?? 0),
			}),
		}
	})
}

const riskCatalogData = async (
	sql: SQL,
	chainId: number,
	options: { poolAddress?: string; vaultAddress?: string; poolAfter?: string; vaultAfter?: string; limit?: number } = {},
) => {
	const queryLimit = (options.limit ?? 250) + 1
	const [pools, vaults, liquidations, approvalEvents] = await Promise.all([
		sql`
			WITH identities AS (SELECT DISTINCT pool_address FROM pools WHERE chain_id = ${chainId} AND canonical)
			SELECT identity.pool_address, snapshot.block_number::text AS block_number, snapshot.block_hash,
				snapshot.block_timestamp, snapshot.read_status, snapshot.read_result, snapshot.read_failure_reason,
				snapshot.source_method, snapshot.observed_at
			FROM identities identity LEFT JOIN LATERAL (
				SELECT state.* FROM entity_state_snapshots state
				JOIN blocks block ON block.chain_id = state.chain_id AND block.hash = state.block_hash AND block.canonical
				WHERE state.chain_id = ${chainId} AND state.entity_type = 'pool'
					AND state.entity_identity = identity.pool_address AND state.canonical
				ORDER BY state.block_number DESC, state.observed_at DESC LIMIT 1
			) snapshot ON true
			WHERE (${options.poolAddress ?? null}::text IS NULL OR identity.pool_address = ${options.poolAddress ?? null})
				AND (${options.poolAfter ?? null}::text IS NULL OR identity.pool_address > ${options.poolAfter ?? null})
			ORDER BY identity.pool_address LIMIT ${queryLimit}
		`,
		sql`
			WITH identities AS (
				SELECT DISTINCT pool_address, vault_address FROM vault_snapshots WHERE chain_id = ${chainId} AND canonical
			)
			SELECT identity.pool_address, identity.vault_address,
				vault.block_number::text AS block_number, vault.block_hash, vault.block_timestamp,
				vault.read_status, vault.read_result, vault.read_failure_reason, vault.source_method, vault.observed_at,
				pool.read_result AS pool_read_result, pool.read_status AS pool_read_status,
				pool.block_number::text AS pool_block_number, pool.block_hash AS pool_block_hash,
				pool.block_timestamp AS pool_block_timestamp
			FROM identities identity
			LEFT JOIN LATERAL (
				SELECT state.* FROM entity_state_snapshots state
				JOIN blocks block ON block.chain_id = state.chain_id AND block.hash = state.block_hash AND block.canonical
				WHERE state.chain_id = ${chainId} AND state.entity_type = 'vault'
					AND state.entity_identity = identity.pool_address || ':' || identity.vault_address AND state.canonical
				ORDER BY state.block_number DESC, state.observed_at DESC LIMIT 1
			) vault ON true
			LEFT JOIN LATERAL (
				SELECT state.* FROM entity_state_snapshots state
				JOIN blocks block ON block.chain_id = state.chain_id AND block.hash = state.block_hash AND block.canonical
				WHERE state.chain_id = ${chainId} AND state.entity_type = 'pool'
					AND state.entity_identity = identity.pool_address AND state.canonical
				ORDER BY state.block_number DESC, state.observed_at DESC LIMIT 1
			) pool ON true
			WHERE (${options.poolAddress ?? null}::text IS NULL OR identity.pool_address = ${options.poolAddress ?? null})
				AND (${options.vaultAddress ?? null}::text IS NULL OR identity.vault_address = ${options.vaultAddress ?? null})
				AND (${options.vaultAfter ?? null}::text IS NULL OR identity.pool_address || ':' || identity.vault_address > ${options.vaultAfter ?? null})
			ORDER BY identity.pool_address, identity.vault_address LIMIT ${queryLimit}
		`,
		sql`SELECT * FROM protocol_timeline_entries WHERE chain_id = ${chainId} AND canonical AND semantic_event_kind = 'VaultLiquidated' ORDER BY block_number DESC, log_index DESC LIMIT 25`,
		sql`
			SELECT approval.*, COALESCE(approval.receiver_vault, installed.receiver_vault) AS receiver_vault,
				block.timestamp AS block_timestamp
			FROM liquidation_approval_events approval
			JOIN blocks block ON block.chain_id = approval.chain_id AND block.hash = approval.block_hash AND block.canonical
			LEFT JOIN LATERAL (
				SELECT candidate.receiver_vault, candidate.event_data FROM liquidation_approval_events candidate
				WHERE candidate.chain_id = approval.chain_id AND candidate.approval_identity = approval.approval_identity
					AND candidate.event_name = 'LiquidationApprovalSet' AND candidate.canonical
				ORDER BY candidate.block_number DESC, candidate.transaction_index DESC, candidate.log_index DESC LIMIT 1
			) installed ON true
			WHERE approval.chain_id = ${chainId} AND approval.canonical
				AND (${options.poolAddress ?? null}::text IS NULL OR COALESCE(approval.event_data->>'securityPool', installed.event_data->>'securityPool') = ${options.poolAddress ?? null})
				AND (${options.vaultAddress ?? null}::text IS NULL OR COALESCE(approval.receiver_vault, installed.receiver_vault) = ${options.vaultAddress ?? null}
					OR COALESCE(approval.event_data->>'targetVault', installed.event_data->>'targetVault') = ${options.vaultAddress ?? null})
			ORDER BY approval.block_number DESC, approval.transaction_index DESC, approval.log_index DESC LIMIT 100
		`,
	])
	const poolData = pools.slice(0, options.limit ?? 250).map((row: Record<string, unknown>) => {
		const state = jsonRecord(row['read_result'])
		if (row['read_status'] !== 'success')
			return {
				...row,
				protocol_state: 'unavailable',
				scanner_severity: 'unavailable',
				scanner_reason: row['read_failure_reason'] ?? 'Current tagged pool read is awaiting completion',
			}
		const capacity = poolCapacity(String(state['settlementCollateralAttoEth']), String(state['currentMintingCapacityAttoEth']))
		const badDebt = BigInt(String(state['totalBadDebtAttoEth'] ?? '0'))
		const price = jsonRecord(state['price'])
		const priceRequired = BigInt(String(state['settlementCollateralAttoEth'] ?? '0')) > 0n || BigInt(String(state['currentMintingCapacityAttoEth'] ?? '0')) > 0n
		const priceValid = price['protocolValid'] === true
		return {
			...row,
			read_result: state,
			capacity,
			price_provenance: price,
			protocol_state: priceRequired && !priceValid ? 'unavailable' : badDebt > 0n ? 'bad-debt' : String(state['systemState'] ?? '0'),
			scanner_severity: priceRequired && !priceValid ? 'unavailable' : badDebt > 0n ? 'critical' : 'healthy',
			scanner_reason:
				priceRequired && !priceValid
					? 'Accounting price is invalid at the tagged evidence block; capacity is not usable for risk decisions'
					: badDebt > 0n
						? 'Pool has recorded bad debt'
						: 'Tagged pool accounting read completed',
		}
	})
	const vaultData = vaults.slice(0, options.limit ?? 250).map((row: Record<string, unknown>) => {
		const state = jsonRecord(row['read_result'])
		const poolState = jsonRecord(row['pool_read_result'])
		const price = jsonRecord(poolState['price'])
		const snapshotEvidence = {
			vaultSnapshot: { blockNumber: row['block_number'], blockHash: row['block_hash'], blockTimestamp: row['block_timestamp'] },
			poolSnapshot: { blockNumber: row['pool_block_number'], blockHash: row['pool_block_hash'], blockTimestamp: row['pool_block_timestamp'] },
		}
		if (row['read_status'] !== 'success' || row['pool_read_status'] !== 'success' || row['block_hash'] !== row['pool_block_hash'])
			return {
				...row,
				snapshot_evidence: snapshotEvidence,
				protocol_state: 'unavailable',
				scanner_severity: 'unavailable',
				scanner_reason:
					row['read_failure_reason'] ??
					(row['read_status'] === 'success' && row['pool_read_status'] === 'success'
						? 'Vault and pool tagged reads have different evidence blocks; coherent risk state is awaiting completion'
						: 'Coherent tagged vault and pool reads are awaiting completion'),
			}
		if (BigInt(String(state['openInterestAttoEth'] ?? '0')) > 0n && price['protocolValid'] !== true)
			return {
				...row,
				read_result: state,
				price_provenance: price,
				snapshot_evidence: snapshotEvidence,
				protocol_state: 'unavailable',
				scanner_severity: 'unavailable',
				scanner_reason: 'Vault health is unavailable because its nonzero open interest depends on an invalid accounting price',
			}
		const risk = vaultRisk({
			poolHeldBackingAttoRep: String(state['poolHeldBackingAttoRep']),
			disputeStakedAttoRep: String(state['disputeStakedAttoRep']),
			openInterestAttoEth: String(state['openInterestAttoEth']),
			repPerEth1e18: String(price['repPerEth1e18'] ?? '0'),
			securityMultiplierBps: String(state['securityMultiplierBps']),
			targetHealthFactorBps: String(state['targetHealthFactorBps']),
			badDebtAttoEth: String(state['badDebtAttoEth']),
		})
		return {
			...row,
			read_result: state,
			snapshot_evidence: snapshotEvidence,
			risk,
			protocol_state: risk.protocolState,
			scanner_severity: risk.scannerSeverity,
			scanner_reason: risk.scannerReason,
		}
	})
	const lastPool = poolData.at(-1)
	const lastVault = vaultData.at(-1)
	return {
		pools: poolData,
		vaults: vaultData,
		recentLiquidations: liquidations,
		approvalEvents,
		pagination: {
			poolHasMore: pools.length > (options.limit ?? 250),
			poolNextCursor: pools.length > (options.limit ?? 250) && lastPool !== undefined ? String(lastPool['pool_address']) : undefined,
			vaultHasMore: vaults.length > (options.limit ?? 250),
			vaultNextCursor:
				vaults.length > (options.limit ?? 250) && lastVault !== undefined
					? `${String(lastVault['pool_address'])}:${String(lastVault['vault_address'])}`
					: undefined,
		},
	}
}

const operationsResponse = async (sql: SQL, url: URL): Promise<Response> => {
	const chainId = integer(url.searchParams.get('chainId'), 'chainId')
	if (chainId === undefined) throw new ApiRequestError('chainId is required')
	const asOf = await operationsAsOf(sql, chainId)
	const [reports, escalations, auctions, risk, prices, recentChanges, forks] = await Promise.all([
		reportCatalogData(sql, chainId, asOf),
		escalationCatalogData(sql, chainId, String(asOf['blockNumber'])),
		auctionCatalogData(sql, chainId, asOf),
		riskCatalogData(sql, chainId),
		sql`SELECT coordinator_address AS source_contract, event_name AS source_event, rep_per_eth_1e18::text AS value, block_number::text AS block_number, settlement_timestamp AS observed_timestamp FROM rep_eth_price_snapshots WHERE chain_id = ${chainId} AND canonical ORDER BY block_number DESC, log_index DESC LIMIT 1`,
		sql`SELECT timeline.*, block.timestamp AS block_timestamp FROM protocol_timeline_entries timeline JOIN blocks block ON block.chain_id = timeline.chain_id AND block.hash = timeline.block_hash WHERE timeline.chain_id = ${chainId} AND timeline.canonical ORDER BY timeline.block_number DESC, timeline.log_index DESC LIMIT 30`,
		sql`SELECT universe_identity, event_name, event_data, block_number::text AS block_number, block_hash, tx_hash, log_index FROM fork_migration_events WHERE chain_id = ${chainId} AND canonical ORDER BY block_number DESC, log_index DESC LIMIT 100`,
	])
	return json({ chainId, asOf, data: { reports, escalations, auctions, risk, prices, recentChanges, forks } })
}

const domainCatalogResponse = async (sql: SQL, url: URL, domain: 'reports' | 'escalations' | 'auctions' | 'risk' | 'forks'): Promise<Response> => {
	const chainId = integer(url.searchParams.get('chainId'), 'chainId')
	if (chainId === undefined) throw new ApiRequestError('chainId is required')
	const asOf = await operationsAsOf(sql, chainId)
	if (domain === 'risk') {
		const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 100
		const limit = Math.min(Math.max(requestedLimit, 1), 250)
		const poolAfter = parseRiskCursor(url.searchParams.get('poolCursor'), chainId, 'pool', asOf)
		const vaultAfter = parseRiskCursor(url.searchParams.get('vaultCursor'), chainId, 'vault', asOf)
		const data = await riskCatalogData(sql, chainId, { limit, poolAfter, vaultAfter })
		const pagination = jsonRecord(data.pagination)
		return json({
			chainId,
			asOf,
			data: {
				...data,
				pagination: {
					...pagination,
					poolNextCursor: typeof pagination['poolNextCursor'] === 'string' ? riskCursorFor(chainId, 'pool', asOf, pagination['poolNextCursor']) : undefined,
					vaultNextCursor: typeof pagination['vaultNextCursor'] === 'string' ? riskCursorFor(chainId, 'vault', asOf, pagination['vaultNextCursor']) : undefined,
				},
			},
		})
	}
	const page = detailPage(url, chainId, `${domain}-catalog`, 'catalog', asOf)
	const cursorBlock = page.cursor?.[5] ?? String(asOf['blockNumber'])
	const cursorTx = page.cursor?.[6] ?? `0x${'f'.repeat(64)}`
	const cursorLog = page.cursor?.[7] ?? 2_147_483_647
	const rows =
		domain === 'reports'
			? await reportCatalogData(sql, chainId, asOf, cursorBlock, cursorTx, cursorLog, page.queryLimit)
			: domain === 'escalations'
				? await escalationCatalogData(sql, chainId, cursorBlock, cursorTx, cursorLog, page.queryLimit)
				: domain === 'auctions'
					? await auctionCatalogData(sql, chainId, asOf, cursorBlock, cursorTx, cursorLog, page.queryLimit)
					: await sql`
						SELECT universe_identity, event_name, event_data, block_number::text AS block_number,
							block_hash, tx_hash, log_index FROM fork_migration_events
						WHERE chain_id = ${chainId} AND canonical
							AND (block_number, tx_hash, log_index) < (${cursorBlock}::bigint, ${cursorTx}, ${cursorLog}::integer)
						ORDER BY block_number DESC, tx_hash DESC, log_index DESC LIMIT ${page.queryLimit}
					`
	return json({
		chainId,
		asOf,
		data: paged(rows, page.limit, (row) => protocolCursorFor(chainId, `${domain}-catalog`, 'catalog', asOf, row)),
	})
}

type ProtocolCursor = readonly [number, string, string, string, string, string, string, number]

type RiskCursor = readonly [number, 'pool' | 'vault', string, string, string]
const parseRiskCursor = (value: string | null, chainId: number, kind: 'pool' | 'vault', asOf: Record<string, unknown>): string | undefined => {
	if (value === null) return undefined
	try {
		const parsed = JSON.parse(atob(value)) as unknown
		const parts = Array.isArray(parsed) ? parsed : []
		if (
			parts.length !== 5 ||
			parts[0] !== chainId ||
			parts[1] !== kind ||
			parts[2] !== String(asOf['blockNumber']) ||
			parts[3] !== String(asOf['blockHash']) ||
			typeof parts[4] !== 'string' ||
			(kind === 'pool' ? !/^0x[0-9a-f]{40}$/.test(parts[4]) : !/^0x[0-9a-f]{40}:0x[0-9a-f]{40}$/.test(parts[4]))
		)
			throw new Error('shape')
		return parts[4]
	} catch (error) {
		throw new ApiRequestError(`${kind}Cursor is invalid`, { cause: error })
	}
}

const riskCursorFor = (chainId: number, kind: 'pool' | 'vault', asOf: Record<string, unknown>, key: string): string =>
	btoa(JSON.stringify([chainId, kind, String(asOf['blockNumber']), String(asOf['blockHash']), key] satisfies RiskCursor))

const parseProtocolCursor = (value: string | null): ProtocolCursor | undefined => {
	if (value === null) return undefined
	try {
		const parsed = JSON.parse(atob(value)) as unknown
		const parts = Array.isArray(parsed) ? parsed : []
		if (
			parts.length !== 8 ||
			!isNonNegativeSafeInteger(parts[0]) ||
			typeof parts[1] !== 'string' ||
			typeof parts[2] !== 'string' ||
			!isPostgresBigint(parts[3]) ||
			typeof parts[4] !== 'string' ||
			!/^0x[0-9a-f]{64}$/.test(parts[4]) ||
			!isPostgresBigint(parts[5]) ||
			typeof parts[6] !== 'string' ||
			!/^0x[0-9a-f]{64}$/.test(parts[6]) ||
			!isPostgresInteger(parts[7]) ||
			BigInt(parts[5]) > BigInt(parts[3])
		)
			throw new Error('shape')
		return parts as [number, string, string, string, string, string, string, number]
	} catch (error) {
		throw new ApiRequestError('cursor is invalid', { cause: error })
	}
}

const protocolCursorFor = (chainId: number, domain: string, identity: string, asOf: Record<string, unknown>, row: Record<string, unknown>): string =>
	btoa(
		JSON.stringify([
			chainId,
			domain,
			identity,
			String(asOf['blockNumber']),
			String(asOf['blockHash']),
			String(row['block_number']),
			String(row['tx_hash']),
			Number(row['log_index']),
		]),
	)

const detailPage = (url: URL, chainId: number, domain: string, identity: string, asOf: Record<string, unknown>) => {
	const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 100
	const limit = Math.min(Math.max(requestedLimit, 1), 250)
	const cursor = parseProtocolCursor(url.searchParams.get('cursor'))
	if (cursor !== undefined) {
		if (cursor[0] !== chainId || cursor[1] !== domain || cursor[2] !== identity) throw new ApiRequestError('cursor does not match the requested entity')
		if (cursor[3] !== String(asOf['blockNumber']) || cursor[4] !== String(asOf['blockHash']))
			throw new ApiConflictError('Indexed state changed; restart pagination')
	}
	return { limit, queryLimit: limit + 1, cursor }
}

const snapshotFor = async (sql: SQL, chainId: number, entityType: string, entityIdentity: string) => {
	const rows = await sql`
		SELECT snapshot.* FROM entity_state_snapshots snapshot
		JOIN blocks block ON block.chain_id = snapshot.chain_id AND block.hash = snapshot.block_hash AND block.canonical
		WHERE snapshot.chain_id = ${chainId} AND snapshot.entity_type = ${entityType}
			AND snapshot.entity_identity = ${entityIdentity} AND snapshot.canonical
		ORDER BY snapshot.block_number DESC, snapshot.observed_at DESC LIMIT 1
	`
	return rows[0]
}

const paged = (rows: readonly Record<string, unknown>[], limit: number, cursor: (row: Record<string, unknown>) => string) => {
	const hasMore = rows.length > limit
	const items = rows.slice(0, limit)
	return { items, limit, hasMore, nextCursor: hasMore && items.length > 0 ? cursor(items[items.length - 1] as Record<string, unknown>) : undefined }
}

const reportDetailResponse = async (sql: SQL, parts: readonly string[], url: URL): Promise<Response> => {
	const chainId = routeInteger(parts[0])
	const openOracleAddress = parts[1]?.toLowerCase()
	const reportId = parts[2]
	if (
		parts.length !== 3 ||
		chainId === undefined ||
		openOracleAddress === undefined ||
		!/^0x[0-9a-f]{40}$/.test(openOracleAddress) ||
		reportId === undefined ||
		!/^\d+$/.test(reportId)
	)
		return json({ error: 'Invalid report identifier' }, 400)
	const identity = `${openOracleAddress}:${reportId}`
	const asOf = await operationsAsOf(sql, chainId)
	const page = detailPage(url, chainId, 'report', identity, asOf)
	const cursorBlock = page.cursor?.[5] ?? String(asOf['blockNumber'])
	const cursorTx = page.cursor?.[6] ?? `0x${'f'.repeat(64)}`
	const cursorLog = page.cursor?.[7] ?? 2_147_483_647
	const rows = await sql`
		SELECT event.*, block.timestamp AS block_timestamp FROM open_oracle_report_events event
		JOIN blocks block ON block.chain_id = event.chain_id AND block.hash = event.block_hash
		WHERE event.chain_id = ${chainId} AND event.open_oracle_address = ${openOracleAddress}
			AND event.report_id = ${reportId} AND event.canonical
			AND (event.block_number, event.tx_hash, event.log_index) < (${cursorBlock}::bigint, ${cursorTx}, ${cursorLog}::integer)
		ORDER BY event.block_number DESC, event.tx_hash DESC, event.log_index DESC LIMIT ${page.queryLimit}
	`
	if (rows.length === 0 && page.cursor === undefined) return json({ error: 'Report not found' }, 404)
	const currentRows = await sql`
		SELECT event.*, block.timestamp AS block_timestamp FROM open_oracle_report_events event
		JOIN blocks block ON block.chain_id = event.chain_id AND block.hash = event.block_hash
		WHERE event.chain_id = ${chainId} AND event.open_oracle_address = ${openOracleAddress}
			AND event.report_id = ${reportId} AND event.canonical
		ORDER BY event.block_number DESC, event.log_index DESC LIMIT 1
	`
	const current = currentRows[0]
	const currentData = jsonRecord(current?.['report_data'])
	const lifecycle =
		current === undefined
			? undefined
			: reportLifecycle({
					eventName:
						current['event_name'] === 'ReportSettled' ? 'ReportSettled' : current['event_name'] === 'ReportDisputed' ? 'ReportDisputed' : 'ReportSubmitted',
					flags: typeof currentData['flags'] === 'string' ? currentData['flags'] : undefined,
					reportTimestamp: typeof currentData['reportTimestamp'] === 'string' ? currentData['reportTimestamp'] : undefined,
					disputeDelay: typeof currentData['disputeDelay'] === 'string' ? currentData['disputeDelay'] : undefined,
					settlementTime: typeof currentData['settlementTime'] === 'string' ? currentData['settlementTime'] : undefined,
					indexedBlock: String(asOf['blockNumber']),
					indexedTimestamp: String(asOf['blockTimestamp']),
				})
	return json({
		chainId,
		asOf,
		data: {
			identity: { openOracleAddress, reportId },
			current: current === undefined ? undefined : { ...current, report_data: currentData, lifecycle },
			rounds: paged(rows, page.limit, (row) => protocolCursorFor(chainId, 'report', identity, asOf, row)),
		},
	})
}

const eventEntityDetailResponse = async (sql: SQL, parts: readonly string[], url: URL, domain: 'auction' | 'escalation'): Promise<Response> => {
	const chainId = routeInteger(parts[0])
	const address = parts[1]?.toLowerCase()
	if (parts.length !== 2 || chainId === undefined || address === undefined || !/^0x[0-9a-f]{40}$/.test(address))
		return json({ error: `Invalid ${domain} identifier` }, 400)
	const asOf = await operationsAsOf(sql, chainId)
	const page = detailPage(url, chainId, domain, address, asOf)
	const cursorBlock = page.cursor?.[5] ?? String(asOf['blockNumber'])
	const cursorTx = page.cursor?.[6] ?? `0x${'f'.repeat(64)}`
	const cursorLog = page.cursor?.[7] ?? 2_147_483_647
	const rows: readonly Record<string, unknown>[] =
		domain === 'auction'
			? await sql`SELECT event.*, block.timestamp AS block_timestamp FROM truth_auction_events event JOIN blocks block ON block.chain_id = event.chain_id AND block.hash = event.block_hash WHERE event.chain_id = ${chainId} AND event.auction_address = ${address} AND event.canonical AND (event.block_number, event.tx_hash, event.log_index) < (${cursorBlock}::bigint, ${cursorTx}, ${cursorLog}::integer) ORDER BY event.block_number DESC, event.tx_hash DESC, event.log_index DESC LIMIT ${page.queryLimit}`
			: await sql`SELECT event.*, block.timestamp AS block_timestamp FROM escalation_game_events event JOIN blocks block ON block.chain_id = event.chain_id AND block.hash = event.block_hash WHERE event.chain_id = ${chainId} AND event.game_address = ${address} AND event.canonical AND (event.block_number, event.tx_hash, event.log_index) < (${cursorBlock}::bigint, ${cursorTx}, ${cursorLog}::integer) ORDER BY event.block_number DESC, event.tx_hash DESC, event.log_index DESC LIMIT ${page.queryLimit}`
	if (rows.length === 0 && page.cursor === undefined) return json({ error: `${domain === 'auction' ? 'Auction' : 'Escalation game'} not found` }, 404)
	const snapshot = await snapshotFor(sql, chainId, domain, address)
	const result: Record<string, unknown> = {
		identity: address,
		snapshot,
		events: paged(rows, page.limit, (row) => protocolCursorFor(chainId, domain, address, asOf, row)),
	}
	if (domain === 'auction') {
		const [bids, finalizations] = await Promise.all([
			sql`
			SELECT event_data->>'tick' AS tick, sum((event_data->>'bidAmountAttoEth')::numeric)::text AS amount_atto_eth
			FROM truth_auction_events WHERE chain_id = ${chainId} AND auction_address = ${address}
				AND canonical AND event_name = 'BidSubmitted'
			GROUP BY event_data->>'tick' ORDER BY (event_data->>'tick')::numeric DESC LIMIT 1001
			`,
			sql`SELECT * FROM truth_auction_events WHERE chain_id = ${chainId} AND auction_address = ${address}
				AND canonical AND event_name = 'AuctionFinalized' ORDER BY block_number DESC, log_index DESC LIMIT 1`,
		])
		result['demandCurve'] = auctionDemandCurve(
			bids.slice(0, 1000).map((row: Record<string, unknown>) => ({ tick: String(row['tick']), amountAttoEth: String(row['amount_atto_eth']) })),
		)
		result['demandCurveTruncated'] = bids.length > 1000
		result['finalization'] = finalizations[0]
	} else {
		result['deposits'] = rows.filter((row) => row['event_name'] === 'DepositOnOutcome' || row['event_name'] === 'LocalDepositAppended')
		result['claims'] = rows.filter((row) => String(row['event_name']).includes('Claim'))
	}
	return json({ chainId, asOf, data: result })
}

const forkDetailResponse = async (sql: SQL, parts: readonly string[], url: URL): Promise<Response> => {
	const chainId = routeInteger(parts[0])
	const identity = parts[1] === undefined ? undefined : decodeURIComponent(parts[1]).toLowerCase()
	if (parts.length !== 2 || chainId === undefined || identity === undefined || identity.length === 0 || identity.length > 128)
		return json({ error: 'Invalid fork identifier' }, 400)
	const asOf = await operationsAsOf(sql, chainId)
	const page = detailPage(url, chainId, 'fork', identity, asOf)
	const cursorBlock = page.cursor?.[5] ?? String(asOf['blockNumber'])
	const cursorTx = page.cursor?.[6] ?? `0x${'f'.repeat(64)}`
	const cursorLog = page.cursor?.[7] ?? 2_147_483_647
	const rows = await sql`
		SELECT event.*, block.timestamp AS block_timestamp FROM fork_migration_events event
		JOIN blocks block ON block.chain_id = event.chain_id AND block.hash = event.block_hash
		WHERE event.chain_id = ${chainId} AND event.canonical
			AND (event.universe_identity = ${identity} OR event.event_data->>'universeId' = ${identity}
				OR event.event_data->>'childUniverseId' = ${identity})
			AND (event.block_number, event.tx_hash, event.log_index) < (${cursorBlock}::bigint, ${cursorTx}, ${cursorLog}::integer)
		ORDER BY event.block_number DESC, event.tx_hash DESC, event.log_index DESC LIMIT ${page.queryLimit}
	`
	if (rows.length === 0 && page.cursor === undefined) return json({ error: 'Fork not found' }, 404)
	const branches = await sql`
		SELECT event_data->>'childUniverseId' AS child_universe_id,
			max(event_data->>'outcomeIndex') AS outcome_index,
			COALESCE(sum((event_data->>'amountAttoRep')::numeric) FILTER (WHERE event_name = 'MigrationRepSplit'), 0)::text AS migrated_atto_rep,
			count(DISTINCT event_data->>'migrator') FILTER (WHERE event_data ? 'migrator')::integer AS migrator_count,
			count(*) FILTER (WHERE event_name = 'MigrationRepSplit')::integer AS migration_count
		FROM fork_migration_events WHERE chain_id = ${chainId} AND canonical
			AND (universe_identity = ${identity} OR event_data->>'universeId' = ${identity})
			AND event_data ? 'childUniverseId'
		GROUP BY event_data->>'childUniverseId' ORDER BY event_data->>'childUniverseId'
	`
	return json({
		chainId,
		asOf,
		data: { identity, branches, events: paged(rows, page.limit, (row) => protocolCursorFor(chainId, 'fork', identity, asOf, row)) },
	})
}

const tradingDetailResponse = async (sql: SQL, parts: readonly string[], url: URL): Promise<Response> => {
	const chainId = routeInteger(parts[0])
	const market = parts[1]?.toLowerCase()
	if (parts.length !== 2 || chainId === undefined || market === undefined || !/^0x[0-9a-f]{40}$/.test(market))
		return json({ error: 'Invalid AMM identifier' }, 400)
	const asOf = await operationsAsOf(sql, chainId)
	const page = detailPage(url, chainId, 'trading', market, asOf)
	const cursorBlock = page.cursor?.[5] ?? String(asOf['blockNumber'])
	const cursorTx = page.cursor?.[6] ?? `0x${'f'.repeat(64)}`
	const cursorLog = page.cursor?.[7] ?? 2_147_483_647
	const rows = await sql`
		SELECT event.*, block.timestamp AS block_timestamp,
			EXTRACT(EPOCH FROM block.timestamp)::bigint::text AS timestamp_seconds
		FROM amm_trade_events event JOIN blocks block ON block.chain_id = event.chain_id AND block.hash = event.block_hash
		WHERE event.chain_id = ${chainId} AND event.market_address = ${market} AND event.canonical
			AND (event.event_name <> 'Swap' OR (event.event_data ? 'yesForNo' AND event.event_data ? 'amountIn'
				AND event.event_data ? 'amountOut' AND event.event_data ? 'resultingYesReserve' AND event.event_data ? 'resultingNoReserve'))
			AND (event.block_number, event.tx_hash, event.log_index) < (${cursorBlock}::bigint, ${cursorTx}, ${cursorLog}::integer)
		ORDER BY event.block_number DESC, event.tx_hash DESC, event.log_index DESC LIMIT ${page.queryLimit}
	`
	if (rows.length === 0 && page.cursor === undefined) return json({ error: 'AMM not found' }, 404)
	const eventRows = rows.map((row: Record<string, unknown>) => {
		const eventData = jsonRecord(row['event_data'])
		if (row['event_name'] !== 'Swap') return { ...row, event_data: eventData }
		return {
			...row,
			event_data: eventData,
			analytics: swapAnalytics({
				yesForNo: eventData['yesForNo'] === true,
				amountIn: String(eventData['amountIn']),
				amountOut: String(eventData['amountOut']),
				feeAmount: String(eventData['feeAmount']),
				resultingYesReserve: String(eventData['resultingYesReserve']),
				resultingNoReserve: String(eventData['resultingNoReserve']),
			}),
		}
	})
	const observations = await sql`
		WITH window_observations AS (
			SELECT EXTRACT(EPOCH FROM block.timestamp)::bigint::text AS timestamp_seconds,
				event.event_data->>'resultingNoReserve' AS numerator, event.event_data->>'resultingYesReserve' AS denominator,
				event.block_number, event.tx_hash, event.log_index
			FROM amm_trade_events event JOIN blocks block ON block.chain_id = event.chain_id AND block.hash = event.block_hash
			WHERE event.chain_id = ${chainId} AND event.market_address = ${market} AND event.canonical
				AND event.event_name = 'Swap' AND event.event_data ? 'resultingNoReserve' AND event.event_data ? 'resultingYesReserve'
				AND block.timestamp >= to_timestamp(${String(asOf['blockTimestamp'])}::numeric - 604800)
		), prior_observation AS (
			SELECT EXTRACT(EPOCH FROM block.timestamp)::bigint::text AS timestamp_seconds,
				event.event_data->>'resultingNoReserve' AS numerator, event.event_data->>'resultingYesReserve' AS denominator,
				event.block_number, event.tx_hash, event.log_index
			FROM amm_trade_events event JOIN blocks block ON block.chain_id = event.chain_id AND block.hash = event.block_hash
			WHERE event.chain_id = ${chainId} AND event.market_address = ${market} AND event.canonical
				AND event.event_name = 'Swap' AND event.event_data ? 'resultingNoReserve' AND event.event_data ? 'resultingYesReserve'
				AND block.timestamp < to_timestamp(${String(asOf['blockTimestamp'])}::numeric - 604800)
			ORDER BY event.block_number DESC, event.log_index DESC LIMIT 1
		)
		SELECT * FROM (
			SELECT * FROM (SELECT * FROM window_observations UNION ALL SELECT * FROM prior_observation) candidate
			ORDER BY block_number DESC, tx_hash DESC, log_index DESC LIMIT 10001
		) retained ORDER BY block_number, tx_hash, log_index
	`
	const summaries = await sql`
		SELECT
			count(*) FILTER (WHERE event.event_name = 'Swap' AND block.timestamp >= to_timestamp(${String(asOf['blockTimestamp'])}::numeric - 86400))::integer AS swaps_24h,
			count(*) FILTER (WHERE event.event_name = 'Swap' AND block.timestamp >= to_timestamp(${String(asOf['blockTimestamp'])}::numeric - 604800))::integer AS swaps_7d,
			COALESCE(sum((event.event_data->>'amountIn')::numeric) FILTER (WHERE event.event_name = 'Swap' AND block.timestamp >= to_timestamp(${String(asOf['blockTimestamp'])}::numeric - 86400)), 0)::text AS input_volume_24h,
			COALESCE(sum((event.event_data->>'amountIn')::numeric) FILTER (WHERE event.event_name = 'Swap' AND block.timestamp >= to_timestamp(${String(asOf['blockTimestamp'])}::numeric - 604800)), 0)::text AS input_volume_7d,
			COALESCE(sum((event.event_data->>'feeAmount')::numeric) FILTER (WHERE event.event_name = 'Swap' AND block.timestamp >= to_timestamp(${String(asOf['blockTimestamp'])}::numeric - 86400)), 0)::text AS fees_24h,
			COALESCE(sum((event.event_data->>'feeAmount')::numeric) FILTER (WHERE event.event_name = 'Swap' AND block.timestamp >= to_timestamp(${String(asOf['blockTimestamp'])}::numeric - 604800)), 0)::text AS fees_7d,
			count(*) FILTER (WHERE event.event_name IN ('LiquidityInitialized', 'LiquidityAdded', 'LiquidityRemoved') AND block.timestamp >= to_timestamp(${String(asOf['blockTimestamp'])}::numeric - 604800))::integer AS liquidity_events_7d
		FROM amm_trade_events event JOIN blocks block ON block.chain_id = event.chain_id AND block.hash = event.block_hash
		WHERE event.chain_id = ${chainId} AND event.market_address = ${market} AND event.canonical
			AND (event.event_name <> 'Swap' OR (event.event_data ? 'amountIn' AND event.event_data ? 'feeAmount'
				AND event.event_data ? 'resultingYesReserve' AND event.event_data ? 'resultingNoReserve'))
	`
	const exactObservations = observations.slice(-10_000).map((row: Record<string, unknown>) => ({
		timestamp: String(row['timestamp_seconds']),
		numerator: String(row['numerator']),
		denominator: String(row['denominator']),
	}))
	const end = String(asOf['blockTimestamp'])
	const endValue = BigInt(end)
	const firstObservation = exactObservations[0]
	const lastObservation = exactObservations.at(-1)
	return json({
		chainId,
		asOf,
		data: {
			market,
			summary: summaries[0],
			events: paged(eventRows, page.limit, (row) => protocolCursorFor(chainId, 'trading', market, asOf, row)),
			twap24h: fixedWindowTwap(exactObservations, (endValue > 86_400n ? endValue - 86_400n : 0n).toString(), end),
			twap7d: fixedWindowTwap(exactObservations, (endValue > 604_800n ? endValue - 604_800n : 0n).toString(), end),
			candles: candlestickBuckets(exactObservations, '3600'),
			observationLimit: 10_000,
			observationsTruncated: observations.length > 10_000,
			observationRange:
				firstObservation === undefined || lastObservation === undefined
					? undefined
					: { firstTimestamp: firstObservation.timestamp, lastTimestamp: lastObservation.timestamp, count: exactObservations.length },
		},
	})
}

const riskDetailResponse = async (sql: SQL, parts: readonly string[]): Promise<Response> => {
	const kind = parts[0]
	const chainId = routeInteger(parts[1])
	const poolAddress = parts[2]?.toLowerCase()
	const vaultAddress = parts[3]?.toLowerCase()
	if (
		chainId === undefined ||
		(kind !== 'pools' && kind !== 'vaults') ||
		poolAddress === undefined ||
		!/^0x[0-9a-f]{40}$/.test(poolAddress) ||
		(kind === 'pools' ? parts.length !== 3 : parts.length !== 4 || vaultAddress === undefined || !/^0x[0-9a-f]{40}$/.test(vaultAddress))
	)
		return json({ error: 'Invalid risk entity identifier' }, 400)
	const asOf = await operationsAsOf(sql, chainId)
	const risk = await riskCatalogData(sql, chainId, {
		poolAddress,
		...(kind === 'vaults' && vaultAddress !== undefined ? { vaultAddress } : {}),
		limit: 1,
	})
	const entity =
		kind === 'pools'
			? risk.pools.find((row: Record<string, unknown>) => row['pool_address'] === poolAddress)
			: risk.vaults.find((row: Record<string, unknown>) => row['pool_address'] === poolAddress && row['vault_address'] === vaultAddress)
	if (entity === undefined) return json({ error: `${kind === 'pools' ? 'Pool' : 'Vault'} risk state not found` }, 404)
	return json({ chainId, asOf, data: { ...entity, approvalEvents: risk.approvalEvents } })
}

const timelineResponse = async (sql: SQL, parts: readonly string[], url: URL): Promise<Response> => {
	const chainId = routeInteger(parts[0])
	const entityType = parts[1]
	const entityIdentity = parts[2] === undefined ? undefined : decodeURIComponent(parts[2])
	if (
		parts.length !== 3 ||
		chainId === undefined ||
		entityType === undefined ||
		!/^[a-z][a-z0-9-]{0,63}$/.test(entityType) ||
		entityIdentity === undefined ||
		entityIdentity.length > 256
	)
		return json({ error: 'Invalid timeline identifier' }, 400)
	const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 100
	const asOf = await operationsAsOf(sql, chainId)
	url.searchParams.set('limit', String(requestedLimit))
	const identity = `${entityType}:${entityIdentity}`
	const page = detailPage(url, chainId, 'timeline', identity, asOf)
	const cursorBlock = page.cursor?.[5] ?? String(asOf['blockNumber'])
	const cursorTx = page.cursor?.[6] ?? `0x${'f'.repeat(64)}`
	const cursorLog = page.cursor?.[7] ?? 2_147_483_647
	const rows = await sql`
		SELECT timeline.*, block.timestamp AS block_timestamp FROM protocol_timeline_entries timeline
		JOIN blocks block ON block.chain_id = timeline.chain_id AND block.hash = timeline.block_hash
		WHERE timeline.chain_id = ${chainId} AND timeline.entity_type = ${entityType}
			AND timeline.entity_identity = ${entityIdentity} AND timeline.canonical
			AND (timeline.block_number, timeline.tx_hash, timeline.log_index) < (${cursorBlock}::bigint, ${cursorTx}, ${cursorLog}::integer)
		ORDER BY timeline.block_number DESC, timeline.tx_hash DESC, timeline.log_index DESC LIMIT ${page.queryLimit}
	`
	return json({ chainId, asOf, data: paged(rows, page.limit, (row) => protocolCursorFor(chainId, 'timeline', identity, asOf, row)) })
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
		const [snapshots, events, markets, ammPrices, repEthPrices, uniswapRepEthPrices, openOracleHistory] = await Promise.all([
			sql`SELECT s.*, b.timestamp FROM pool_snapshots s JOIN blocks b ON b.chain_id = s.chain_id AND b.hash = s.block_hash WHERE s.chain_id = ${chainId} AND s.pool_address = ${address} AND s.canonical ORDER BY s.block_number DESC, s.log_index DESC LIMIT ${queryLimit}`,
			sql`SELECT e.*, b.timestamp FROM pool_state_events e JOIN blocks b ON b.chain_id = e.chain_id AND b.hash = e.block_hash WHERE e.chain_id = ${chainId} AND e.pool_address = ${address} AND e.canonical ORDER BY e.block_number DESC, e.log_index DESC LIMIT ${queryLimit}`,
			sql`SELECT market.chain_id::text AS chain_id, market.block_hash, market.tx_hash, market.log_index, market.block_number::text AS block_number, market.pair_address, market.pool_address, market.share_token_address, market.universe_id::text AS universe_id, market.fee_bps::text AS fee_bps, market.canonical, block.timestamp FROM amm_markets market JOIN blocks block ON block.chain_id = market.chain_id AND block.hash = market.block_hash WHERE market.chain_id = ${chainId} AND market.pool_address = ${address} AND market.canonical ORDER BY market.block_number DESC, market.log_index DESC LIMIT 1`,
			sql`SELECT price.chain_id::text AS chain_id, price.block_hash, price.tx_hash, price.log_index, price.block_number::text AS block_number, price.pair_address, price.yes_reserve_atto_shares::text AS yes_reserve_atto_shares, price.no_reserve_atto_shares::text AS no_reserve_atto_shares, price.conditional_yes_bps::text AS conditional_yes_bps, price.conditional_no_bps::text AS conditional_no_bps, price.canonical, block.timestamp FROM amm_price_snapshots price JOIN blocks block ON block.chain_id = price.chain_id AND block.hash = price.block_hash JOIN amm_markets market ON market.chain_id = price.chain_id AND market.pair_address = price.pair_address AND market.canonical WHERE price.chain_id = ${chainId} AND market.pool_address = ${address} AND price.canonical ORDER BY price.block_number DESC, price.log_index DESC LIMIT ${queryLimit}`,
			sql`SELECT price.chain_id::text AS chain_id, price.block_hash, price.tx_hash, price.log_index, price.block_number::text AS block_number, price.coordinator_address, price.event_name, price.report_id::text AS report_id, price.rep_per_eth_1e18::text AS rep_per_eth_1e18, price.settlement_timestamp, price.canonical, block.timestamp FROM rep_eth_price_snapshots price JOIN blocks block ON block.chain_id = price.chain_id AND block.hash = price.block_hash JOIN pools pool ON pool.chain_id = price.chain_id AND pool.coordinator_address = price.coordinator_address AND pool.canonical WHERE price.chain_id = ${chainId} AND pool.pool_address = ${address} AND price.canonical ORDER BY price.block_number DESC, price.log_index DESC LIMIT ${queryLimit}`,
			sql`
				WITH target_pool AS (
					SELECT pools.universe_id FROM pools
					WHERE pools.chain_id = ${chainId} AND pools.pool_address = ${address} AND pools.canonical
					ORDER BY pools.block_number DESC, pools.log_index DESC LIMIT 1
				), universe_rep AS (
					SELECT universe_events.reputation_token_address
					FROM universe_events CROSS JOIN target_pool
					WHERE universe_events.chain_id = ${chainId}
						AND universe_events.universe_id = target_pool.universe_id
						AND universe_events.reputation_token_address IS NOT NULL
						AND universe_events.canonical
					ORDER BY universe_events.block_number DESC, universe_events.log_index DESC LIMIT 1
				)
				SELECT observation.chain_id::text AS chain_id, observation.block_hash, observation.tx_hash,
					observation.log_index, observation.block_number::text AS block_number, observation.venue,
					observation.market_id, observation.event_name, market.contract_address, market.token0_address,
					market.token1_address, market.fee_hundredths_bip::text AS fee_hundredths_bip,
					market.tick_spacing, market.hooks_address,
					CASE WHEN quote_contract.kind = 'usdc' THEN 'USDC' WHEN observation.venue = 'v4' THEN 'ETH' ELSE COALESCE(quote_metadata.symbol, 'WETH') END AS quote_symbol,
					CASE
						WHEN market.token0_address = universe_rep.reputation_token_address THEN market.token1_address
						ELSE market.token0_address
					END AS quote_token_address,
					TRUNC(CASE
						WHEN observation.venue = 'v2' AND market.token0_address = universe_rep.reputation_token_address
							THEN observation.reserve0 * power(10::numeric, COALESCE(quote_metadata.decimals, CASE WHEN quote_contract.kind = 'usdc' THEN ${USDC_QUOTE_DECIMALS} ELSE ${ETH_QUOTE_DECIMALS} END)) / observation.reserve1
						WHEN observation.venue = 'v2'
							THEN observation.reserve1 * power(10::numeric, COALESCE(quote_metadata.decimals, CASE WHEN quote_contract.kind = 'usdc' THEN ${USDC_QUOTE_DECIMALS} ELSE ${ETH_QUOTE_DECIMALS} END)) / observation.reserve0
						WHEN market.token0_address = universe_rep.reputation_token_address
							THEN 6277101735386680763835789423207666416102355444464034512896 * power(10::numeric, COALESCE(quote_metadata.decimals, CASE WHEN quote_contract.kind = 'usdc' THEN ${USDC_QUOTE_DECIMALS} ELSE ${ETH_QUOTE_DECIMALS} END))
								/ (observation.sqrt_price_x96 * observation.sqrt_price_x96)
						ELSE observation.sqrt_price_x96 * observation.sqrt_price_x96 * power(10::numeric, COALESCE(quote_metadata.decimals, CASE WHEN quote_contract.kind = 'usdc' THEN ${USDC_QUOTE_DECIMALS} ELSE ${ETH_QUOTE_DECIMALS} END))
							/ 6277101735386680763835789423207666416102355444464034512896
					END)::text AS rep_per_eth_1e18,
					TRUNC(CASE WHEN observation.venue = 'v2' THEN observation.reserve0 * observation.reserve1 ELSE observation.liquidity END)::text AS liquidity_value,
					block.timestamp
				FROM uniswap_rep_eth_price_observations observation
				JOIN uniswap_rep_eth_markets market ON market.chain_id = observation.chain_id
					AND market.venue = observation.venue AND market.market_id = observation.market_id AND market.canonical
				JOIN universe_rep ON market.token0_address = universe_rep.reputation_token_address
					OR market.token1_address = universe_rep.reputation_token_address
				JOIN blocks block ON block.chain_id = observation.chain_id AND block.hash = observation.block_hash
				LEFT JOIN contracts quote_contract ON quote_contract.chain_id = market.chain_id AND quote_contract.canonical
					AND quote_contract.address = CASE WHEN market.token0_address = universe_rep.reputation_token_address THEN market.token1_address ELSE market.token0_address END
				LEFT JOIN LATERAL (
					SELECT metadata.symbol, metadata.decimals FROM token_metadata metadata
					WHERE metadata.chain_id = market.chain_id AND metadata.address = quote_contract.address AND metadata.canonical
					ORDER BY metadata.read_block DESC LIMIT 1
				) quote_metadata ON true
				WHERE observation.chain_id = ${chainId} AND observation.canonical
					AND CASE WHEN observation.venue = 'v2'
						THEN observation.reserve0 > 0 AND observation.reserve1 > 0
						ELSE observation.sqrt_price_x96 > 0
					END
				ORDER BY observation.block_number DESC, observation.log_index DESC LIMIT ${queryLimit}
			`,
			sql`SELECT log.block_number::text AS block_number, log.block_hash, log.tx_hash, log.log_index, log.event_name,
				log.arguments, log.summary, log.emitter_address AS coordinator_address, block.timestamp
				FROM logs log JOIN blocks block ON block.chain_id = log.chain_id AND block.hash = log.block_hash
				JOIN pools pool ON pool.chain_id = log.chain_id AND pool.coordinator_address = log.emitter_address AND pool.canonical
				WHERE log.chain_id = ${chainId} AND pool.pool_address = ${address} AND log.canonical
					AND log.event_name IN ('PriceRequested', 'PriceReportRejected', 'PriceReported', 'PendingReportRecovered', 'CoordinatorStateCheckpoint')
				ORDER BY log.block_number DESC, log.log_index DESC LIMIT ${queryLimit}`,
		])
		return json({
			snapshots: chronological(snapshots),
			events: chronological(events),
			market: markets[0],
			ammPrices: chronological(ammPrices),
			repEthPrices: chronological(repEthPrices),
			uniswapRepEthPrices: chronological(uniswapRepEthPrices),
			openOracleHistory: chronological(openOracleHistory),
			truncated:
				snapshots.length > limit ||
				events.length > limit ||
				ammPrices.length > limit ||
				repEthPrices.length > limit ||
				uniswapRepEthPrices.length > limit ||
				openOracleHistory.length > limit,
			limit,
		})
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
				) AS native_balance_detail,
				COALESCE((
					SELECT jsonb_agg(jsonb_build_object(
						'type', event.event_name, 'entity', event.game_address, 'data', event.event_data,
						'blockNumber', event.block_number::text, 'provenance', 'historical interaction'
					) ORDER BY event.block_number DESC, event.log_index DESC)
					FROM (
						SELECT * FROM escalation_game_events evidence
						WHERE evidence.chain_id = page.chain_id AND evidence.canonical
							AND lower(evidence.event_data->>'depositor') = page.address
						ORDER BY evidence.block_number DESC, evidence.log_index DESC LIMIT 100
					) event
				), '[]'::jsonb) AS escalation_claims,
				COALESCE((
					SELECT jsonb_agg(jsonb_build_object(
						'type', event.event_name, 'entity', event.auction_address, 'data', event.event_data,
						'blockNumber', event.block_number::text, 'provenance', 'historical interaction'
					) ORDER BY event.block_number DESC, event.log_index DESC)
					FROM (
						SELECT * FROM truth_auction_events evidence
						WHERE evidence.chain_id = page.chain_id AND evidence.canonical
							AND lower(evidence.event_data->>'bidder') = page.address
						ORDER BY evidence.block_number DESC, evidence.log_index DESC LIMIT 100
					) event
				), '[]'::jsonb) AS auction_claims
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

const addressPortfolioResponse = async (sql: SQL, url: URL): Promise<Response> => {
	const chainId = integer(url.searchParams.get('chainId'), 'chainId')
	if (chainId === undefined) throw new ApiRequestError('chainId is required')
	const address = evmAddress(url.searchParams.get('address'), 'address')
	if (address === undefined) throw new ApiRequestError('address is required')
	const requestUrl = new URL(url)
	requestUrl.pathname = '/api/v1/richlist'
	requestUrl.search = new URLSearchParams({ chainId: String(chainId), address, limit: '1' }).toString()
	const portfolioResponse = await richList(sql, requestUrl)
	const payload: unknown = await portfolioResponse.json()
	const payloadRecord = jsonRecord(payload)
	const items = Array.isArray(payloadRecord['items']) ? payloadRecord['items'] : []
	return json({ chainId, asOf: await operationsAsOf(sql, chainId), data: items[0] ?? { address, availability: 'Awaiting indexed evidence' } })
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
		if (url.pathname === '/api/v1/operations') return await operationsResponse(sql, url)
		if (url.pathname === '/api/v1/state/reports') return await domainCatalogResponse(sql, url, 'reports')
		if (url.pathname === '/api/v1/state/escalations') return await domainCatalogResponse(sql, url, 'escalations')
		if (url.pathname === '/api/v1/state/auctions') return await domainCatalogResponse(sql, url, 'auctions')
		if (url.pathname === '/api/v1/state/risk') return await domainCatalogResponse(sql, url, 'risk')
		if (url.pathname === '/api/v1/state/forks') return await domainCatalogResponse(sql, url, 'forks')
		if (url.pathname.startsWith('/api/v1/state/reports/'))
			return await reportDetailResponse(sql, url.pathname.slice('/api/v1/state/reports/'.length).split('/'), url)
		if (url.pathname.startsWith('/api/v1/state/escalations/'))
			return await eventEntityDetailResponse(sql, url.pathname.slice('/api/v1/state/escalations/'.length).split('/'), url, 'escalation')
		if (url.pathname.startsWith('/api/v1/state/auctions/'))
			return await eventEntityDetailResponse(sql, url.pathname.slice('/api/v1/state/auctions/'.length).split('/'), url, 'auction')
		if (url.pathname.startsWith('/api/v1/state/forks/')) return await forkDetailResponse(sql, url.pathname.slice('/api/v1/state/forks/'.length).split('/'), url)
		if (url.pathname.startsWith('/api/v1/state/risk/')) return await riskDetailResponse(sql, url.pathname.slice('/api/v1/state/risk/'.length).split('/'))
		if (url.pathname.startsWith('/api/v1/state/trading/'))
			return await tradingDetailResponse(sql, url.pathname.slice('/api/v1/state/trading/'.length).split('/'), url)
		if (url.pathname === '/api/v1/state/address-portfolio') return await addressPortfolioResponse(sql, url)
		if (url.pathname.startsWith('/api/v1/state/timeline/'))
			return await timelineResponse(sql, url.pathname.slice('/api/v1/state/timeline/'.length).split('/'), url)
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
