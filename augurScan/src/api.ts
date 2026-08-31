import type { SQL } from 'bun'
import { decodeOpaqueCursor, encodeOpaqueCursor } from './cursor-codec.ts'
import {
	auctionDemandCurve,
	auctionLifecycle,
	candlestickBuckets,
	ESCALATION_OUTCOME,
	ETH_QUOTE_DECIMALS,
	fixedWindowTwap,
	poolCapacity,
	reportLifecycle,
	reportRoundChanges,
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

const boundedInteger = (value: string | null, name: string, maximum: number): number | undefined => {
	const result = integer(value, name)
	if (result !== undefined && result > maximum) throw new ApiRequestError(`${name} must not exceed ${maximum}`)
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

const parsedJsonColumn = (value: unknown): unknown => {
	if (typeof value !== 'string') return value
	try {
		return JSON.parse(value) as unknown
	} catch (error) {
		if (error instanceof SyntaxError) return value
		throw error
	}
}

const jsonRecord = (value: unknown): Record<string, unknown> => {
	const parsed = parsedJsonColumn(value)
	return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? Object.fromEntries(Object.entries(parsed)) : {}
}

const decodedJsonColumns = (row: Record<string, unknown>, columns: readonly string[]): Record<string, unknown> => ({
	...row,
	...Object.fromEntries(columns.flatMap((column) => (row[column] === undefined ? [] : [[column, parsedJsonColumn(row[column])]]))),
})

const actionJsonColumns = [
	'arguments',
	'display_arguments',
	'argument_schema',
	'action_arguments',
	'action_display_arguments',
	'action_argument_schema',
	'receipt',
] as const

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

const isCursorTimestamp = (value: string): boolean => {
	const match = /^((?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{3,6})Z$/.exec(value)
	if (match === null) return false
	const [, prefix, fraction] = match
	if (prefix === undefined || fraction === undefined) return false
	const millisecondTimestamp = `${prefix}.${fraction.slice(0, 3)}Z`
	const parsed = new Date(millisecondTimestamp)
	return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === millisecondTimestamp
}

const cursorTimestamp = (value: unknown): string => {
	const result = value instanceof Date ? value.toISOString() : value
	if (typeof result !== 'string' || !isCursorTimestamp(result)) throw new Error('Database returned an invalid cursor timestamp')
	return result
}

const isNonNegativeSafeInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const POSTGRES_INTEGER_MAX = 2_147_483_647
const isPostgresInteger = (value: unknown): value is number => isNonNegativeSafeInteger(value) && value <= POSTGRES_INTEGER_MAX
const isPostgresIntegerString = (value: unknown): value is string =>
	typeof value === 'string' && /^\d+$/.test(value) && BigInt(value) <= BigInt(POSTGRES_INTEGER_MAX)
const routeInteger = (value: string | undefined, postgresInteger = false): number | undefined => {
	if (value === undefined || !/^\d+$/.test(value)) return undefined
	const result = Number(value)
	return (postgresInteger ? isPostgresInteger(result) : isNonNegativeSafeInteger(result)) ? result : undefined
}

type LogCursor = readonly [
	version: 1,
	chainId: number,
	event: string | null,
	address: string | null,
	decoded: 'true' | 'false' | null,
	canonical: CanonicalHistoryFilter,
	snapshotBlock: string,
	snapshotHash: string,
	invalidationId: string,
	abiSourceHash: string,
	applicationSourceHash: string,
	projectionSourceHash: string,
	timestamp: string,
	blockNumber: string,
	transactionIndex: number,
	logIndex: number,
	blockHash: string,
]

const isLogCursor = (parts: readonly unknown[]): parts is LogCursor =>
	parts.length === 17 &&
	parts[0] === 1 &&
	isNonNegativeSafeInteger(parts[1]) &&
	(parts[2] === null || (typeof parts[2] === 'string' && parts[2] !== '')) &&
	(parts[3] === null || (typeof parts[3] === 'string' && /^0x[0-9a-f]{40}$/.test(parts[3]))) &&
	(parts[4] === null || parts[4] === 'true' || parts[4] === 'false') &&
	(parts[5] === 'canonical' || parts[5] === 'orphaned' || parts[5] === 'all') &&
	isPostgresBigint(parts[6]) &&
	typeof parts[7] === 'string' &&
	/^0x[0-9a-f]{64}$/.test(parts[7]) &&
	isPostgresBigint(parts[8]) &&
	parts.slice(9, 12).every((part) => typeof part === 'string') &&
	typeof parts[12] === 'string' &&
	isExactIsoTimestamp(parts[12]) &&
	isPostgresBigint(parts[13]) &&
	isPostgresInteger(parts[14]) &&
	isPostgresInteger(parts[15]) &&
	typeof parts[16] === 'string' &&
	/^0x[0-9a-f]{64}$/.test(parts[16])

const parseLogCursor = (
	value: string | null,
	chainId: number,
	event: string | null,
	address: string | null,
	decoded: 'true' | 'false' | null,
	canonical: CanonicalHistoryFilter,
): LogCursor | undefined => {
	if (value === null) return undefined
	let parts: unknown[]
	try {
		const parsed = decodeOpaqueCursor(value)
		parts = Array.isArray(parsed) ? parsed : []
		if (!isLogCursor(parts)) throw new Error('shape')
	} catch (error) {
		throw new ApiRequestError('cursor is invalid', { cause: error })
	}
	if (parts[1] !== chainId || parts[2] !== event || parts[3] !== address || parts[4] !== decoded || parts[5] !== canonical)
		throw new ApiRequestError('cursor does not match the requested log collection')
	return parts
}

const logCursorFor = (
	chainId: number,
	event: string | null,
	address: string | null,
	decoded: 'true' | 'false' | null,
	canonical: CanonicalHistoryFilter,
	asOf: Record<string, unknown>,
	row: Record<string, unknown>,
): string =>
	encodeOpaqueCursor([
		1,
		chainId,
		event,
		address,
		decoded,
		canonical,
		...snapshotBoundary(asOf),
		cursorTimestamp(row['block_timestamp']),
		String(row['block_number']),
		Number(row['transaction_index']),
		Number(row['log_index']),
		String(row['block_hash']),
	] satisfies LogCursor)

type AddressHistoryKind = 'referenced' | 'sent'

type AddressHistoryCursor = readonly [
	version: 1,
	kind: AddressHistoryKind,
	chainId: number,
	address: string,
	snapshotBlock: string,
	snapshotHash: string,
	invalidationId: string,
	abiSourceHash: string,
	applicationSourceHash: string,
	projectionSourceHash: string,
	total: number,
	block: string,
	transaction: number,
]

const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n

const isPostgresBigint = (value: unknown): value is string => {
	if (typeof value !== 'string' || !/^(0|[1-9]\d{0,18})$/.test(value)) return false
	return BigInt(value) <= POSTGRES_BIGINT_MAX
}

export const directObservationTotal = (value: unknown): number => {
	if (!isPostgresBigint(value) || BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER))
		throw new ApiRequestError('direct observation result set exceeds the safe pagination range; narrow kind, address, or canonical filters')
	return Number(value)
}

const postgresBigint = (value: string | null, name: string): string | undefined => {
	if (value === null || value === '') return undefined
	if (!isPostgresBigint(value)) throw new ApiRequestError(`${name} must be a non-negative PostgreSQL bigint`)
	return value
}

const parseAddressHistoryCursor = (value: string | null, kind: AddressHistoryKind): AddressHistoryCursor | undefined => {
	if (value === null) return undefined
	try {
		const parsed = decodeOpaqueCursor(value)
		const parts = Array.isArray(parsed) ? parsed : []
		if (
			parts.length !== 13 ||
			parts[0] !== 1 ||
			parts[1] !== kind ||
			!isNonNegativeSafeInteger(parts[2]) ||
			typeof parts[3] !== 'string' ||
			!/^0x[0-9a-f]{40}$/.test(parts[3]) ||
			!isPostgresBigint(parts[4]) ||
			typeof parts[5] !== 'string' ||
			!/^0x[0-9a-f]{64}$/.test(parts[5]) ||
			!isPostgresBigint(parts[6]) ||
			!parts.slice(7, 10).every((part) => typeof part === 'string') ||
			!isNonNegativeSafeInteger(parts[10]) ||
			!isPostgresBigint(parts[11]) ||
			!isPostgresInteger(parts[12]) ||
			BigInt(parts[11]) > BigInt(parts[4])
		)
			throw new Error('shape')
		return parts as [1, AddressHistoryKind, number, string, string, string, string, string, string, string, number, string, number]
	} catch (error) {
		throw new ApiRequestError('cursor is invalid', { cause: error })
	}
}

const addressHistoryCursorFor = (
	kind: AddressHistoryKind,
	chainId: number,
	address: string,
	snapshotBlock: string,
	snapshotHash: string,
	asOf: Record<string, unknown>,
	total: number,
	row: Record<string, unknown>,
): string =>
	encodeOpaqueCursor([
		1,
		kind,
		chainId,
		address,
		snapshotBlock,
		snapshotHash,
		String(asOf['invalidationId']),
		String(asOf['abiSourceHash']),
		String(asOf['applicationSourceHash']),
		String(asOf['projectionSourceHash']),
		total,
		String(row['block_number']),
		Number(row['transaction_index']),
	] satisfies AddressHistoryCursor)

type ActionCursor = readonly [
	version: 1,
	chainId: number,
	snapshotBlock: string,
	snapshotHash: string,
	invalidationId: string,
	abiSourceHash: string,
	applicationSourceHash: string,
	projectionSourceHash: string,
	timestamp: string,
	blockNumber: string,
	transactionIndex: number,
	blockHash: string,
	txHash: string,
]

const isActionCursor = (parts: readonly unknown[]): parts is ActionCursor =>
	parts.length === 13 &&
	parts[0] === 1 &&
	isNonNegativeSafeInteger(parts[1]) &&
	isPostgresBigint(parts[2]) &&
	typeof parts[3] === 'string' &&
	/^0x[0-9a-f]{64}$/.test(parts[3]) &&
	isPostgresBigint(parts[4]) &&
	parts.slice(5, 8).every((part) => typeof part === 'string') &&
	typeof parts[8] === 'string' &&
	isCursorTimestamp(parts[8]) &&
	isPostgresBigint(parts[9]) &&
	isPostgresInteger(parts[10]) &&
	typeof parts[11] === 'string' &&
	/^0x[0-9a-f]{64}$/.test(parts[11]) &&
	typeof parts[12] === 'string' &&
	/^0x[0-9a-f]{64}$/.test(parts[12])

const parseActionCursor = (value: string | null, chainId: number): ActionCursor | undefined => {
	if (value === null) return undefined
	let parts: unknown[]
	try {
		const parsed = decodeOpaqueCursor(value)
		parts = Array.isArray(parsed) ? parsed : []
		if (!isActionCursor(parts)) throw new Error('shape')
	} catch (error) {
		throw new ApiRequestError('cursor is invalid', { cause: error })
	}
	if (parts[1] !== chainId) throw new ApiRequestError('cursor does not match the requested action collection')
	return parts
}

const actionCursorFor = (chainId: number, asOf: Record<string, unknown>, row: Record<string, unknown>): string =>
	encodeOpaqueCursor([
		1,
		chainId,
		...snapshotBoundary(asOf),
		cursorTimestamp(row['block_timestamp']),
		String(row['block_number']),
		Number(row['transaction_index']),
		String(row['block_hash']),
		String(row['tx_hash']),
	] satisfies ActionCursor)

type CanonicalHistoryFilter = 'canonical' | 'orphaned' | 'all'

const canonicalHistoryFilter = (url: URL): CanonicalHistoryFilter => {
	const value = url.searchParams.get('canonical') ?? 'canonical'
	if (value !== 'canonical' && value !== 'orphaned' && value !== 'all') throw new ApiRequestError('canonical must be canonical, orphaned, or all')
	return value
}

const listLogs = async (sql: SQL, url: URL): Promise<Response> => {
	const chainId = integer(url.searchParams.get('chainId'), 'chainId')
	const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 100
	const limit = Math.min(Math.max(requestedLimit, 1), 250)
	if (url.searchParams.has('offset')) throw new ApiRequestError('offset requires a snapshot-bound cursor')
	const event = url.searchParams.get('event')?.trim() || null
	const address = evmAddress(url.searchParams.get('address'), 'address') ?? null
	const decoded = url.searchParams.get('decoded')
	if (decoded !== null && decoded !== '' && decoded !== 'true' && decoded !== 'false') throw new ApiRequestError('decoded must be true or false')
	const decodedFilter: 'true' | 'false' | null = decoded === 'true' || decoded === 'false' ? decoded : null
	const canonical = canonicalHistoryFilter(url)
	if (chainId === undefined) throw new ApiRequestError('chainId is required')
	const cursor = parseLogCursor(url.searchParams.get('cursor'), chainId, event, address, decodedFilter, canonical)
	const asOf = await operationsAsOfForContinuations(sql, chainId, cursor === undefined ? [] : [{ parts: cursor, offset: 6 }])
	const values: Array<string | number> = []
	const clauses = canonical === 'all' ? ['true'] : [`l.canonical = ${canonical === 'canonical' ? 'true' : 'false'}`]
	const bind = (value: string | number): string => {
		values.push(value)
		return `$${values.length}`
	}
	clauses.push(`l.chain_id = ${bind(chainId)}`)
	if (event !== null) clauses.push(`l.event_name ILIKE ${bind(`%${event}%`)}`)
	if (address !== null) {
		const addressParameter = bind(address)
		const addressPatternParameter = bind(`%${address}%`)
		clauses.push(`(
			l.emitter_address = ${addressParameter}
			OR l.arguments::text ILIKE ${addressPatternParameter}
			OR EXISTS (
				SELECT 1 FROM address_activity activity
				WHERE activity.chain_id = l.chain_id
					AND activity.block_hash = l.block_hash
					AND activity.tx_hash = l.tx_hash
					AND activity.address = ${addressParameter}
			)
		)`)
	}
	if (decodedFilter === 'true') clauses.push("l.decode_status = 'decoded'")
	if (decodedFilter === 'false') clauses.push("l.decode_status <> 'decoded'")
	if (cursor !== undefined) {
		clauses.push(
			`(b.timestamp, l.block_number, l.transaction_index, l.log_index, l.block_hash) < (${bind(cursor[12])}::timestamptz, ${bind(cursor[13])}::bigint, ${bind(cursor[14])}, ${bind(cursor[15])}, ${bind(cursor[16])})`,
		)
	}
	values.push(limit + 1)
	const rows = await sql.unsafe(
		`SELECT l.*, b.timestamp AS block_timestamp, b.hash AS canonical_block_hash, t.from_address AS origin_address, c.label AS contract_label, c.kind AS contract_kind, n.id AS network_id, n.name AS network_name, n.explorer_base_url,
			CASE WHEN l.canonical THEN 'canonical'
				WHEN invalidation.reason = 'chain-reorg' THEN 'chain-orphaned'
				WHEN invalidation.reason = 'manifest-reset' THEN 'manifest-superseded'
				WHEN invalidation.reason = 'start-boundary-advanced' THEN 'coverage-reset'
				WHEN invalidation.reason = 'abi-redecode' THEN 'decode-superseded'
				WHEN invalidation.reason = 'projection-rebuild' THEN 'projection-superseded'
				ELSE 'noncanonical-unknown' END AS evidence_status,
			invalidation.id::text AS invalidation_id, invalidation.reason AS invalidation_reason,
			invalidation.causes AS invalidation_causes, invalidation.detected_at AS invalidated_at
		FROM logs l
		JOIN blocks b ON b.chain_id = l.chain_id AND b.hash = l.block_hash
		JOIN transactions t ON t.chain_id = l.chain_id AND t.block_hash = l.block_hash AND t.hash = l.tx_hash
		JOIN networks n ON n.chain_id = l.chain_id
		LEFT JOIN contracts c ON c.chain_id = l.chain_id AND c.address = l.emitter_address AND c.canonical
		LEFT JOIN LATERAL (
			SELECT replacement.id, replacement.reason,
				COALESCE((SELECT jsonb_agg(cause.reason ORDER BY cause.reason) FROM history_invalidation_causes cause
					WHERE cause.invalidation_id = replacement.id), jsonb_build_array(replacement.reason)) AS causes,
				replacement.detected_at
			FROM history_invalidation_occurrences occurrence
			JOIN chain_reorganizations replacement ON replacement.id = occurrence.invalidation_id
			WHERE occurrence.occurrence_kind = 'log' AND occurrence.chain_id = l.chain_id
				AND occurrence.block_hash = l.block_hash AND occurrence.occurrence_id = l.tx_hash
				AND occurrence.sub_index = l.log_index
			ORDER BY replacement.id DESC LIMIT 1
		) invalidation ON true
		WHERE ${clauses.join(' AND ')}
		ORDER BY b.timestamp DESC, l.chain_id DESC, l.block_number DESC, l.transaction_index DESC, l.log_index DESC, l.block_hash DESC
		LIMIT $${values.length}`,
		values,
	)
	const hasMore = rows.length > limit
	const items = rows.slice(0, limit)
	return json({
		items,
		canonical,
		asOf,
		nextCursor:
			hasMore && items.length > 0
				? logCursorFor(chainId, event, address, decodedFilter, canonical, asOf, items[items.length - 1] as Record<string, unknown>)
				: undefined,
	})
}

const logDetail = async (sql: SQL, parts: readonly string[], url: URL): Promise<Response> => {
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
	const canonical = canonicalHistoryFilter(url)
	const canonicalOnly = canonical === 'canonical'
	if (canonical === 'orphaned') throw new ApiRequestError('log detail canonical filter must be canonical or all')
	const rows = await sql`
		SELECT l.*, b.timestamp AS block_timestamp, c.label AS contract_label, c.kind AS contract_kind, c.provenance AS contract_provenance,
			t.from_address AS origin_address, t.to_address, t.value, t.input, t.gas_used, t.receipt, a.function_name, a.function_signature, a.arguments AS action_arguments, a.display_arguments AS action_display_arguments, a.argument_schema AS action_argument_schema, a.summary AS action_summary,
			n.id AS network_id, n.explorer_base_url,
			CASE WHEN l.canonical THEN 'canonical'
				WHEN invalidation.reason = 'chain-reorg' THEN 'chain-orphaned'
				WHEN invalidation.reason = 'manifest-reset' THEN 'manifest-superseded'
				WHEN invalidation.reason = 'start-boundary-advanced' THEN 'coverage-reset'
				WHEN invalidation.reason = 'abi-redecode' THEN 'decode-superseded'
				WHEN invalidation.reason = 'projection-rebuild' THEN 'projection-superseded'
				ELSE 'noncanonical-unknown' END AS evidence_status,
			invalidation.id::text AS invalidation_id, invalidation.reason AS invalidation_reason,
			invalidation.causes AS invalidation_causes, invalidation.detected_at AS invalidated_at
		FROM logs l
		JOIN blocks b ON b.chain_id = l.chain_id AND b.hash = l.block_hash
		JOIN transactions t ON t.chain_id = l.chain_id AND t.block_hash = l.block_hash AND t.hash = l.tx_hash
		LEFT JOIN actions a ON a.chain_id = l.chain_id AND a.block_hash = l.block_hash AND a.tx_hash = l.tx_hash
		LEFT JOIN contracts c ON c.chain_id = l.chain_id AND c.address = l.emitter_address AND c.canonical
		LEFT JOIN LATERAL (
			SELECT replacement.id, replacement.reason,
				COALESCE((SELECT jsonb_agg(cause.reason ORDER BY cause.reason) FROM history_invalidation_causes cause
					WHERE cause.invalidation_id = replacement.id), jsonb_build_array(replacement.reason)) AS causes,
				replacement.detected_at
			FROM history_invalidation_occurrences occurrence
			JOIN chain_reorganizations replacement ON replacement.id = occurrence.invalidation_id
			WHERE occurrence.occurrence_kind = 'log' AND occurrence.chain_id = l.chain_id
				AND occurrence.block_hash = l.block_hash AND occurrence.occurrence_id = l.tx_hash
				AND occurrence.sub_index = l.log_index
			ORDER BY replacement.id DESC LIMIT 1
		) invalidation ON true
		JOIN networks n ON n.chain_id = l.chain_id
		WHERE (${canonicalOnly} = false OR (l.canonical AND b.canonical AND t.canonical))
			AND l.chain_id = ${chainId} AND l.block_hash = ${blockHash.toLowerCase()} AND l.tx_hash = ${hash.toLowerCase()} AND l.log_index = ${logIndex}
	`
	if (rows.length === 0) return json({ error: 'Log not found' }, 404)
	const [related, logInterpretations, actionInterpretations] = await Promise.all([
		sql`
		SELECT log_index, emitter_address, event_name, summary, canonical
		FROM logs
		WHERE (${canonicalOnly} = false OR canonical) AND chain_id = ${chainId}
			AND block_hash = ${blockHash.toLowerCase()} AND tx_hash = ${hash.toLowerCase()}
		ORDER BY log_index
	`,
		sql`
			SELECT interpretation_kind, interpretation_key, indexer_run_id::text, abi_source_hash,
				application_source_hash, projection_source_hash, interpretation, interpreted_at
			FROM log_interpretations
			WHERE chain_id = ${chainId} AND block_hash = ${blockHash.toLowerCase()} AND tx_hash = ${hash.toLowerCase()} AND log_index = ${logIndex}
			ORDER BY interpreted_at DESC, indexer_run_id DESC, interpretation_kind, interpretation_key
		`,
		sql`
			SELECT indexer_run_id::text, abi_source_hash, application_source_hash, interpretation, interpreted_at
			FROM action_interpretations
			WHERE chain_id = ${chainId} AND block_hash = ${blockHash.toLowerCase()} AND tx_hash = ${hash.toLowerCase()}
			ORDER BY interpreted_at DESC, indexer_run_id DESC
		`,
	])
	const detail = decodedJsonColumns(rows[0] ?? {}, actionJsonColumns)
	return json({
		...detail,
		relatedLogs: related,
		interpretations: {
			log: logInterpretations.map((row: Record<string, unknown>) => decodedJsonColumns(row, ['interpretation'])),
			action: actionInterpretations.map((row: Record<string, unknown>) => decodedJsonColumns(row, ['interpretation'])),
		},
	})
}

type ReorganizationCursor = readonly [
	version: 1,
	chainId: number,
	snapshotBlock: string,
	snapshotHash: string,
	invalidationId: string,
	abiSourceHash: string,
	applicationSourceHash: string,
	projectionSourceHash: string,
	detectedAt: string,
	id: string,
]

const isReorganizationCursor = (parts: readonly unknown[]): parts is ReorganizationCursor =>
	parts.length === 10 &&
	parts[0] === 1 &&
	isNonNegativeSafeInteger(parts[1]) &&
	isPostgresBigint(parts[2]) &&
	typeof parts[3] === 'string' &&
	/^0x[0-9a-f]{64}$/.test(parts[3]) &&
	isPostgresBigint(parts[4]) &&
	parts.slice(5, 8).every((part) => typeof part === 'string') &&
	typeof parts[8] === 'string' &&
	isCursorTimestamp(parts[8]) &&
	isPostgresBigint(parts[9])

const parseReorganizationCursor = (value: string | null, chainId: number): ReorganizationCursor | undefined => {
	if (value === null) return undefined
	let parts: unknown[]
	try {
		const parsed = decodeOpaqueCursor(value)
		parts = Array.isArray(parsed) ? parsed : []
		if (!isReorganizationCursor(parts)) throw new Error('shape')
	} catch (error) {
		throw new ApiRequestError('cursor is invalid', { cause: error })
	}
	if (parts[1] !== chainId) throw new ApiRequestError('cursor does not match the requested reorganization collection')
	return parts
}

const reorganizationCursorFor = (chainId: number, asOf: Record<string, unknown>, row: Record<string, unknown>): string =>
	encodeOpaqueCursor([1, chainId, ...snapshotBoundary(asOf), cursorTimestamp(row['cursor_detected_at']), String(row['id'])] satisfies ReorganizationCursor)

const reorganizationHistory = async (sql: SQL, url: URL): Promise<Response> => {
	const chainId = integer(url.searchParams.get('chainId'), 'chainId')
	if (chainId === undefined) throw new ApiRequestError('chainId is required')
	const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 50
	const limit = Math.min(Math.max(requestedLimit, 1), 250)
	if (url.searchParams.has('offset')) throw new ApiRequestError('offset requires a snapshot-bound cursor')
	const cursor = parseReorganizationCursor(url.searchParams.get('cursor'), chainId)
	const asOf = await operationsAsOfForContinuations(sql, chainId, cursor === undefined ? [] : [{ parts: cursor, offset: 2 }])
	const snapshotInvalidationId = String(asOf['invalidationId'])
	const cursorClause = cursor === undefined ? sql`` : sql`AND (reorganization.detected_at, reorganization.id) < (${cursor[8]}, ${cursor[9]})`
	const rows = await sql`
		SELECT reorganization.id::text, reorganization.chain_id, reorganization.previous_block::text,
			reorganization.previous_hash, reorganization.ancestor_block::text, reorganization.ancestor_hash,
			reorganization.depth::text, reorganization.reason, reorganization.indexer_run_id::text,
			reorganization.abi_source_hash, reorganization.application_source_hash, reorganization.projection_source_hash,
			COALESCE((SELECT jsonb_agg(cause.reason ORDER BY cause.reason) FROM history_invalidation_causes cause
				WHERE cause.invalidation_id = reorganization.id), jsonb_build_array(reorganization.reason)) AS causes,
			COALESCE((SELECT jsonb_object_agg(counts.occurrence_kind, counts.occurrence_count ORDER BY counts.occurrence_kind)
				FROM (SELECT occurrence.occurrence_kind, count(*)::text AS occurrence_count
					FROM history_invalidation_occurrences occurrence WHERE occurrence.invalidation_id = reorganization.id
					GROUP BY occurrence.occurrence_kind) counts), '{}'::jsonb) AS occurrence_counts,
			reorganization.detected_at,
			to_char(reorganization.detected_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_detected_at
		FROM chain_reorganizations reorganization
		WHERE reorganization.chain_id = ${chainId} AND reorganization.id <= ${snapshotInvalidationId} ${cursorClause}
		ORDER BY reorganization.detected_at DESC, reorganization.id DESC
		LIMIT ${limit + 1}
	`
	const totalRows = await sql`
		SELECT count(*)::text AS total FROM chain_reorganizations
		WHERE chain_id = ${chainId} AND id <= ${snapshotInvalidationId}
	`
	const total = directObservationTotal(totalRows[0]?.['total'] ?? '0')
	const hasMore = rows.length > limit
	const pageRows = rows.slice(0, limit)
	const items = pageRows.map((row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'cursor_detected_at')))
	const last = pageRows[pageRows.length - 1]
	return json({
		items,
		total,
		limit,
		asOf,
		nextCursor: hasMore && last !== undefined ? reorganizationCursorFor(chainId, asOf, last) : undefined,
	})
}

type ProvenanceCursor = readonly [version: 1, startedAt: string, runId: string]

const parseProvenanceCursor = (value: string | null): ProvenanceCursor | undefined => {
	if (value === null) return undefined
	try {
		const parsed = decodeOpaqueCursor(value)
		const parts = Array.isArray(parsed) ? parsed : []
		if (parts.length !== 3 || parts[0] !== 1 || typeof parts[1] !== 'string' || !isCursorTimestamp(parts[1]) || !isPostgresBigint(parts[2]))
			throw new Error('shape')
		return [1, parts[1], parts[2]]
	} catch (error) {
		throw new ApiRequestError('cursor is invalid', { cause: error })
	}
}

const provenanceHistory = async (sql: SQL, url: URL): Promise<Response> => {
	const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 100
	const limit = Math.min(Math.max(requestedLimit, 1), 250)
	const cursor = parseProvenanceCursor(url.searchParams.get('cursor'))
	const values: Array<string | number> = []
	const cursorClause =
		cursor === undefined
			? ''
			: (() => {
					values.push(cursor[1], cursor[2])
					return `WHERE (started_at, id) < ($1::timestamptz, $2::bigint)`
				})()
	values.push(limit + 1)
	const [migrations, runRows] = await Promise.all([
		sql`SELECT schema_version, description, applied_at FROM augurscan_schema_migrations ORDER BY applied_at, schema_version`,
		sql.unsafe(
			`SELECT id::text, schema_version, app_version, abi_source_hash, application_source_hash,
				projection_source_hash, indexer_enabled, network_configuration, started_at, stopped_at,
				to_char(started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_started_at,
				count(*) OVER ()::integer AS remaining_total
			FROM indexer_runs ${cursorClause} ORDER BY started_at DESC, id DESC LIMIT $${values.length}`,
			values,
		),
	])
	const pageRows = runRows.slice(0, limit)
	const runs = pageRows.map((row: Record<string, unknown>) =>
		Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'remaining_total' && key !== 'cursor_started_at')),
	)
	const hasMore = runRows.length > limit
	const last = pageRows[pageRows.length - 1]
	return json({
		migrations,
		runs,
		runLimit: limit,
		runsTruncated: hasMore,
		remainingTotal: Number(runRows[0]?.['remaining_total'] ?? 0),
		nextCursor:
			hasMore && last !== undefined
				? encodeOpaqueCursor([1, cursorTimestamp(last['cursor_started_at']), String(last['id'])] satisfies ProvenanceCursor)
				: undefined,
	})
}

type HistoricalExportDataset = 'logs' | 'timeline' | 'reorgs'
type HistoricalExportCursor = readonly [
	version: 1,
	dataset: HistoricalExportDataset,
	chainId: number,
	canonical: CanonicalHistoryFilter,
	fromBlock: string,
	toBlock: string,
	snapshotBlock: string,
	snapshotHash: string,
	snapshotInvalidationId: string,
	snapshotTotal: string,
	abiSourceHash: string,
	applicationSourceHash: string,
	projectionSourceHash: string,
	lastKey: readonly string[],
]

const historicalExportKeyValid = (dataset: HistoricalExportDataset, key: readonly unknown[]): key is readonly string[] => {
	if (!key.every((item) => typeof item === 'string')) return false
	if (dataset === 'logs')
		return (
			key.length === 5 &&
			isPostgresBigint(key[0]) &&
			isPostgresIntegerString(key[1]) &&
			isPostgresIntegerString(key[2]) &&
			/^0x[0-9a-f]{64}$/.test(key[3] ?? '') &&
			/^0x[0-9a-f]{64}$/.test(key[4] ?? '')
		)
	if (dataset === 'timeline')
		return (
			key.length === 6 &&
			isPostgresBigint(key[0]) &&
			/^0x[0-9a-f]{64}$/.test(key[1] ?? '') &&
			/^0x[0-9a-f]{64}$/.test(key[2] ?? '') &&
			isPostgresIntegerString(key[3]) &&
			(key[4]?.length ?? 0) > 0 &&
			(key[5]?.length ?? 0) > 0
		)
	return key.length === 1 && isPostgresBigint(key[0])
}

export const parseHistoricalExportCursor = (value: string | null): HistoricalExportCursor | undefined => {
	if (value === null) return undefined
	try {
		const parsed = decodeOpaqueCursor(value)
		const parts = Array.isArray(parsed) ? parsed : []
		const dataset = parts[1]
		const canonical = parts[3]
		const lastKey = parts[13]
		if (
			parts.length !== 14 ||
			parts[0] !== 1 ||
			(dataset !== 'logs' && dataset !== 'timeline' && dataset !== 'reorgs') ||
			!isNonNegativeSafeInteger(parts[2]) ||
			(canonical !== 'canonical' && canonical !== 'orphaned' && canonical !== 'all') ||
			!isPostgresBigint(parts[4]) ||
			!isPostgresBigint(parts[5]) ||
			BigInt(parts[4]) > BigInt(parts[5]) ||
			!isPostgresBigint(parts[6]) ||
			typeof parts[7] !== 'string' ||
			!/^0x[0-9a-f]{64}$/.test(parts[7]) ||
			!isPostgresBigint(parts[8]) ||
			!isPostgresBigint(parts[9]) ||
			typeof parts[10] !== 'string' ||
			typeof parts[11] !== 'string' ||
			typeof parts[12] !== 'string' ||
			!Array.isArray(lastKey) ||
			!historicalExportKeyValid(dataset, lastKey)
		)
			throw new Error('shape')
		return [1, dataset, parts[2], canonical, parts[4], parts[5], parts[6], parts[7], parts[8], parts[9], parts[10], parts[11], parts[12], lastKey]
	} catch (error) {
		throw new ApiRequestError('export cursor is invalid', { cause: error })
	}
}

const historicalExportCursorFor = (snapshot: readonly unknown[], lastKey: readonly string[]): string => encodeOpaqueCursor([...snapshot, lastKey])

const historicalExport = async (sql: SQL, url: URL): Promise<Response> => {
	const chainId = integer(url.searchParams.get('chainId'), 'chainId')
	if (chainId === undefined) throw new ApiRequestError('chainId is required')
	const dataset = url.searchParams.get('dataset') ?? 'timeline'
	if (dataset !== 'logs' && dataset !== 'timeline' && dataset !== 'reorgs') throw new ApiRequestError('dataset must be logs, timeline, or reorgs')
	const fromBlock = postgresBigint(url.searchParams.get('fromBlock'), 'fromBlock') ?? '0'
	const toBlock = postgresBigint(url.searchParams.get('toBlock'), 'toBlock') ?? '9223372036854775807'
	if (BigInt(fromBlock) > BigInt(toBlock)) throw new ApiRequestError('fromBlock must not exceed toBlock')
	const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 5_000
	const limit = Math.min(Math.max(requestedLimit, 1), 50_000)
	if (url.searchParams.has('offset')) throw new ApiRequestError('offset pagination is unavailable for exports; follow x-augurscan-next-cursor')
	const canonical = dataset === 'reorgs' ? 'all' : canonicalHistoryFilter(url)
	const cursor = parseHistoricalExportCursor(url.searchParams.get('cursor'))
	if (cursor !== undefined && (cursor[1] !== dataset || cursor[2] !== chainId || cursor[3] !== canonical || cursor[4] !== fromBlock || cursor[5] !== toBlock))
		throw new ApiRequestError('export cursor does not match the requested dataset, chain, canonical scope, or block range')
	const snapshotRows = await sql`
		SELECT COALESCE(network.indexed_block, 0)::text AS snapshot_block,
			COALESCE(network.indexed_hash, ${`0x${'0'.repeat(64)}`}) AS snapshot_hash,
			COALESCE((SELECT max(id) FROM chain_reorganizations WHERE chain_id = ${chainId}), 0)::text AS invalidation_id,
			COALESCE(network.applied_abi_source_hash, 'unavailable') AS abi_source_hash,
			COALESCE(network.applied_application_source_hash, 'unavailable') AS application_source_hash,
			COALESCE(network.applied_projection_source_hash, 'unavailable') AS projection_source_hash
		FROM networks network WHERE network.chain_id = ${chainId}
	`
	const snapshotRow = snapshotRows[0]
	if (snapshotRow === undefined) throw new ApiRequestError('chainId is not configured')
	const currentSnapshotBlock = String(snapshotRow['snapshot_block'])
	const currentSnapshotHash = String(snapshotRow['snapshot_hash'])
	const currentInvalidationId = String(snapshotRow['invalidation_id'])
	const currentAbiHash = String(snapshotRow['abi_source_hash'])
	const currentApplicationHash = String(snapshotRow['application_source_hash'])
	const currentProjectionHash = String(snapshotRow['projection_source_hash'])
	if (cursor !== undefined) {
		const snapshotCanonicalRows = await sql`
			SELECT (${cursor[6]} = '0' AND ${cursor[7]} = ${`0x${'0'.repeat(64)}`}) OR EXISTS (
				SELECT 1 FROM blocks WHERE chain_id = ${chainId} AND number = ${cursor[6]} AND hash = ${cursor[7]} AND canonical
			) AS snapshot_canonical
		`
		if (
			snapshotCanonicalRows[0]?.['snapshot_canonical'] !== true ||
			currentInvalidationId !== cursor[8] ||
			currentAbiHash !== cursor[10] ||
			currentApplicationHash !== cursor[11] ||
			currentProjectionHash !== cursor[12]
		)
			throw new ApiConflictError('Export snapshot changed; restart pagination')
	}
	const snapshotBlock = cursor?.[6] ?? currentSnapshotBlock
	const snapshotHash = cursor?.[7] ?? currentSnapshotHash
	const snapshotInvalidationId = cursor?.[8] ?? currentInvalidationId
	const abiHash = cursor?.[10] ?? currentAbiHash
	const applicationHash = cursor?.[11] ?? currentApplicationHash
	const projectionHash = cursor?.[12] ?? currentProjectionHash
	const lastKey = cursor?.[13]
	const totalRows =
		cursor === undefined
			? dataset === 'logs'
				? await sql`
					SELECT count(*)::text AS total FROM logs log
					WHERE log.chain_id = ${chainId} AND log.block_number BETWEEN ${fromBlock} AND ${toBlock}
						AND log.block_number <= ${snapshotBlock} AND (${canonical === 'all'} OR log.canonical = ${canonical === 'canonical'})
				`
				: dataset === 'timeline'
					? await sql`
						SELECT count(*)::text AS total FROM protocol_timeline_entries timeline
						WHERE timeline.chain_id = ${chainId} AND timeline.block_number BETWEEN ${fromBlock} AND ${toBlock}
							AND timeline.block_number <= ${snapshotBlock} AND (${canonical === 'all'} OR timeline.canonical = ${canonical === 'canonical'})
					`
					: await sql`
						SELECT count(*)::text AS total FROM chain_reorganizations
						WHERE chain_id = ${chainId} AND id <= ${snapshotInvalidationId} AND (
							reason = 'start-boundary-advanced' OR COALESCE(previous_block, ancestor_block) BETWEEN ${fromBlock} AND ${toBlock}
						)
					`
			: []
	const snapshotTotal = cursor?.[9] ?? String(totalRows[0]?.['total'] ?? '0')
	const rows =
		dataset === 'logs'
			? await sql`
				SELECT log.chain_id, log.block_number::text, log.block_hash, log.tx_hash, log.log_index,
					log.transaction_index,
					log.emitter_address, log.topics, log.data, log.event_name, log.event_signature,
					log.arguments, log.display_arguments, log.argument_schema, log.summary,
					log.decode_status, log.decode_error, log.canonical, log.finalized, block.timestamp,
					COALESCE(interpretation_history.interpretations, '[]'::jsonb) AS interpretations,
					CASE WHEN log.canonical THEN 'canonical'
						WHEN invalidation.reason = 'chain-reorg' THEN 'chain-orphaned'
						WHEN invalidation.reason = 'manifest-reset' THEN 'manifest-superseded'
						WHEN invalidation.reason = 'start-boundary-advanced' THEN 'coverage-reset'
						WHEN invalidation.reason = 'abi-redecode' THEN 'decode-superseded'
						WHEN invalidation.reason = 'projection-rebuild' THEN 'projection-superseded'
						ELSE 'noncanonical-unknown' END AS evidence_status,
					invalidation.id::text AS invalidation_id, invalidation.reason AS invalidation_reason,
					invalidation.causes AS invalidation_causes
				FROM logs log JOIN blocks block ON block.chain_id = log.chain_id AND block.hash = log.block_hash
				LEFT JOIN LATERAL (
					SELECT jsonb_agg(
						jsonb_build_object(
							'interpretation_kind', interpretation.interpretation_kind,
							'interpretation_key', interpretation.interpretation_key,
							'indexer_run_id', interpretation.indexer_run_id::text,
							'schema_version', run.schema_version,
							'app_version', run.app_version,
							'abi_source_hash', interpretation.abi_source_hash,
							'application_source_hash', interpretation.application_source_hash,
							'projection_source_hash', interpretation.projection_source_hash,
							'interpretation', interpretation.interpretation,
							'interpreted_at', interpretation.interpreted_at
						)
						ORDER BY interpretation.interpreted_at, interpretation.indexer_run_id,
							interpretation.interpretation_kind, interpretation.interpretation_key
					) AS interpretations
					FROM log_interpretations interpretation
					JOIN indexer_runs run ON run.id = interpretation.indexer_run_id
					WHERE interpretation.chain_id = log.chain_id AND interpretation.block_hash = log.block_hash
						AND interpretation.tx_hash = log.tx_hash AND interpretation.log_index = log.log_index
				) interpretation_history ON true
				LEFT JOIN LATERAL (
					SELECT replacement.id, replacement.reason,
						COALESCE((SELECT jsonb_agg(cause.reason ORDER BY cause.reason) FROM history_invalidation_causes cause
							WHERE cause.invalidation_id = replacement.id), jsonb_build_array(replacement.reason)) AS causes
					FROM history_invalidation_occurrences occurrence
					JOIN chain_reorganizations replacement ON replacement.id = occurrence.invalidation_id
					WHERE occurrence.occurrence_kind = 'log' AND occurrence.chain_id = log.chain_id
						AND occurrence.block_hash = log.block_hash AND occurrence.occurrence_id = log.tx_hash
						AND occurrence.sub_index = log.log_index
					ORDER BY replacement.id DESC LIMIT 1
				) invalidation ON true
				WHERE log.chain_id = ${chainId} AND log.block_number BETWEEN ${fromBlock} AND ${toBlock}
					AND log.block_number <= ${snapshotBlock} AND (${canonical === 'all'} OR log.canonical = ${canonical === 'canonical'})
					AND (${lastKey === undefined} OR (log.block_number, log.transaction_index, log.log_index, log.block_hash, log.tx_hash) >
						(${lastKey?.[0] ?? '0'}::bigint, ${lastKey?.[1] ?? '0'}::integer, ${lastKey?.[2] ?? '0'}::integer,
							${lastKey?.[3] ?? `0x${'0'.repeat(64)}`}, ${lastKey?.[4] ?? `0x${'0'.repeat(64)}`}))
				ORDER BY log.block_number, log.transaction_index, log.log_index, log.block_hash, log.tx_hash
				LIMIT ${limit + 1}
			`
			: dataset === 'timeline'
				? await sql`
					SELECT timeline.chain_id, timeline.block_number::text, timeline.block_hash, timeline.tx_hash,
						timeline.log_index, timeline.entity_type, timeline.entity_identity, timeline.semantic_event_kind,
						timeline.summary_data, timeline.related_entities, timeline.source_contract, timeline.source_event,
						timeline.canonical, block.timestamp,
						CASE WHEN timeline.canonical THEN 'canonical'
							WHEN invalidation.reason = 'chain-reorg' THEN 'chain-orphaned'
							WHEN invalidation.reason = 'manifest-reset' THEN 'manifest-superseded'
							WHEN invalidation.reason = 'start-boundary-advanced' THEN 'coverage-reset'
							WHEN invalidation.reason = 'abi-redecode' THEN 'decode-superseded'
							WHEN invalidation.reason = 'projection-rebuild' THEN 'projection-superseded'
							ELSE 'noncanonical-unknown' END AS evidence_status,
						invalidation.id::text AS invalidation_id, invalidation.reason AS invalidation_reason,
						invalidation.causes AS invalidation_causes
					FROM protocol_timeline_entries timeline
					JOIN blocks block ON block.chain_id = timeline.chain_id AND block.hash = timeline.block_hash
					LEFT JOIN LATERAL (
						SELECT replacement.id, replacement.reason,
							COALESCE((SELECT jsonb_agg(cause.reason ORDER BY cause.reason) FROM history_invalidation_causes cause
								WHERE cause.invalidation_id = replacement.id), jsonb_build_array(replacement.reason)) AS causes
						FROM history_invalidation_occurrences occurrence
						JOIN chain_reorganizations replacement ON replacement.id = occurrence.invalidation_id
						WHERE occurrence.occurrence_kind = 'log' AND occurrence.chain_id = timeline.chain_id
							AND occurrence.block_hash = timeline.block_hash AND occurrence.occurrence_id = timeline.tx_hash
							AND occurrence.sub_index = timeline.log_index
						ORDER BY replacement.id DESC LIMIT 1
					) invalidation ON true
					WHERE timeline.chain_id = ${chainId} AND timeline.block_number BETWEEN ${fromBlock} AND ${toBlock}
						AND timeline.block_number <= ${snapshotBlock} AND (${canonical === 'all'} OR timeline.canonical = ${canonical === 'canonical'})
						AND (${lastKey === undefined} OR (timeline.block_number, timeline.block_hash, timeline.tx_hash, timeline.log_index,
							timeline.entity_type, timeline.entity_identity) > (${lastKey?.[0] ?? '0'}::bigint,
							${lastKey?.[1] ?? `0x${'0'.repeat(64)}`}, ${lastKey?.[2] ?? `0x${'0'.repeat(64)}`},
							${lastKey?.[3] ?? '0'}::integer, ${lastKey?.[4] ?? ''}, ${lastKey?.[5] ?? ''}))
					ORDER BY timeline.block_number, timeline.block_hash, timeline.tx_hash, timeline.log_index,
						timeline.entity_type, timeline.entity_identity
					LIMIT ${limit + 1}
				`
				: await sql`
					SELECT reorganization.id::text, reorganization.chain_id, reorganization.previous_block::text,
						reorganization.previous_hash, reorganization.ancestor_block::text, reorganization.ancestor_hash,
						reorganization.depth::text, reorganization.reason, reorganization.indexer_run_id::text,
						reorganization.abi_source_hash, reorganization.application_source_hash, reorganization.projection_source_hash,
						COALESCE((SELECT jsonb_agg(cause.reason ORDER BY cause.reason) FROM history_invalidation_causes cause
							WHERE cause.invalidation_id = reorganization.id), jsonb_build_array(reorganization.reason)) AS causes,
						COALESCE((SELECT jsonb_object_agg(counts.occurrence_kind, counts.occurrence_count ORDER BY counts.occurrence_kind)
							FROM (SELECT occurrence.occurrence_kind, count(*)::text AS occurrence_count
								FROM history_invalidation_occurrences occurrence WHERE occurrence.invalidation_id = reorganization.id
								GROUP BY occurrence.occurrence_kind) counts), '{}'::jsonb) AS occurrence_counts,
						reorganization.detected_at
					FROM chain_reorganizations reorganization
					WHERE reorganization.chain_id = ${chainId} AND reorganization.id <= ${snapshotInvalidationId}
						AND reorganization.id > ${lastKey?.[0] ?? '0'} AND (
						reorganization.reason = 'start-boundary-advanced'
						OR COALESCE(reorganization.previous_block, reorganization.ancestor_block) BETWEEN ${fromBlock} AND ${toBlock}
					)
					ORDER BY reorganization.id LIMIT ${limit + 1}
				`
	const truncated = rows.length > limit
	const exported = rows.slice(0, limit)
	const finalRow = exported[exported.length - 1] as Record<string, unknown> | undefined
	const exportedLastKey =
		finalRow === undefined
			? undefined
			: dataset === 'logs'
				? [
						String(finalRow['block_number']),
						String(finalRow['transaction_index']),
						String(finalRow['log_index']),
						String(finalRow['block_hash']),
						String(finalRow['tx_hash']),
					]
				: dataset === 'timeline'
					? [
							String(finalRow['block_number']),
							String(finalRow['block_hash']),
							String(finalRow['tx_hash']),
							String(finalRow['log_index']),
							String(finalRow['entity_type']),
							String(finalRow['entity_identity']),
						]
					: [String(finalRow['id'])]
	const snapshotPrefix = [
		1,
		dataset,
		chainId,
		canonical,
		fromBlock,
		toBlock,
		snapshotBlock,
		snapshotHash,
		snapshotInvalidationId,
		snapshotTotal,
		abiHash,
		applicationHash,
		projectionHash,
	] as const
	const nextCursor = truncated && exportedLastKey !== undefined ? historicalExportCursorFor(snapshotPrefix, exportedLastKey) : undefined
	const body = `${exported.map((row: Record<string, unknown>) => JSON.stringify(normalize(row))).join('\n')}${exported.length === 0 ? '' : '\n'}`
	return new Response(body, {
		headers: {
			'cache-control': 'no-store',
			'content-type': 'application/x-ndjson; charset=utf-8',
			'content-disposition': `attachment; filename="augurscan-${dataset}-${chainId}-${fromBlock}-${toBlock}.ndjson"`,
			'x-augurscan-returned': String(exported.length),
			'x-augurscan-truncated': String(truncated),
			'x-augurscan-snapshot-block': snapshotBlock,
			'x-augurscan-snapshot-hash': snapshotHash,
			'x-augurscan-snapshot-invalidation-id': snapshotInvalidationId,
			'x-augurscan-snapshot-total': snapshotTotal,
			'x-augurscan-abi-source-hash': abiHash,
			'x-augurscan-application-source-hash': applicationHash,
			'x-augurscan-projection-source-hash': projectionHash,
			...(nextCursor === undefined ? {} : { 'x-augurscan-next-cursor': nextCursor }),
		},
	})
}

const operationsAsOf = async (sql: SQL, chainId: number, atBlock?: string): Promise<Record<string, unknown>> => {
	const rows =
		atBlock === undefined
			? await sql`
				SELECT indexed_block::text AS "blockNumber", indexed_hash AS "blockHash",
					EXTRACT(EPOCH FROM indexed_timestamp)::bigint::text AS "blockTimestamp",
					indexed_block::text AS "indexedHead", '0'::text AS "historyDepthBlocks",
					observed_block::text AS "observedHead",
					GREATEST(COALESCE(observed_block, indexed_block, 0) - COALESCE(indexed_block, observed_block, 0), 0)::text AS "lagBlocks",
					COALESCE((SELECT max(reorganization.id) FROM chain_reorganizations reorganization
						WHERE reorganization.chain_id = network.chain_id), 0)::text AS "invalidationId",
					COALESCE(network.applied_abi_source_hash, 'unavailable') AS "abiSourceHash",
					COALESCE(network.applied_application_source_hash, 'unavailable') AS "applicationSourceHash",
					COALESCE(network.applied_projection_source_hash, 'unavailable') AS "projectionSourceHash",
					phase, last_success_at AS "lastSuccessfulRefresh", false AS historical
				FROM networks network WHERE chain_id = ${chainId}
			`
			: await sql`
				SELECT block.number::text AS "blockNumber", block.hash AS "blockHash",
					EXTRACT(EPOCH FROM block.timestamp)::bigint::text AS "blockTimestamp",
					network.indexed_block::text AS "indexedHead",
					GREATEST(COALESCE(network.indexed_block, block.number, 0) - block.number, 0)::text AS "historyDepthBlocks",
					network.observed_block::text AS "observedHead",
					GREATEST(COALESCE(network.observed_block, block.number, 0) - block.number, 0)::text AS "lagBlocks",
					COALESCE((SELECT max(reorganization.id) FROM chain_reorganizations reorganization
						WHERE reorganization.chain_id = network.chain_id), 0)::text AS "invalidationId",
					COALESCE(network.applied_abi_source_hash, 'unavailable') AS "abiSourceHash",
					COALESCE(network.applied_application_source_hash, 'unavailable') AS "applicationSourceHash",
					COALESCE(network.applied_projection_source_hash, 'unavailable') AS "projectionSourceHash",
					'historical'::text AS phase, network.last_success_at AS "lastSuccessfulRefresh", true AS historical
				FROM networks network JOIN blocks block ON block.chain_id = network.chain_id
				WHERE network.chain_id = ${chainId} AND block.number = ${atBlock} AND block.canonical
			`
	const row = rows[0]
	if (row === undefined) {
		const configured = await sql`SELECT 1 FROM networks WHERE chain_id = ${chainId}`
		if (configured.length === 0) throw new ApiRequestError('chainId is not configured')
		throw new ApiRequestError('atBlock is outside retained canonical coverage')
	}
	return {
		...row,
		blockNumber: row['blockNumber'] ?? '0',
		blockHash: row['blockHash'] ?? `0x${'0'.repeat(64)}`,
		blockTimestamp: row['blockTimestamp'] ?? '0',
		indexedHead: row['indexedHead'] ?? row['blockNumber'] ?? '0',
		historyDepthBlocks: row['historyDepthBlocks'] ?? '0',
		observedHead: row['observedHead'] ?? '0',
		invalidationId: row['invalidationId'] ?? '0',
		abiSourceHash: row['abiSourceHash'] ?? 'unavailable',
		applicationSourceHash: row['applicationSourceHash'] ?? 'unavailable',
		projectionSourceHash: row['projectionSourceHash'] ?? 'unavailable',
		availability: row['blockNumber'] === null || row['blockNumber'] === undefined ? 'Awaiting indexed evidence' : 'available',
	}
}

const operationsAsOfFromUrl = async (sql: SQL, chainId: number, url: URL): Promise<Record<string, unknown>> =>
	await operationsAsOf(sql, chainId, postgresBigint(url.searchParams.get('atBlock'), 'atBlock'))

type SnapshotCursorReference = { readonly parts: readonly unknown[]; readonly offset: number }

const operationsAsOfForContinuations = async (
	sql: SQL,
	chainId: number,
	cursors: readonly SnapshotCursorReference[],
	requestedAtBlock?: string,
): Promise<Record<string, unknown>> => {
	const first = cursors[0]
	const cursorBlock = first === undefined ? undefined : first.parts[first.offset]
	if (cursorBlock !== undefined && typeof cursorBlock !== 'string') throw new ApiRequestError('cursor snapshot block is invalid')
	if (requestedAtBlock !== undefined && cursorBlock !== undefined && requestedAtBlock !== cursorBlock)
		throw new ApiRequestError('cursor does not match the requested snapshot block')
	let asOf: Record<string, unknown>
	try {
		asOf = await operationsAsOf(sql, chainId, requestedAtBlock ?? cursorBlock)
	} catch (error) {
		if (cursorBlock !== undefined && error instanceof ApiRequestError && error.message === 'atBlock is outside retained canonical coverage')
			throw new ApiConflictError('Indexed state changed; restart pagination')
		throw error
	}
	for (const cursor of cursors)
		if (!snapshotBoundaryMatches(cursor.parts, cursor.offset, asOf)) throw new ApiConflictError('Indexed state changed; restart pagination')
	return asOf
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
	const snapshotBlock = String(asOf['blockNumber'])
	const rows = await sql`
		WITH identities AS (
			SELECT DISTINCT open_oracle_address, report_id FROM open_oracle_report_events
			WHERE chain_id = ${chainId} AND canonical AND block_number <= ${snapshotBlock}
		)
		SELECT identity.open_oracle_address, identity.report_id::text AS report_id,
			latest.event_name, latest.block_number::text AS block_number, latest.block_hash, latest.tx_hash, latest.log_index,
			round.report_data, round.round_number::text AS round_number,
			(SELECT count(*) FROM open_oracle_report_events evidence WHERE evidence.chain_id = ${chainId}
				AND evidence.open_oracle_address = identity.open_oracle_address AND evidence.report_id = identity.report_id
				AND evidence.canonical AND evidence.block_number <= ${snapshotBlock}
				AND evidence.event_name IN ('ReportSubmitted', 'ReportDisputed'))::integer AS observed_rounds,
			block.timestamp AS block_timestamp
		FROM identities identity
		JOIN LATERAL (
			SELECT * FROM open_oracle_report_events evidence WHERE evidence.chain_id = ${chainId}
				AND evidence.open_oracle_address = identity.open_oracle_address AND evidence.report_id = identity.report_id
				AND evidence.canonical AND evidence.block_number <= ${snapshotBlock}
			ORDER BY evidence.block_number DESC, evidence.log_index DESC, evidence.tx_hash DESC LIMIT 1
		) latest ON true
		LEFT JOIN LATERAL (
			SELECT * FROM open_oracle_report_events evidence WHERE evidence.chain_id = ${chainId}
				AND evidence.open_oracle_address = identity.open_oracle_address AND evidence.report_id = identity.report_id
				AND evidence.canonical AND evidence.block_number <= ${snapshotBlock}
				AND evidence.event_name IN ('ReportSubmitted', 'ReportDisputed')
			ORDER BY evidence.block_number DESC, evidence.log_index DESC, evidence.tx_hash DESC LIMIT 1
		) round ON true
		JOIN blocks block ON block.chain_id = ${chainId} AND block.hash = latest.block_hash
		WHERE (latest.block_number, latest.log_index, latest.tx_hash) < (${cursorBlock}::bigint, ${cursorLog}::integer, ${cursorTx})
		ORDER BY latest.block_number DESC, latest.log_index DESC, latest.tx_hash DESC LIMIT ${queryLimit}
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
	snapshotBlock: string,
	cursorBlock = snapshotBlock,
	cursorTx = `0x${'f'.repeat(64)}`,
	cursorLog = 2_147_483_647,
	queryLimit = 250,
) =>
	await sql`
		WITH games AS (
			SELECT DISTINCT game_address FROM escalation_game_events
			WHERE chain_id = ${chainId} AND canonical AND block_number <= ${snapshotBlock}
		)
		SELECT game.game_address,
			latest.event_name, latest.event_data, latest.block_number::text AS block_number, latest.block_hash, latest.tx_hash, latest.log_index,
			COALESCE((SELECT sum((event_data->>'attoRepAmount')::numeric)::text FROM escalation_game_events event
				WHERE event.chain_id = ${chainId} AND event.game_address = game.game_address AND event.canonical
				AND event.block_number <= ${snapshotBlock}
				AND event.event_name = 'DepositOnOutcome' AND event.event_data->>'outcome' = ${ESCALATION_OUTCOME.invalid}), '0') AS invalid_stake_atto_rep,
			COALESCE((SELECT sum((event_data->>'attoRepAmount')::numeric)::text FROM escalation_game_events event
				WHERE event.chain_id = ${chainId} AND event.game_address = game.game_address AND event.canonical
				AND event.block_number <= ${snapshotBlock}
				AND event.event_name = 'DepositOnOutcome' AND event.event_data->>'outcome' = ${ESCALATION_OUTCOME.no}), '0') AS no_stake_atto_rep,
			COALESCE((SELECT sum((event_data->>'attoRepAmount')::numeric)::text FROM escalation_game_events event
				WHERE event.chain_id = ${chainId} AND event.game_address = game.game_address AND event.canonical
				AND event.block_number <= ${snapshotBlock}
				AND event.event_name = 'DepositOnOutcome' AND event.event_data->>'outcome' = ${ESCALATION_OUTCOME.yes}), '0') AS yes_stake_atto_rep
		FROM games game JOIN LATERAL (
			SELECT * FROM escalation_game_events event WHERE event.chain_id = ${chainId} AND event.game_address = game.game_address
				AND event.canonical AND event.block_number <= ${snapshotBlock}
			ORDER BY event.block_number DESC, event.log_index DESC, event.tx_hash DESC LIMIT 1
		) latest ON true WHERE (latest.block_number, latest.log_index, latest.tx_hash) < (${cursorBlock}::bigint, ${cursorLog}::integer, ${cursorTx})
		ORDER BY latest.block_number DESC, latest.log_index DESC, latest.tx_hash DESC LIMIT ${queryLimit}
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
	const snapshotBlock = String(asOf['blockNumber'])
	const rows = await sql`
		WITH auctions AS (
			SELECT DISTINCT auction_address FROM truth_auction_events
			WHERE chain_id = ${chainId} AND canonical AND block_number <= ${snapshotBlock}
		)
		SELECT auction.auction_address,
			started.event_data AS start_data, finalized.event_data AS final_data,
			latest.event_name, latest.block_number::text AS block_number, latest.block_hash, latest.tx_hash, latest.log_index,
			(SELECT count(*) FROM truth_auction_events event WHERE event.chain_id = ${chainId}
				AND event.auction_address = auction.auction_address AND event.canonical AND event.block_number <= ${snapshotBlock}
				AND event.event_name = 'BidSubmitted')::integer AS bid_count,
			(SELECT count(DISTINCT event.event_data->>'bidder') FROM truth_auction_events event WHERE event.chain_id = ${chainId}
				AND event.auction_address = auction.auction_address AND event.canonical AND event.block_number <= ${snapshotBlock}
				AND event.event_name = 'BidSubmitted')::integer AS bidder_count,
			(SELECT count(*) FROM truth_auction_events event WHERE event.chain_id = ${chainId}
				AND event.auction_address = auction.auction_address AND event.canonical AND event.block_number <= ${snapshotBlock}
				AND event.event_name = 'BidSettled')::integer AS settlement_count
		FROM auctions auction
		JOIN LATERAL (SELECT * FROM truth_auction_events event WHERE event.chain_id = ${chainId}
			AND event.auction_address = auction.auction_address AND event.canonical AND event.block_number <= ${snapshotBlock}
			ORDER BY event.block_number DESC, event.log_index DESC, event.tx_hash DESC LIMIT 1) latest ON true
		LEFT JOIN LATERAL (SELECT * FROM truth_auction_events event WHERE event.chain_id = ${chainId}
			AND event.auction_address = auction.auction_address AND event.canonical AND event.block_number <= ${snapshotBlock}
			AND event.event_name = 'AuctionStarted'
			ORDER BY event.block_number DESC, event.log_index DESC, event.tx_hash DESC LIMIT 1) started ON true
		LEFT JOIN LATERAL (SELECT * FROM truth_auction_events event WHERE event.chain_id = ${chainId}
			AND event.auction_address = auction.auction_address AND event.canonical AND event.block_number <= ${snapshotBlock}
			AND event.event_name = 'AuctionFinalized'
			ORDER BY event.block_number DESC, event.log_index DESC, event.tx_hash DESC LIMIT 1) finalized ON true
		WHERE (latest.block_number, latest.log_index, latest.tx_hash) < (${cursorBlock}::bigint, ${cursorLog}::integer, ${cursorTx})
		ORDER BY latest.block_number DESC, latest.log_index DESC, latest.tx_hash DESC LIMIT ${queryLimit}
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
	options: { poolAddress?: string; vaultAddress?: string; poolAfter?: string; vaultAfter?: string; limit?: number; snapshotBlock?: string } = {},
) => {
	const queryLimit = (options.limit ?? 250) + 1
	const snapshotBlock = options.snapshotBlock ?? '9223372036854775807'
	const [pools, vaults, liquidations, approvalEvents, totals] = await Promise.all([
		sql`
			WITH identities AS (
				SELECT DISTINCT pool_address FROM pools
				WHERE chain_id = ${chainId} AND canonical AND block_number <= ${snapshotBlock}
			)
			SELECT identity.pool_address, snapshot.block_number::text AS block_number, snapshot.block_hash,
				snapshot.block_timestamp, snapshot.read_status, snapshot.read_result, snapshot.read_failure_reason,
				snapshot.source_method, snapshot.observed_at, snapshot.indexer_run_id::text AS indexer_run_id,
				snapshot.abi_source_hash, snapshot.application_source_hash, snapshot.projection_source_hash
			FROM identities identity LEFT JOIN LATERAL (
				SELECT state.* FROM entity_state_snapshots state
				JOIN blocks block ON block.chain_id = state.chain_id AND block.hash = state.block_hash AND block.canonical
				WHERE state.chain_id = ${chainId} AND state.entity_type = 'pool'
					AND state.entity_identity = identity.pool_address AND state.canonical AND state.block_number <= ${snapshotBlock}
				ORDER BY state.block_number DESC, state.observed_at DESC LIMIT 1
			) snapshot ON true
			WHERE (${options.poolAddress ?? null}::text IS NULL OR identity.pool_address = ${options.poolAddress ?? null})
				AND (${options.poolAfter ?? null}::text IS NULL OR identity.pool_address > ${options.poolAfter ?? null})
			ORDER BY identity.pool_address LIMIT ${queryLimit}
		`,
		sql`
			WITH identities AS (
				SELECT DISTINCT pool_address, vault_address FROM vault_snapshots
				WHERE chain_id = ${chainId} AND canonical AND block_number <= ${snapshotBlock}
			)
			SELECT identity.pool_address, identity.vault_address,
				vault.block_number::text AS block_number, vault.block_hash, vault.block_timestamp,
				vault.read_status, vault.read_result, vault.read_failure_reason, vault.source_method, vault.observed_at,
				vault.indexer_run_id::text AS indexer_run_id, vault.abi_source_hash,
				vault.application_source_hash, vault.projection_source_hash,
				pool.read_result AS pool_read_result, pool.read_status AS pool_read_status,
				pool.block_number::text AS pool_block_number, pool.block_hash AS pool_block_hash,
				pool.block_timestamp AS pool_block_timestamp, pool.indexer_run_id::text AS pool_indexer_run_id,
				pool.abi_source_hash AS pool_abi_source_hash, pool.application_source_hash AS pool_application_source_hash,
				pool.projection_source_hash AS pool_projection_source_hash
			FROM identities identity
			LEFT JOIN LATERAL (
				SELECT state.* FROM entity_state_snapshots state
				JOIN blocks block ON block.chain_id = state.chain_id AND block.hash = state.block_hash AND block.canonical
				WHERE state.chain_id = ${chainId} AND state.entity_type = 'vault'
					AND state.entity_identity = identity.pool_address || ':' || identity.vault_address
					AND state.canonical AND state.block_number <= ${snapshotBlock}
				ORDER BY state.block_number DESC, state.observed_at DESC LIMIT 1
			) vault ON true
			LEFT JOIN LATERAL (
				SELECT state.* FROM entity_state_snapshots state
				JOIN blocks block ON block.chain_id = state.chain_id AND block.hash = state.block_hash AND block.canonical
				WHERE state.chain_id = ${chainId} AND state.entity_type = 'pool'
					AND state.entity_identity = identity.pool_address AND state.canonical AND state.block_number <= ${snapshotBlock}
				ORDER BY state.block_number DESC, state.observed_at DESC LIMIT 1
			) pool ON true
			WHERE (${options.poolAddress ?? null}::text IS NULL OR identity.pool_address = ${options.poolAddress ?? null})
				AND (${options.vaultAddress ?? null}::text IS NULL OR identity.vault_address = ${options.vaultAddress ?? null})
				AND (${options.vaultAfter ?? null}::text IS NULL OR identity.pool_address || ':' || identity.vault_address > ${options.vaultAfter ?? null})
			ORDER BY identity.pool_address, identity.vault_address LIMIT ${queryLimit}
		`,
		sql`SELECT * FROM protocol_timeline_entries WHERE chain_id = ${chainId} AND canonical
			AND semantic_event_kind = 'VaultLiquidated' AND block_number <= ${snapshotBlock}
			ORDER BY block_number DESC, log_index DESC, tx_hash DESC, block_hash DESC LIMIT 25`,
		sql`
			SELECT approval.*, COALESCE(approval.receiver_vault, installed.receiver_vault) AS receiver_vault,
				block.timestamp AS block_timestamp
			FROM liquidation_approval_events approval
			JOIN blocks block ON block.chain_id = approval.chain_id AND block.hash = approval.block_hash AND block.canonical
			LEFT JOIN LATERAL (
				SELECT candidate.receiver_vault, candidate.event_data FROM liquidation_approval_events candidate
				WHERE candidate.chain_id = approval.chain_id AND candidate.approval_identity = approval.approval_identity
					AND candidate.registry_address = approval.registry_address
					AND candidate.event_name = 'LiquidationApprovalSet' AND candidate.canonical
					AND candidate.block_number <= ${snapshotBlock}
				ORDER BY candidate.block_number DESC, candidate.transaction_index DESC, candidate.log_index DESC,
					candidate.tx_hash DESC, candidate.block_hash DESC LIMIT 1
			) installed ON true
			WHERE approval.chain_id = ${chainId} AND approval.canonical AND approval.block_number <= ${snapshotBlock}
				AND (${options.poolAddress ?? null}::text IS NULL OR COALESCE(approval.event_data->>'securityPool', installed.event_data->>'securityPool') = ${options.poolAddress ?? null})
				AND (${options.vaultAddress ?? null}::text IS NULL OR COALESCE(approval.receiver_vault, installed.receiver_vault) = ${options.vaultAddress ?? null}
					OR COALESCE(approval.event_data->>'targetVault', installed.event_data->>'targetVault') = ${options.vaultAddress ?? null})
			ORDER BY approval.block_number DESC, approval.transaction_index DESC, approval.log_index DESC,
				approval.tx_hash DESC, approval.block_hash DESC, approval.registry_address DESC LIMIT 100
		`,
		sql`
			SELECT
				(SELECT count(DISTINCT pool_address) FROM pools
					WHERE chain_id = ${chainId} AND canonical AND block_number <= ${snapshotBlock}
						AND (${options.poolAddress ?? null}::text IS NULL OR pool_address = ${options.poolAddress ?? null}))::integer AS pool_total,
				(SELECT count(*) FROM (
					SELECT DISTINCT pool_address, vault_address FROM vault_snapshots
					WHERE chain_id = ${chainId} AND canonical AND block_number <= ${snapshotBlock}
						AND (${options.poolAddress ?? null}::text IS NULL OR pool_address = ${options.poolAddress ?? null})
						AND (${options.vaultAddress ?? null}::text IS NULL OR vault_address = ${options.vaultAddress ?? null})
				) identities)::integer AS vault_total
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
			protocol_state: badDebt > 0n ? 'bad-debt' : priceRequired && !priceValid ? 'unavailable' : String(state['systemState'] ?? '0'),
			scanner_severity: badDebt > 0n ? 'critical' : priceRequired && !priceValid ? 'unavailable' : 'healthy',
			scanner_reason:
				badDebt > 0n
					? 'Pool has recorded bad debt'
					: priceRequired && !priceValid
						? 'Accounting price is invalid at the tagged evidence block; capacity is not usable for risk decisions'
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
		const badDebt = BigInt(String(state['badDebtAttoEth'] ?? '0'))
		if (badDebt > 0n)
			return {
				...row,
				read_result: state,
				price_provenance: price,
				snapshot_evidence: snapshotEvidence,
				protocol_state: 'bad-debt',
				scanner_severity: 'critical',
				scanner_reason: 'Vault has recorded bad debt',
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
			poolTotal: Number(totals[0]?.['pool_total'] ?? 0),
			poolHasMore: pools.length > (options.limit ?? 250),
			poolNextCursor: pools.length > (options.limit ?? 250) && lastPool !== undefined ? String(lastPool['pool_address']) : undefined,
			vaultTotal: Number(totals[0]?.['vault_total'] ?? 0),
			vaultHasMore: vaults.length > (options.limit ?? 250),
			vaultNextCursor:
				vaults.length > (options.limit ?? 250) && lastVault !== undefined
					? `${String(lastVault['pool_address'])}:${String(lastVault['vault_address'])}`
					: undefined,
		},
	}
}

const forkCatalogTotal = async (sql: SQL, chainId: number, snapshotBlock: string): Promise<number> => {
	const rows = await sql`
		SELECT count(DISTINCT universe_identity)::integer AS total
		FROM fork_migration_events
		WHERE chain_id = ${chainId} AND canonical AND event_name = 'UniverseForked'
			AND event_data ? 'universeId' AND block_number <= ${snapshotBlock}
	`
	return Number(rows[0]?.['total'] ?? 0)
}

const forkCatalogData = async (
	sql: SQL,
	chainId: number,
	cursorBlock: string,
	cursorTx = `0x${'f'.repeat(64)}`,
	cursorLog = 2_147_483_647,
	queryLimit = 100,
	snapshotBlock = cursorBlock,
) =>
	await sql`
		WITH roots AS (
			SELECT DISTINCT ON (universe_identity) * FROM fork_migration_events
			WHERE chain_id = ${chainId} AND canonical AND event_name = 'UniverseForked'
				AND event_data ? 'universeId' AND block_number <= ${snapshotBlock}
			ORDER BY universe_identity, block_number DESC, log_index DESC
		)
		SELECT root.universe_identity, root.event_name, root.event_data,
			root.block_number::text, root.block_hash, root.tx_hash, root.log_index,
			count(DISTINCT related.event_data->>'childUniverseId') FILTER (WHERE related.event_data ? 'childUniverseId')::integer AS child_count,
			count(DISTINCT related.event_data->>'migrator') FILTER (WHERE related.event_data ? 'migrator')::integer AS migrator_count,
			COALESCE(sum((related.event_data->>'amountAttoRep')::numeric) FILTER
				(WHERE related.event_name = 'MigrationRepSplit' AND related.event_data ? 'amountAttoRep'), 0)::text AS migrated_atto_rep,
			COALESCE(sum((related.event_data->>'amountAttoRep')::numeric) FILTER
				(WHERE related.event_name = 'RepBurned' AND related.event_data ? 'amountAttoRep'), 0)::text AS burned_atto_rep,
			count(*) FILTER (WHERE related.event_name IN ('SecurityPoolForkSnapshot', 'ChildPoolLinked', 'PoolHeldRepSweptToChild', 'VaultMigrationCheckpoint'))::integer AS pool_migration_events,
			count(*) FILTER (WHERE related.event_name IN ('EscalationMigrationEntitlementInitialized', 'EscalationMigrationEntitlementMaterialized'))::integer AS obligation_events
		FROM roots root
		LEFT JOIN fork_migration_events related ON related.chain_id = root.chain_id AND related.canonical
			AND related.block_number <= ${snapshotBlock} AND (
			related.universe_identity = root.universe_identity OR related.event_data->>'universeId' = root.universe_identity
			OR EXISTS (SELECT 1 FROM pools pool WHERE pool.chain_id = root.chain_id AND pool.canonical
				AND pool.block_number <= ${snapshotBlock}
				AND pool.universe_id::text = root.universe_identity
				AND (related.universe_identity = pool.pool_address OR related.event_data->>'parent' = pool.pool_address
					OR related.event_data->>'parentPool' = pool.pool_address OR related.event_data->>'securityPool' = pool.pool_address))
		)
		WHERE (root.block_number, root.log_index, root.tx_hash) < (${cursorBlock}::bigint, ${cursorLog}::integer, ${cursorTx})
		GROUP BY root.chain_id, root.universe_identity, root.event_name, root.event_data, root.block_number,
			root.block_hash, root.tx_hash, root.log_index
		ORDER BY root.block_number DESC, root.log_index DESC, root.tx_hash DESC LIMIT ${queryLimit}
	`

const operationsResponse = async (sql: SQL, url: URL): Promise<Response> => {
	const chainId = integer(url.searchParams.get('chainId'), 'chainId')
	if (chainId === undefined) throw new ApiRequestError('chainId is required')
	const asOf = await operationsAsOfFromUrl(sql, chainId, url)
	const [reports, escalations, auctions, risk, prices, recentChanges, forks, totals] = await Promise.all([
		reportCatalogData(sql, chainId, asOf),
		escalationCatalogData(sql, chainId, String(asOf['blockNumber'])),
		auctionCatalogData(sql, chainId, asOf),
		riskCatalogData(sql, chainId, { snapshotBlock: String(asOf['blockNumber']) }),
		sql`SELECT coordinator_address AS source_contract, event_name AS source_event, rep_per_eth_1e18::text AS value,
			block_number::text AS block_number, settlement_timestamp AS observed_timestamp
			FROM rep_eth_price_snapshots WHERE chain_id = ${chainId} AND canonical AND block_number <= ${String(asOf['blockNumber'])}
			ORDER BY block_number DESC, log_index DESC, tx_hash DESC, block_hash DESC LIMIT 1`,
		sql`SELECT timeline.*, block.timestamp AS block_timestamp FROM protocol_timeline_entries timeline
			JOIN blocks block ON block.chain_id = timeline.chain_id AND block.hash = timeline.block_hash
			WHERE timeline.chain_id = ${chainId} AND timeline.canonical AND timeline.block_number <= ${String(asOf['blockNumber'])}
			ORDER BY timeline.block_number DESC, timeline.log_index DESC, timeline.tx_hash DESC,
				timeline.block_hash DESC, timeline.entity_type DESC, timeline.entity_identity DESC LIMIT 30`,
		forkCatalogData(sql, chainId, String(asOf['blockNumber'])),
		sql`SELECT
			(SELECT count(DISTINCT (open_oracle_address, report_id)) FROM open_oracle_report_events
				WHERE chain_id = ${chainId} AND canonical AND block_number <= ${String(asOf['blockNumber'])})::integer AS reports,
			(SELECT count(DISTINCT game_address) FROM escalation_game_events
				WHERE chain_id = ${chainId} AND canonical AND block_number <= ${String(asOf['blockNumber'])})::integer AS escalations,
			(SELECT count(DISTINCT auction_address) FROM truth_auction_events
				WHERE chain_id = ${chainId} AND canonical AND block_number <= ${String(asOf['blockNumber'])})::integer AS auctions,
			(SELECT count(DISTINCT pool_address) FROM pools
				WHERE chain_id = ${chainId} AND canonical AND block_number <= ${String(asOf['blockNumber'])})::integer AS pools,
			(SELECT count(DISTINCT (pool_address, vault_address)) FROM vault_snapshots
				WHERE chain_id = ${chainId} AND canonical AND block_number <= ${String(asOf['blockNumber'])})::integer AS vaults,
			(SELECT count(DISTINCT pair_address) FROM amm_markets
				WHERE chain_id = ${chainId} AND canonical AND block_number <= ${String(asOf['blockNumber'])})::integer AS markets,
			(SELECT count(*) FROM chain_reorganizations WHERE chain_id = ${chainId})::integer AS reorganizations`,
	])
	return json({ chainId, asOf, data: { reports, escalations, auctions, risk, prices, recentChanges, forks, totals: totals[0] } })
}

const domainCatalogResponse = async (sql: SQL, url: URL, domain: 'reports' | 'escalations' | 'auctions' | 'risk' | 'forks'): Promise<Response> => {
	const chainId = integer(url.searchParams.get('chainId'), 'chainId')
	if (chainId === undefined) throw new ApiRequestError('chainId is required')
	if (domain === 'risk') {
		const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 100
		const limit = Math.min(Math.max(requestedLimit, 1), 250)
		const poolCursor = parseRiskCursor(url.searchParams.get('poolCursor'), chainId, 'pool')
		const vaultCursor = parseRiskCursor(url.searchParams.get('vaultCursor'), chainId, 'vault')
		const cursors = [poolCursor, vaultCursor].flatMap((cursor) => (cursor === undefined ? [] : [{ parts: cursor, offset: 2 }]))
		const asOf = await operationsAsOfForContinuations(sql, chainId, cursors, postgresBigint(url.searchParams.get('atBlock'), 'atBlock'))
		const poolAfter = poolCursor?.[8]
		const vaultAfter = vaultCursor?.[8]
		const data = await riskCatalogData(sql, chainId, { limit, poolAfter, vaultAfter, snapshotBlock: String(asOf['blockNumber']) })
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
	const cursor = protocolCursorForRequest(url, chainId, `${domain}-catalog`, 'catalog')
	const asOf = await operationsAsOfForContinuations(sql, chainId, cursor === undefined ? [] : [{ parts: cursor, offset: 3 }])
	const page = detailPage(url, chainId, `${domain}-catalog`, 'catalog', asOf, cursor)
	const cursorBlock = page.cursor?.[9] ?? String(asOf['blockNumber'])
	const cursorTx = page.cursor?.[10] ?? `0x${'f'.repeat(64)}`
	const cursorLog = page.cursor?.[11] ?? 2_147_483_647
	const rows =
		domain === 'reports'
			? await reportCatalogData(sql, chainId, asOf, cursorBlock, cursorTx, cursorLog, page.queryLimit)
			: domain === 'escalations'
				? await escalationCatalogData(sql, chainId, String(asOf['blockNumber']), cursorBlock, cursorTx, cursorLog, page.queryLimit)
				: domain === 'auctions'
					? await auctionCatalogData(sql, chainId, asOf, cursorBlock, cursorTx, cursorLog, page.queryLimit)
					: await forkCatalogData(sql, chainId, cursorBlock, cursorTx, cursorLog, page.queryLimit, String(asOf['blockNumber']))
	const pageData = paged(rows, page.limit, (row) => protocolCursorFor(chainId, `${domain}-catalog`, 'catalog', asOf, row))
	return json({
		chainId,
		asOf,
		data: domain === 'forks' ? { ...pageData, total: await forkCatalogTotal(sql, chainId, String(asOf['blockNumber'])) } : pageData,
	})
}

const snapshotBoundaryMatches = (parts: readonly unknown[], offset: number, asOf: Record<string, unknown>): boolean =>
	parts[offset] === String(asOf['blockNumber']) &&
	parts[offset + 1] === String(asOf['blockHash']) &&
	parts[offset + 2] === String(asOf['invalidationId']) &&
	parts[offset + 3] === String(asOf['abiSourceHash']) &&
	parts[offset + 4] === String(asOf['applicationSourceHash']) &&
	parts[offset + 5] === String(asOf['projectionSourceHash'])

const snapshotBoundary = (asOf: Record<string, unknown>): readonly [string, string, string, string, string, string] => [
	String(asOf['blockNumber']),
	String(asOf['blockHash']),
	String(asOf['invalidationId']),
	String(asOf['abiSourceHash']),
	String(asOf['applicationSourceHash']),
	String(asOf['projectionSourceHash']),
]

type ProtocolCursor = readonly [number, string, string, string, string, string, string, string, string, string, string, number]

type RiskCursor = readonly [number, 'pool' | 'vault', string, string, string, string, string, string, string]
const parseRiskCursor = (value: string | null, chainId: number, kind: 'pool' | 'vault'): RiskCursor | undefined => {
	if (value === null) return undefined
	let parts: unknown[]
	try {
		const parsed = decodeOpaqueCursor(value)
		parts = Array.isArray(parsed) ? parsed : []
		if (
			parts.length !== 9 ||
			!isNonNegativeSafeInteger(parts[0]) ||
			(parts[1] !== 'pool' && parts[1] !== 'vault') ||
			!isPostgresBigint(parts[2]) ||
			typeof parts[3] !== 'string' ||
			!/^0x[0-9a-f]{64}$/.test(parts[3]) ||
			!isPostgresBigint(parts[4]) ||
			!parts.slice(5, 8).every((part) => typeof part === 'string') ||
			typeof parts[8] !== 'string' ||
			(kind === 'pool' ? !/^0x[0-9a-f]{40}$/.test(parts[8]) : !/^0x[0-9a-f]{40}:0x[0-9a-f]{40}$/.test(parts[8]))
		)
			throw new Error('shape')
	} catch (error) {
		throw new ApiRequestError(`${kind}Cursor is invalid`, { cause: error })
	}
	if (parts[0] !== chainId || parts[1] !== kind) throw new ApiRequestError(`${kind}Cursor does not match the requested collection`)
	return parts as [number, 'pool' | 'vault', string, string, string, string, string, string, string]
}

const riskCursorFor = (chainId: number, kind: 'pool' | 'vault', asOf: Record<string, unknown>, key: string): string =>
	encodeOpaqueCursor([chainId, kind, ...snapshotBoundary(asOf), key] satisfies RiskCursor)

const parseProtocolCursor = (value: string | null): ProtocolCursor | undefined => {
	if (value === null) return undefined
	try {
		const parsed = decodeOpaqueCursor(value)
		const parts = Array.isArray(parsed) ? parsed : []
		if (
			parts.length !== 12 ||
			!isNonNegativeSafeInteger(parts[0]) ||
			typeof parts[1] !== 'string' ||
			typeof parts[2] !== 'string' ||
			!isPostgresBigint(parts[3]) ||
			typeof parts[4] !== 'string' ||
			!/^0x[0-9a-f]{64}$/.test(parts[4]) ||
			!isPostgresBigint(parts[5]) ||
			!parts.slice(6, 9).every((part) => typeof part === 'string') ||
			!isPostgresBigint(parts[9]) ||
			typeof parts[10] !== 'string' ||
			!/^0x[0-9a-f]{64}$/.test(parts[10]) ||
			!isPostgresInteger(parts[11]) ||
			BigInt(parts[9]) > BigInt(parts[3])
		)
			throw new Error('shape')
		return parts as [number, string, string, string, string, string, string, string, string, string, string, number]
	} catch (error) {
		throw new ApiRequestError('cursor is invalid', { cause: error })
	}
}

const protocolCursorForRequest = (url: URL, chainId: number, domain: string, identity: string): ProtocolCursor | undefined => {
	const cursor = parseProtocolCursor(url.searchParams.get('cursor'))
	if (cursor !== undefined && (cursor[0] !== chainId || cursor[1] !== domain || cursor[2] !== identity))
		throw new ApiRequestError('cursor does not match the requested entity')
	return cursor
}

const protocolCursorFor = (chainId: number, domain: string, identity: string, asOf: Record<string, unknown>, row: Record<string, unknown>): string =>
	encodeOpaqueCursor([
		chainId,
		domain,
		identity,
		...snapshotBoundary(asOf),
		String(row['block_number']),
		String(row['tx_hash']),
		Number(row['log_index']),
	] satisfies ProtocolCursor)

const detailPage = (
	url: URL,
	chainId: number,
	domain: string,
	identity: string,
	asOf: Record<string, unknown>,
	cursor = protocolCursorForRequest(url, chainId, domain, identity),
) => {
	const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 100
	const limit = Math.min(Math.max(requestedLimit, 1), 250)
	if (cursor !== undefined && !snapshotBoundaryMatches(cursor, 3, asOf)) throw new ApiConflictError('Indexed state changed; restart pagination')
	return { limit, queryLimit: limit + 1, cursor }
}

type TimelineCatalogCursor = readonly [number, string, string, string, string, string, string, string, string, number, string, string, string, string, 'v2']

const parseTimelineCatalogCursor = (value: string | null, chainId: number, filterIdentity: string): TimelineCatalogCursor | undefined => {
	if (value === null) return undefined
	let parts: unknown[]
	try {
		const parsed = decodeOpaqueCursor(value)
		parts = Array.isArray(parsed) ? parsed : []
		if (
			parts.length !== 15 ||
			!isNonNegativeSafeInteger(parts[0]) ||
			typeof parts[1] !== 'string' ||
			!isPostgresBigint(parts[2]) ||
			typeof parts[3] !== 'string' ||
			!/^0x[0-9a-f]{64}$/.test(parts[3]) ||
			!isPostgresBigint(parts[4]) ||
			!parts.slice(5, 8).every((part) => typeof part === 'string') ||
			!isPostgresBigint(parts[8]) ||
			!isPostgresInteger(parts[9]) ||
			typeof parts[10] !== 'string' ||
			!/^0x[0-9a-f]{64}$/.test(parts[10]) ||
			typeof parts[11] !== 'string' ||
			!/^0x[0-9a-f]{64}$/.test(parts[11]) ||
			typeof parts[12] !== 'string' ||
			typeof parts[13] !== 'string' ||
			parts[14] !== 'v2'
		)
			throw new Error('shape')
	} catch (error) {
		throw new ApiRequestError('cursor is invalid', { cause: error })
	}
	if (parts[0] !== chainId || parts[1] !== filterIdentity) throw new ApiRequestError('cursor does not match the requested timeline filters')
	return [
		Number(parts[0]),
		String(parts[1]),
		String(parts[2]),
		String(parts[3]),
		String(parts[4]),
		String(parts[5]),
		String(parts[6]),
		String(parts[7]),
		String(parts[8]),
		Number(parts[9]),
		String(parts[10]),
		String(parts[11]),
		String(parts[12]),
		String(parts[13]),
		'v2',
	]
}

const timelineCatalogCursorFor = (chainId: number, filterIdentity: string, asOf: Record<string, unknown>, row: Record<string, unknown>): string =>
	encodeOpaqueCursor([
		chainId,
		filterIdentity,
		...snapshotBoundary(asOf),
		String(row['block_number']),
		Number(row['log_index']),
		String(row['tx_hash']),
		String(row['block_hash']),
		String(row['entity_type']),
		String(row['entity_identity']),
		'v2',
	] satisfies TimelineCatalogCursor)

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
	const cursor = protocolCursorForRequest(url, chainId, 'report', identity)
	const decisionUrl = new URL(url)
	decisionUrl.searchParams.delete('cursor')
	decisionUrl.searchParams.delete('limit')
	const decisionCursorValue = url.searchParams.get('decisionCursor')
	const decisionLimitValue = url.searchParams.get('decisionLimit')
	if (decisionCursorValue !== null) decisionUrl.searchParams.set('cursor', decisionCursorValue)
	if (decisionLimitValue !== null) decisionUrl.searchParams.set('limit', decisionLimitValue)
	const decisionCursor = protocolCursorForRequest(decisionUrl, chainId, 'report-decisions', identity)
	const asOf = await operationsAsOfForContinuations(
		sql,
		chainId,
		[cursor, decisionCursor].flatMap((item) => (item === undefined ? [] : [{ parts: item, offset: 3 }])),
	)
	const page = detailPage(url, chainId, 'report', identity, asOf, cursor)
	const decisionPage = detailPage(decisionUrl, chainId, 'report-decisions', identity, asOf, decisionCursor)
	const cursorBlock = page.cursor?.[9] ?? String(asOf['blockNumber'])
	const cursorTx = page.cursor?.[10] ?? `0x${'f'.repeat(64)}`
	const cursorLog = page.cursor?.[11] ?? 2_147_483_647
	const rows = await sql`
		SELECT event.*, block.timestamp AS block_timestamp FROM open_oracle_report_events event
		JOIN blocks block ON block.chain_id = event.chain_id AND block.hash = event.block_hash
		WHERE event.chain_id = ${chainId} AND event.open_oracle_address = ${openOracleAddress}
			AND event.report_id = ${reportId} AND event.canonical
			AND (event.block_number, event.log_index, event.tx_hash) < (${cursorBlock}::bigint, ${cursorLog}::integer, ${cursorTx})
		ORDER BY event.block_number DESC, event.log_index DESC, event.tx_hash DESC LIMIT ${page.queryLimit}
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
	const decisionCursorBlock = decisionPage.cursor?.[9] ?? String(asOf['blockNumber'])
	const decisionCursorTx = decisionPage.cursor?.[10] ?? `0x${'f'.repeat(64)}`
	const decisionCursorLog = decisionPage.cursor?.[11] ?? 2_147_483_647
	const coordinatorDecisions = await sql`
		WITH coordinators AS (
			SELECT DISTINCT request.emitter_address
			FROM open_oracle_report_events report
			JOIN logs request ON request.chain_id = report.chain_id AND request.block_hash = report.block_hash
				AND request.tx_hash = report.tx_hash AND request.canonical
			WHERE report.chain_id = ${chainId} AND report.open_oracle_address = ${openOracleAddress}
				AND report.report_id = ${reportId} AND report.canonical AND report.event_name = 'ReportSubmitted'
				AND request.event_name = 'PriceRequested' AND request.arguments->>'reportId' = ${reportId}
		)
		SELECT log.block_number::text, log.block_hash, log.tx_hash, log.log_index, log.emitter_address,
			log.event_name, log.arguments, log.summary, block.timestamp AS block_timestamp
		FROM logs log JOIN blocks block ON block.chain_id = log.chain_id AND block.hash = log.block_hash
		JOIN coordinators coordinator ON coordinator.emitter_address = log.emitter_address
		WHERE log.chain_id = ${chainId} AND log.canonical AND log.arguments->>'reportId' = ${reportId}
			AND log.event_name IN ('PriceRequested', 'PriceReportRejected', 'PriceReported', 'PendingReportRecovered', 'CoordinatorStateCheckpoint')
			AND (log.block_number, log.log_index, log.tx_hash) <
				(${decisionCursorBlock}::bigint, ${decisionCursorLog}::integer, ${decisionCursorTx})
		ORDER BY log.block_number DESC, log.log_index DESC, log.tx_hash DESC LIMIT ${decisionPage.queryLimit}
	`
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
			rounds: paged(reportRoundChanges(rows), page.limit, (row) => protocolCursorFor(chainId, 'report', identity, asOf, row)),
			coordinatorDecisions: paged(coordinatorDecisions, decisionPage.limit, (row) => protocolCursorFor(chainId, 'report-decisions', identity, asOf, row)),
		},
	})
}

const eventEntityDetailResponse = async (sql: SQL, parts: readonly string[], url: URL, domain: 'auction' | 'escalation'): Promise<Response> => {
	const chainId = routeInteger(parts[0])
	const address = parts[1]?.toLowerCase()
	if (parts.length !== 2 || chainId === undefined || address === undefined || !/^0x[0-9a-f]{40}$/.test(address))
		return json({ error: `Invalid ${domain} identifier` }, 400)
	const cursor = protocolCursorForRequest(url, chainId, domain, address)
	const asOf = await operationsAsOfForContinuations(sql, chainId, cursor === undefined ? [] : [{ parts: cursor, offset: 3 }])
	const page = detailPage(url, chainId, domain, address, asOf, cursor)
	const cursorBlock = page.cursor?.[9] ?? String(asOf['blockNumber'])
	const cursorTx = page.cursor?.[10] ?? `0x${'f'.repeat(64)}`
	const cursorLog = page.cursor?.[11] ?? 2_147_483_647
	const rows: readonly Record<string, unknown>[] =
		domain === 'auction'
			? await sql`SELECT event.*, block.timestamp AS block_timestamp FROM truth_auction_events event JOIN blocks block ON block.chain_id = event.chain_id AND block.hash = event.block_hash WHERE event.chain_id = ${chainId} AND event.auction_address = ${address} AND event.canonical AND (event.block_number, event.log_index, event.tx_hash) < (${cursorBlock}::bigint, ${cursorLog}::integer, ${cursorTx}) ORDER BY event.block_number DESC, event.log_index DESC, event.tx_hash DESC LIMIT ${page.queryLimit}`
			: await sql`SELECT event.*, block.timestamp AS block_timestamp FROM escalation_game_events event JOIN blocks block ON block.chain_id = event.chain_id AND block.hash = event.block_hash WHERE event.chain_id = ${chainId} AND event.game_address = ${address} AND event.canonical AND (event.block_number, event.log_index, event.tx_hash) < (${cursorBlock}::bigint, ${cursorLog}::integer, ${cursorTx}) ORDER BY event.block_number DESC, event.log_index DESC, event.tx_hash DESC LIMIT ${page.queryLimit}`
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
	const cursor = protocolCursorForRequest(url, chainId, 'fork', identity)
	const asOf = await operationsAsOfForContinuations(sql, chainId, cursor === undefined ? [] : [{ parts: cursor, offset: 3 }])
	const page = detailPage(url, chainId, 'fork', identity, asOf, cursor)
	const cursorBlock = page.cursor?.[9] ?? String(asOf['blockNumber'])
	const cursorTx = page.cursor?.[10] ?? `0x${'f'.repeat(64)}`
	const cursorLog = page.cursor?.[11] ?? 2_147_483_647
	const rows = await sql`
		SELECT event.*, block.timestamp AS block_timestamp FROM fork_migration_events event
		JOIN blocks block ON block.chain_id = event.chain_id AND block.hash = event.block_hash
		WHERE event.chain_id = ${chainId} AND event.canonical
			AND (event.universe_identity = ${identity} OR event.event_data->>'universeId' = ${identity}
				OR event.event_data->>'childUniverseId' = ${identity}
				OR EXISTS (SELECT 1 FROM pools pool WHERE pool.chain_id = event.chain_id AND pool.canonical
					AND pool.universe_id::text = ${identity}
					AND (event.universe_identity = pool.pool_address OR event.event_data->>'parent' = pool.pool_address
						OR event.event_data->>'parentPool' = pool.pool_address OR event.event_data->>'securityPool' = pool.pool_address)))
			AND (event.block_number, event.log_index, event.tx_hash) < (${cursorBlock}::bigint, ${cursorLog}::integer, ${cursorTx})
		ORDER BY event.block_number DESC, event.log_index DESC, event.tx_hash DESC LIMIT ${page.queryLimit}
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
	const summaryRows = await sql`
		SELECT
			COALESCE(sum((event.event_data->>'amountAttoRep')::numeric) FILTER
				(WHERE event.event_name = 'MigrationRepSplit' AND event.event_data ? 'amountAttoRep'), 0)::text AS migrated_atto_rep,
			COALESCE(sum((event.event_data->>'amountAttoRep')::numeric) FILTER
				(WHERE event.event_name = 'RepBurned' AND event.event_data ? 'amountAttoRep'), 0)::text AS burned_atto_rep,
			count(DISTINCT event.event_data->>'migrator') FILTER (WHERE event.event_data ? 'migrator')::integer AS migrator_count,
			count(DISTINCT event.event_data->>'childUniverseId') FILTER (WHERE event.event_data ? 'childUniverseId')::integer AS child_count,
			count(*) FILTER (WHERE event.event_name IN ('SecurityPoolForkSnapshot', 'ChildPoolLinked', 'PoolHeldRepSweptToChild', 'VaultMigrationCheckpoint'))::integer AS pool_migration_events,
			count(*) FILTER (WHERE event.event_name = 'EscalationMigrationEntitlementInitialized')::integer AS obligations_initialized,
			count(*) FILTER (WHERE event.event_name = 'EscalationMigrationEntitlementMaterialized')::integer AS obligations_materialized
		FROM fork_migration_events event
		WHERE event.chain_id = ${chainId} AND event.canonical AND (
			event.universe_identity = ${identity} OR event.event_data->>'universeId' = ${identity}
			OR EXISTS (SELECT 1 FROM pools pool WHERE pool.chain_id = event.chain_id AND pool.canonical
				AND pool.universe_id::text = ${identity}
				AND (event.universe_identity = pool.pool_address OR event.event_data->>'parent' = pool.pool_address
					OR event.event_data->>'parentPool' = pool.pool_address OR event.event_data->>'securityPool' = pool.pool_address))
		)
	`
	return json({
		chainId,
		asOf,
		data: { identity, summary: summaryRows[0], branches, events: paged(rows, page.limit, (row) => protocolCursorFor(chainId, 'fork', identity, asOf, row)) },
	})
}

type OffsetCursor = readonly [number, string, string, string, string, string, string, string, string, number]

const rejectRawSnapshotOffset = (url: URL): void => {
	if (url.searchParams.has('offset')) throw new ApiRequestError('offset requires a snapshot-bound cursor')
}

const offsetPage = (url: URL, chainId: number, domain: string, identity: string) => {
	const cursorValue = url.searchParams.get('cursor')
	if (cursorValue === null) return { identity, offset: 0, cursor: undefined }
	let parsed: unknown
	try {
		parsed = decodeOpaqueCursor(cursorValue)
	} catch (error) {
		throw new ApiRequestError('cursor is invalid', { cause: error })
	}
	const parts = Array.isArray(parsed) ? parsed : []
	if (
		parts.length !== 10 ||
		!isNonNegativeSafeInteger(parts[0]) ||
		typeof parts[1] !== 'string' ||
		typeof parts[2] !== 'string' ||
		!isPostgresBigint(parts[3]) ||
		typeof parts[4] !== 'string' ||
		!/^0x[0-9a-f]{64}$/.test(parts[4]) ||
		!isPostgresBigint(parts[5]) ||
		!parts.slice(6, 9).every((part) => typeof part === 'string') ||
		!isNonNegativeSafeInteger(parts[9])
	)
		throw new ApiRequestError('cursor is invalid')
	if (parts[0] !== chainId || parts[1] !== domain) throw new ApiRequestError('cursor does not match filters')
	return { identity: parts[2], offset: parts[9], cursor: parts as [number, string, string, string, string, string, string, string, string, number] }
}

const offsetCursorFor = (chainId: number, domain: string, identity: string, asOf: Record<string, unknown>, offset: number): string =>
	encodeOpaqueCursor([chainId, domain, identity, ...snapshotBoundary(asOf), offset] satisfies OffsetCursor)

const tradingCatalogResponse = async (sql: SQL, url: URL): Promise<Response> => {
	const chainId = integer(url.searchParams.get('chainId'), 'chainId')
	if (chainId === undefined) throw new ApiRequestError('chainId is required')
	rejectRawSnapshotOffset(url)
	const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 100
	const limit = Math.min(Math.max(requestedLimit, 1), 250)
	const query = url.searchParams.get('q')?.trim().toLowerCase()
	if (query !== undefined && query.length > 128) throw new ApiRequestError('q must not exceed 128 characters')
	const cursorIdentity = query ?? ''
	const page = offsetPage(url, chainId, 'trading-catalog', cursorIdentity)
	if (page.identity !== cursorIdentity) throw new ApiRequestError('cursor does not match filters')
	const asOf = await operationsAsOfForContinuations(sql, chainId, page.cursor === undefined ? [] : [{ parts: page.cursor, offset: 3 }])
	const offset = page.offset
	const rows = await sql`
		WITH markets AS (
			SELECT DISTINCT ON (market.pair_address) market.*
			FROM amm_markets market
			WHERE market.chain_id = ${chainId} AND market.canonical AND market.block_number <= ${String(asOf['blockNumber'])}
			ORDER BY market.pair_address, market.block_number DESC, market.log_index DESC
		)
		SELECT market.pair_address, market.pool_address, market.share_token_address,
			market.universe_id::text, market.fee_bps::text, question.question_id::text, question.title AS question_title,
			price.yes_reserve_atto_shares::text, price.no_reserve_atto_shares::text,
			price.conditional_yes_bps::text, price.conditional_no_bps::text,
			price.block_number::text AS price_block_number, price.timestamp AS price_timestamp,
			COALESCE(activity.swap_count, 0)::integer AS swap_count,
			COALESCE(activity.liquidity_event_count, 0)::integer AS liquidity_event_count,
			COALESCE(activity.lp_holder_count, 0)::integer AS lp_holder_count,
			COALESCE(activity.fees_atto_shares, 0)::text AS fees_atto_shares,
			count(*) OVER ()::integer AS total
		FROM markets market
		LEFT JOIN pools pool ON pool.chain_id = market.chain_id AND pool.pool_address = market.pool_address AND pool.canonical
		LEFT JOIN questions question ON question.chain_id = pool.chain_id AND question.question_id = pool.question_id AND question.canonical
		LEFT JOIN LATERAL (
			SELECT snapshot.*, block.timestamp FROM amm_price_snapshots snapshot
			JOIN blocks block ON block.chain_id = snapshot.chain_id AND block.hash = snapshot.block_hash
			WHERE snapshot.chain_id = market.chain_id AND snapshot.pair_address = market.pair_address AND snapshot.canonical
				AND snapshot.block_number <= ${String(asOf['blockNumber'])}
			ORDER BY snapshot.block_number DESC, snapshot.log_index DESC LIMIT 1
		) price ON true
		LEFT JOIN LATERAL (
			SELECT count(*) FILTER (WHERE event.event_name = 'Swap') AS swap_count,
				count(*) FILTER (WHERE event.event_name IN ('LiquidityInitialized', 'LiquidityAdded', 'LiquidityRemoved')) AS liquidity_event_count,
				(SELECT count(*) FROM (
					SELECT movement.address
					FROM (
						SELECT lower(transfer.event_data->>'to') AS address, (transfer.event_data->>'amount')::numeric AS delta
						FROM amm_trade_events transfer
						WHERE transfer.chain_id = market.chain_id AND transfer.market_address = market.pair_address
							AND transfer.canonical AND transfer.event_name = 'Transfer' AND transfer.block_number <= ${String(asOf['blockNumber'])}
						UNION ALL
						SELECT lower(transfer.event_data->>'from'), -(transfer.event_data->>'amount')::numeric
						FROM amm_trade_events transfer
						WHERE transfer.chain_id = market.chain_id AND transfer.market_address = market.pair_address
							AND transfer.canonical AND transfer.event_name = 'Transfer' AND transfer.block_number <= ${String(asOf['blockNumber'])}
					) movement
					WHERE movement.address <> '0x0000000000000000000000000000000000000000'
					GROUP BY movement.address HAVING sum(movement.delta) <> 0
				) holder) AS lp_holder_count,
				COALESCE(sum((event.event_data->>'feeAmount')::numeric) FILTER (WHERE event.event_name = 'Swap'), 0) AS fees_atto_shares
			FROM amm_trade_events event
			WHERE event.chain_id = market.chain_id AND event.market_address = market.pair_address AND event.canonical
				AND event.block_number <= ${String(asOf['blockNumber'])}
		) activity ON true
		WHERE (${query ?? null}::text IS NULL OR market.pair_address ILIKE ${query === undefined ? null : `%${query}%`}
			OR market.pool_address ILIKE ${query === undefined ? null : `%${query}%`}
			OR question.title ILIKE ${query === undefined ? null : `%${query}%`})
		ORDER BY price.block_number DESC NULLS LAST, market.block_number DESC, market.pair_address
		LIMIT ${limit} OFFSET ${offset}
	`
	const total = Number(rows[0]?.['total'] ?? 0)
	const items = rows.map((row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'total')))
	const hasMore = offset + items.length < total
	return json({
		chainId,
		asOf,
		data: {
			items,
			total,
			limit,
			offset,
			hasMore,
			nextCursor: hasMore ? offsetCursorFor(chainId, 'trading-catalog', cursorIdentity, asOf, offset + limit) : undefined,
		},
	})
}

type IntegrityCursor = readonly [
	version: 1,
	chainId: number,
	domain: 'integrity-catalog',
	snapshotId: string,
	total: number,
	snapshotBlock: string,
	snapshotHash: string,
	invalidationId: string,
	abiSourceHash: string,
	applicationSourceHash: string,
	projectionSourceHash: string,
	offset: number,
	detectedAt: string,
	id: string,
]

const parseIntegrityCursor = (value: string | null, chainId: number): IntegrityCursor | undefined => {
	if (value === null) return undefined
	try {
		const decoded = decodeOpaqueCursor(value)
		const parts = Array.isArray(decoded) ? decoded : []
		if (
			parts.length !== 14 ||
			parts[0] !== 1 ||
			parts[1] !== chainId ||
			parts[2] !== 'integrity-catalog' ||
			!isPostgresBigint(parts[3]) ||
			!isNonNegativeSafeInteger(parts[4]) ||
			!isPostgresBigint(parts[5]) ||
			typeof parts[6] !== 'string' ||
			!/^0x[0-9a-f]{64}$/.test(parts[6]) ||
			!isPostgresBigint(parts[7]) ||
			!parts.slice(8, 11).every((part) => typeof part === 'string') ||
			!isNonNegativeSafeInteger(parts[11]) ||
			Number(parts[11]) > Number(parts[4]) ||
			typeof parts[12] !== 'string' ||
			!isCursorTimestamp(parts[12]) ||
			!isPostgresBigint(parts[13])
		)
			throw new Error('shape')
		return [
			1,
			chainId,
			'integrity-catalog',
			String(parts[3]),
			Number(parts[4]),
			String(parts[5]),
			String(parts[6]),
			String(parts[7]),
			String(parts[8]),
			String(parts[9]),
			String(parts[10]),
			Number(parts[11]),
			String(parts[12]),
			String(parts[13]),
		]
	} catch (error) {
		throw new ApiRequestError('cursor is invalid', { cause: error })
	}
}

const integrityCursorFor = (
	chainId: number,
	snapshotId: string,
	total: number,
	asOf: Record<string, unknown>,
	offset: number,
	row: Record<string, unknown>,
): string =>
	encodeOpaqueCursor([
		1,
		chainId,
		'integrity-catalog',
		snapshotId,
		total,
		...snapshotBoundary(asOf),
		offset,
		cursorTimestamp(row['cursor_detected_at']),
		String(row['id']),
	] satisfies IntegrityCursor)

const integrityCatalogResponse = async (sql: SQL, url: URL): Promise<Response> => {
	const chainId = integer(url.searchParams.get('chainId'), 'chainId')
	if (chainId === undefined) throw new ApiRequestError('chainId is required')
	rejectRawSnapshotOffset(url)
	const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 100
	const limit = Math.min(Math.max(requestedLimit, 1), 250)
	const cursor = parseIntegrityCursor(url.searchParams.get('cursor'), chainId)
	const snapshotRows = await sql`
		SELECT COALESCE(max(id), 0)::text AS id
		FROM chain_reorganizations WHERE chain_id = ${chainId}
	`
	const currentSnapshotId = snapshotRows[0]?.['id']
	if (!isPostgresBigint(currentSnapshotId)) throw new Error('Integrity snapshot boundary is unavailable')
	if (cursor !== undefined && BigInt(cursor[3]) > BigInt(currentSnapshotId)) throw new ApiRequestError('cursor is invalid')
	const asOf = await operationsAsOfForContinuations(sql, chainId, cursor === undefined ? [] : [{ parts: cursor, offset: 5 }])
	const snapshotId = cursor?.[3] ?? currentSnapshotId
	const offset = cursor?.[11] ?? 0
	const [reorganizations, migrations, runs] = await Promise.all([
		sql`SELECT reorganization.id::text, reorganization.previous_block::text, reorganization.previous_hash,
			reorganization.ancestor_block::text, reorganization.ancestor_hash, reorganization.depth::text,
			reorganization.reason, reorganization.indexer_run_id::text,
			reorganization.abi_source_hash, reorganization.application_source_hash, reorganization.projection_source_hash,
			COALESCE((SELECT jsonb_agg(cause.reason ORDER BY cause.reason) FROM history_invalidation_causes cause
				WHERE cause.invalidation_id = reorganization.id), jsonb_build_array(reorganization.reason)) AS causes,
			COALESCE((SELECT jsonb_object_agg(counts.occurrence_kind, counts.occurrence_count ORDER BY counts.occurrence_kind)
				FROM (SELECT occurrence.occurrence_kind, count(*)::text AS occurrence_count
					FROM history_invalidation_occurrences occurrence WHERE occurrence.invalidation_id = reorganization.id
					GROUP BY occurrence.occurrence_kind) counts), '{}'::jsonb) AS occurrence_counts,
			reorganization.detected_at,
			to_char(reorganization.detected_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_detected_at,
			count(*) OVER ()::integer AS total
			FROM chain_reorganizations reorganization WHERE reorganization.chain_id = ${chainId} AND reorganization.id <= ${snapshotId}
				AND (${cursor === undefined} OR (reorganization.detected_at, reorganization.id) <
					(${cursor?.[12] ?? '9999-12-31T23:59:59.999Z'}::timestamptz, ${cursor?.[13] ?? '0'}::bigint))
			ORDER BY reorganization.detected_at DESC, reorganization.id DESC LIMIT ${limit + 1}`,
		sql`SELECT schema_version, description, applied_at FROM augurscan_schema_migrations ORDER BY applied_at, schema_version`,
		sql`SELECT id::text, schema_version, app_version, abi_source_hash, application_source_hash,
			projection_source_hash, indexer_enabled, network_configuration, started_at, stopped_at
			FROM indexer_runs ORDER BY started_at DESC, id DESC LIMIT 25`,
	])
	const total = cursor?.[4] ?? Number(reorganizations[0]?.['total'] ?? 0)
	const pageRows = reorganizations.slice(0, limit)
	const items = pageRows.map((row: Record<string, unknown>) =>
		Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'total' && key !== 'cursor_detected_at')),
	)
	const hasMore = reorganizations.length > limit
	const returnedOffset = offset + items.length
	const last = pageRows[pageRows.length - 1]
	return json({
		chainId,
		asOf,
		data: {
			items,
			total,
			limit,
			offset,
			hasMore,
			nextCursor: hasMore && last !== undefined ? integrityCursorFor(chainId, snapshotId, total, asOf, returnedOffset, last) : undefined,
			migrations,
			runs,
		},
	})
}

type DirectObservationKind = 'all' | 'address-balance' | 'token-metadata'

type DirectObservationSnapshot = {
	readonly kind: DirectObservationKind
	readonly address?: string
	readonly canonical: CanonicalHistoryFilter
	readonly maxBalanceId: string
	readonly maxMetadataId: string
	readonly total: string
}

type DirectObservationCursor = readonly [
	version: 1,
	chainId: number,
	domain: 'direct-observations',
	snapshot: string,
	snapshotBlock: string,
	snapshotHash: string,
	invalidationId: string,
	abiSourceHash: string,
	applicationSourceHash: string,
	projectionSourceHash: string,
	offset: number,
	observedAt: string,
	kind: 'address-balance' | 'token-metadata',
	id: string,
]

const parseDirectObservationCursor = (value: string | null, chainId: number): DirectObservationCursor | undefined => {
	if (value === null) return undefined
	try {
		const decoded = decodeOpaqueCursor(value)
		const parts = Array.isArray(decoded) ? decoded : []
		if (
			parts.length !== 14 ||
			parts[0] !== 1 ||
			parts[1] !== chainId ||
			parts[2] !== 'direct-observations' ||
			typeof parts[3] !== 'string' ||
			!isPostgresBigint(parts[4]) ||
			typeof parts[5] !== 'string' ||
			!/^0x[0-9a-f]{64}$/.test(parts[5]) ||
			!isPostgresBigint(parts[6]) ||
			!parts.slice(7, 10).every((part) => typeof part === 'string') ||
			!isNonNegativeSafeInteger(parts[10]) ||
			typeof parts[11] !== 'string' ||
			!isCursorTimestamp(parts[11]) ||
			(parts[12] !== 'address-balance' && parts[12] !== 'token-metadata') ||
			!isPostgresBigint(parts[13])
		)
			throw new Error('shape')
		return [
			1,
			chainId,
			'direct-observations',
			String(parts[3]),
			String(parts[4]),
			String(parts[5]),
			String(parts[6]),
			String(parts[7]),
			String(parts[8]),
			String(parts[9]),
			Number(parts[10]),
			String(parts[11]),
			parts[12],
			String(parts[13]),
		]
	} catch (error) {
		throw new ApiRequestError('cursor is invalid', { cause: error })
	}
}

const directObservationCursorFor = (
	chainId: number,
	snapshot: DirectObservationSnapshot,
	asOf: Record<string, unknown>,
	offset: number,
	row: Record<string, unknown>,
): string => {
	const observationKind = row['observation_kind']
	if (observationKind !== 'address-balance' && observationKind !== 'token-metadata') throw new Error('Direct observation kind is unavailable')
	return encodeOpaqueCursor([
		1,
		chainId,
		'direct-observations',
		JSON.stringify(snapshot),
		...snapshotBoundary(asOf),
		offset,
		cursorTimestamp(row['cursor_observed_at']),
		observationKind,
		String(row['observation_id']),
	] satisfies DirectObservationCursor)
}

const directObservationSnapshot = (value: string): DirectObservationSnapshot => {
	try {
		const parsed = JSON.parse(value) as unknown
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('shape')
		const record = jsonRecord(parsed)
		const kind = record['kind']
		const address = record['address']
		const canonical = record['canonical']
		const maxBalanceId = record['maxBalanceId']
		const maxMetadataId = record['maxMetadataId']
		const total = record['total']
		if (
			(kind !== 'all' && kind !== 'address-balance' && kind !== 'token-metadata') ||
			(address !== undefined && (typeof address !== 'string' || !/^0x[0-9a-f]{40}$/.test(address))) ||
			(canonical !== 'canonical' && canonical !== 'orphaned' && canonical !== 'all') ||
			!isPostgresBigint(maxBalanceId) ||
			!isPostgresBigint(maxMetadataId) ||
			!isPostgresBigint(total) ||
			BigInt(total) > BigInt(Number.MAX_SAFE_INTEGER)
		)
			throw new Error('shape')
		return { kind, ...(address === undefined ? {} : { address }), canonical, maxBalanceId, maxMetadataId, total }
	} catch (error) {
		throw new ApiRequestError('cursor snapshot is invalid', { cause: error })
	}
}

const directObservationsResponse = async (sql: SQL, url: URL): Promise<Response> => {
	const chainId = integer(url.searchParams.get('chainId'), 'chainId')
	if (chainId === undefined) throw new ApiRequestError('chainId is required')
	rejectRawSnapshotOffset(url)
	const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 100
	const limit = Math.min(Math.max(requestedLimit, 1), 250)
	const requestedKind = url.searchParams.get('kind') ?? 'all'
	if (requestedKind !== 'all' && requestedKind !== 'address-balance' && requestedKind !== 'token-metadata')
		throw new ApiRequestError('kind must be all, address-balance, or token-metadata')
	const address = evmAddress(url.searchParams.get('address'), 'address')
	const canonical = canonicalHistoryFilter(url)
	const cursor = parseDirectObservationCursor(url.searchParams.get('cursor'), chainId)
	let snapshot: DirectObservationSnapshot
	if (cursor === undefined) {
		const maxima = await sql`
			SELECT
				COALESCE((SELECT max(id) FROM address_balance_observations WHERE chain_id = ${chainId}), 0)::text AS max_balance_id,
				COALESCE((SELECT max(id) FROM token_metadata_observations WHERE chain_id = ${chainId}), 0)::text AS max_metadata_id
		`
		snapshot = {
			kind: requestedKind,
			...(address === undefined ? {} : { address }),
			canonical,
			maxBalanceId: String(maxima[0]?.['max_balance_id'] ?? '0'),
			maxMetadataId: String(maxima[0]?.['max_metadata_id'] ?? '0'),
			total: '0',
		}
	} else {
		snapshot = directObservationSnapshot(cursor[3])
		if (snapshot.kind !== requestedKind || snapshot.address !== address || snapshot.canonical !== canonical)
			throw new ApiRequestError('cursor does not match filters')
		if (cursor[10] > Number(snapshot.total)) throw new ApiRequestError('cursor is invalid')
	}
	const asOf = await operationsAsOfForContinuations(sql, chainId, cursor === undefined ? [] : [{ parts: cursor, offset: 4 }])
	const rows = await sql`
		WITH observations AS (
			SELECT 'address-balance'::text AS observation_kind, observation.id,
				observation.chain_id, observation.block_hash, observation.block_number,
				observation.address, observation.asset_address, observation.asset_kind,
				observation.read_status, observation.read_failure_reason,
				jsonb_strip_nulls(jsonb_build_object('balance', observation.balance::text,
					'readFailureReason', observation.read_failure_reason)) AS result,
				observation.canonical, observation.observed_at, observation.indexer_run_id,
				observation.abi_source_hash, observation.application_source_hash, observation.projection_source_hash
			FROM address_balance_observations observation
			WHERE observation.chain_id = ${chainId} AND observation.id <= ${snapshot.maxBalanceId}
				AND ${snapshot.kind === 'token-metadata'} = false
				AND (${snapshot.address ?? null}::text IS NULL OR observation.address = ${snapshot.address ?? null}
					OR observation.asset_address = ${snapshot.address ?? null})
				AND (${snapshot.canonical} = 'all' OR observation.canonical = (${snapshot.canonical} = 'canonical'))
			UNION ALL
			SELECT 'token-metadata'::text AS observation_kind, observation.id,
				observation.chain_id, observation.block_hash, observation.read_block AS block_number,
				observation.address, NULL::text AS asset_address, NULL::text AS asset_kind,
				observation.read_status, observation.read_error AS read_failure_reason,
				jsonb_strip_nulls(jsonb_build_object('name', observation.name, 'symbol', observation.symbol,
					'decimals', observation.decimals, 'readError', observation.read_error)) AS result,
				observation.canonical, observation.observed_at, observation.indexer_run_id,
				observation.abi_source_hash, observation.application_source_hash, observation.projection_source_hash
			FROM token_metadata_observations observation
			WHERE observation.chain_id = ${chainId} AND observation.id <= ${snapshot.maxMetadataId}
				AND ${snapshot.kind === 'address-balance'} = false
				AND (${snapshot.address ?? null}::text IS NULL OR observation.address = ${snapshot.address ?? null})
			AND (${snapshot.canonical} = 'all' OR observation.canonical = (${snapshot.canonical} = 'canonical'))
		)
		SELECT observation.observation_kind, observation.id::text AS observation_id,
			observation.chain_id::text AS chain_id, observation.block_hash,
			observation.block_number::text AS block_number, block.timestamp AS block_timestamp,
			observation.address, observation.asset_address, observation.asset_kind,
			observation.read_status, observation.read_failure_reason, observation.result,
			observation.canonical, observation.observed_at, observation.indexer_run_id::text AS indexer_run_id,
			to_char(observation.observed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_observed_at,
			observation.abi_source_hash, observation.application_source_hash, observation.projection_source_hash,
			CASE WHEN observation.canonical THEN 'canonical'
				WHEN invalidation.reason = 'chain-reorg' THEN 'chain-orphaned'
				WHEN invalidation.reason = 'manifest-reset' THEN 'manifest-superseded'
				WHEN invalidation.reason = 'start-boundary-advanced' THEN 'coverage-reset'
				ELSE 'noncanonical-unknown' END AS evidence_status,
			invalidation.id::text AS invalidation_id, invalidation.reason AS invalidation_reason,
			invalidation.causes AS invalidation_causes, invalidation.detected_at AS invalidated_at,
			count(*) OVER ()::text AS total
		FROM observations observation
		JOIN blocks block ON block.chain_id = observation.chain_id AND block.hash = observation.block_hash
		LEFT JOIN LATERAL (
			SELECT replacement.id, replacement.reason,
				COALESCE((SELECT jsonb_agg(cause.reason ORDER BY cause.reason) FROM history_invalidation_causes cause
					WHERE cause.invalidation_id = replacement.id), jsonb_build_array(replacement.reason)) AS causes,
				replacement.detected_at
			FROM history_invalidation_occurrences occurrence
			JOIN chain_reorganizations replacement ON replacement.id = occurrence.invalidation_id
			WHERE occurrence.occurrence_kind = observation.observation_kind
				AND occurrence.chain_id = observation.chain_id AND occurrence.block_hash = observation.block_hash
				AND occurrence.occurrence_id = observation.id::text
			ORDER BY replacement.id DESC LIMIT 1
		) invalidation ON true
		WHERE (${cursor === undefined} OR (observation.observed_at, observation.observation_kind, observation.id) <
			(${cursor?.[11] ?? '9999-12-31T23:59:59.999Z'}::timestamptz, ${cursor?.[12] ?? 'token-metadata'}, ${cursor?.[13] ?? '0'}::bigint))
		ORDER BY observation.observed_at DESC, observation.observation_kind DESC, observation.id DESC
		LIMIT ${limit + 1}
	`
	if (cursor === undefined) snapshot = { ...snapshot, total: String(rows[0]?.['total'] ?? '0') }
	const total = directObservationTotal(snapshot.total)
	const pageRows = rows.slice(0, limit)
	const items = pageRows.map((row: Record<string, unknown>) =>
		Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'total' && key !== 'cursor_observed_at')),
	)
	const offset = cursor?.[10] ?? 0
	const returnedOffset = offset + items.length
	const hasMore = rows.length > limit
	const last = pageRows[pageRows.length - 1]
	return json({
		chainId,
		asOf,
		data: {
			items,
			total,
			limit,
			offset,
			hasMore,
			...(hasMore && last !== undefined ? { nextCursor: directObservationCursorFor(chainId, snapshot, asOf, returnedOffset, last) } : {}),
		},
	})
}

const tradingDetailResponse = async (sql: SQL, parts: readonly string[], url: URL): Promise<Response> => {
	const chainId = routeInteger(parts[0])
	const market = parts[1]?.toLowerCase()
	if (parts.length !== 2 || chainId === undefined || market === undefined || !/^0x[0-9a-f]{40}$/.test(market))
		return json({ error: 'Invalid AMM identifier' }, 400)
	const cursor = protocolCursorForRequest(url, chainId, 'trading', market)
	const asOf = await operationsAsOfForContinuations(sql, chainId, cursor === undefined ? [] : [{ parts: cursor, offset: 3 }])
	const page = detailPage(url, chainId, 'trading', market, asOf, cursor)
	const cursorBlock = page.cursor?.[9] ?? String(asOf['blockNumber'])
	const cursorTx = page.cursor?.[10] ?? `0x${'f'.repeat(64)}`
	const cursorLog = page.cursor?.[11] ?? 2_147_483_647
	const rows = await sql`
		SELECT event.*, block.timestamp AS block_timestamp,
			EXTRACT(EPOCH FROM block.timestamp)::bigint::text AS timestamp_seconds
		FROM amm_trade_events event JOIN blocks block ON block.chain_id = event.chain_id AND block.hash = event.block_hash
		WHERE event.chain_id = ${chainId} AND event.market_address = ${market} AND event.canonical
			AND (event.event_name <> 'Swap' OR (event.event_data ? 'yesForNo' AND event.event_data ? 'amountIn'
				AND event.event_data ? 'amountOut' AND event.event_data ? 'resultingYesReserve' AND event.event_data ? 'resultingNoReserve'))
			AND (event.event_name <> 'Sync' OR (event.event_data ? 'yesReserve' AND event.event_data ? 'noReserve'))
			AND (event.block_number, event.log_index, event.tx_hash) < (${cursorBlock}::bigint, ${cursorLog}::integer, ${cursorTx})
		ORDER BY event.block_number DESC, event.log_index DESC, event.tx_hash DESC LIMIT ${page.queryLimit}
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
				event.event_data->>'noReserve' AS numerator, event.event_data->>'yesReserve' AS denominator,
				event.block_number, event.tx_hash, event.log_index
			FROM amm_trade_events event JOIN blocks block ON block.chain_id = event.chain_id AND block.hash = event.block_hash
			WHERE event.chain_id = ${chainId} AND event.market_address = ${market} AND event.canonical
				AND event.event_name = 'Sync' AND event.event_data ? 'yesReserve' AND event.event_data ? 'noReserve'
				AND event.block_number <= ${String(asOf['blockNumber'])}
				AND block.timestamp >= to_timestamp(${String(asOf['blockTimestamp'])}::numeric - 604800)
		), prior_observation AS (
			SELECT EXTRACT(EPOCH FROM block.timestamp)::bigint::text AS timestamp_seconds,
				event.event_data->>'noReserve' AS numerator, event.event_data->>'yesReserve' AS denominator,
				event.block_number, event.tx_hash, event.log_index
			FROM amm_trade_events event JOIN blocks block ON block.chain_id = event.chain_id AND block.hash = event.block_hash
			WHERE event.chain_id = ${chainId} AND event.market_address = ${market} AND event.canonical
				AND event.event_name = 'Sync' AND event.event_data ? 'yesReserve' AND event.event_data ? 'noReserve'
				AND event.block_number <= ${String(asOf['blockNumber'])}
				AND block.timestamp < to_timestamp(${String(asOf['blockTimestamp'])}::numeric - 604800)
			ORDER BY event.block_number DESC, event.log_index DESC LIMIT 1
		)
		SELECT * FROM (
			SELECT * FROM (SELECT * FROM window_observations UNION ALL SELECT * FROM prior_observation) candidate
			ORDER BY block_number DESC, log_index DESC, tx_hash DESC LIMIT 10001
		) retained ORDER BY block_number, log_index, tx_hash
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
			AND event.block_number <= ${String(asOf['blockNumber'])}
			AND (event.event_name <> 'Swap' OR (event.event_data ? 'amountIn' AND event.event_data ? 'feeAmount'
				AND event.event_data ? 'resultingYesReserve' AND event.event_data ? 'resultingNoReserve'))
			AND (event.event_name <> 'Sync' OR (event.event_data ? 'yesReserve' AND event.event_data ? 'noReserve'))
	`
	const lpPositions = await sql`
		WITH transfers AS (
			SELECT lower(event.event_data->>'from') AS from_address, lower(event.event_data->>'to') AS to_address,
				(event.event_data->>'amount')::numeric AS amount
			FROM amm_trade_events event
			WHERE event.chain_id = ${chainId} AND event.market_address = ${market} AND event.canonical
				AND event.block_number <= ${String(asOf['blockNumber'])}
				AND event.event_name = 'Transfer' AND event.event_data ? 'from' AND event.event_data ? 'to' AND event.event_data ? 'amount'
		), deltas AS (
			SELECT to_address AS address, amount AS received_liquidity, 0::numeric AS sent_liquidity, amount AS balance_delta
			FROM transfers WHERE to_address <> '0x0000000000000000000000000000000000000000'
			UNION ALL
			SELECT from_address, 0::numeric, amount, -amount
			FROM transfers WHERE from_address <> '0x0000000000000000000000000000000000000000'
		)
		SELECT delta.address, sum(delta.received_liquidity)::text AS received_liquidity,
			sum(delta.sent_liquidity)::text AS sent_liquidity, sum(delta.balance_delta)::text AS balance
		FROM deltas delta
		GROUP BY delta.address
		HAVING sum(delta.balance_delta) <> 0
		ORDER BY sum(delta.balance_delta) DESC, delta.address
		LIMIT 250
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
			lpPositions,
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

type RiskStatePosition = readonly [blockNumber: string, observedAt: string, id: string]
type RiskEventPosition = readonly [blockNumber: string, logIndex: number, txHash: string, blockHash: string]
type RiskLiquidationPosition = readonly [blockNumber: string, logIndex: number, txHash: string, blockHash: string, entityType: string, entityIdentity: string]
type RiskHistoryPositions = {
	readonly state?: RiskStatePosition
	readonly accounting?: RiskEventPosition
	readonly lifecycle?: RiskEventPosition
	readonly liquidations?: RiskLiquidationPosition
}
type RiskHistoryCursor = readonly [
	version: 1,
	chainId: number,
	domain: 'risk-history',
	identity: string,
	snapshotBlock: string,
	snapshotHash: string,
	invalidationId: string,
	abiSourceHash: string,
	applicationSourceHash: string,
	projectionSourceHash: string,
	offset: number,
	positions: RiskHistoryPositions,
]

const riskEventPosition = (value: unknown): RiskEventPosition | undefined => {
	if (!Array.isArray(value) || value.length !== 4 || !isPostgresBigint(value[0]) || !isPostgresInteger(value[1])) return undefined
	if (typeof value[2] !== 'string' || !/^0x[0-9a-f]{64}$/.test(value[2]) || typeof value[3] !== 'string' || !/^0x[0-9a-f]{64}$/.test(value[3])) return undefined
	return [value[0], value[1], value[2], value[3]]
}

const riskHistoryPositions = (value: unknown): RiskHistoryPositions | undefined => {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
	const fields = jsonRecord(value)
	const stateValue = fields['state']
	const state =
		stateValue === undefined
			? undefined
			: Array.isArray(stateValue) &&
					stateValue.length === 3 &&
					isPostgresBigint(stateValue[0]) &&
					typeof stateValue[1] === 'string' &&
					isCursorTimestamp(stateValue[1]) &&
					isPostgresBigint(stateValue[2])
				? ([stateValue[0], stateValue[1], stateValue[2]] as const)
				: undefined
	if (stateValue !== undefined && state === undefined) return undefined
	const accounting = riskEventPosition(fields['accounting'])
	if (fields['accounting'] !== undefined && accounting === undefined) return undefined
	const lifecycle = riskEventPosition(fields['lifecycle'])
	if (fields['lifecycle'] !== undefined && lifecycle === undefined) return undefined
	const liquidationValue = fields['liquidations']
	const liquidationBase = riskEventPosition(Array.isArray(liquidationValue) ? liquidationValue.slice(0, 4) : undefined)
	const liquidations =
		liquidationValue === undefined
			? undefined
			: Array.isArray(liquidationValue) &&
					liquidationValue.length === 6 &&
					liquidationBase !== undefined &&
					typeof liquidationValue[4] === 'string' &&
					typeof liquidationValue[5] === 'string'
				? ([...liquidationBase, liquidationValue[4], liquidationValue[5]] as const)
				: undefined
	if (liquidationValue !== undefined && liquidations === undefined) return undefined
	return {
		...(state === undefined ? {} : { state }),
		...(accounting === undefined ? {} : { accounting }),
		...(lifecycle === undefined ? {} : { lifecycle }),
		...(liquidations === undefined ? {} : { liquidations }),
	}
}

const parseRiskHistoryCursor = (value: string | null, chainId: number, identity: string): RiskHistoryCursor | undefined => {
	if (value === null) return undefined
	try {
		const decoded = decodeOpaqueCursor(value)
		const parts = Array.isArray(decoded) ? decoded : []
		const positions = riskHistoryPositions(parts[11])
		if (
			parts.length !== 12 ||
			parts[0] !== 1 ||
			parts[1] !== chainId ||
			parts[2] !== 'risk-history' ||
			parts[3] !== identity ||
			!isPostgresBigint(parts[4]) ||
			typeof parts[5] !== 'string' ||
			!/^0x[0-9a-f]{64}$/.test(parts[5]) ||
			!isPostgresBigint(parts[6]) ||
			!parts.slice(7, 10).every((part) => typeof part === 'string') ||
			!isNonNegativeSafeInteger(parts[10]) ||
			positions === undefined
		)
			throw new Error('shape')
		return [
			1,
			chainId,
			'risk-history',
			identity,
			String(parts[4]),
			String(parts[5]),
			String(parts[6]),
			String(parts[7]),
			String(parts[8]),
			String(parts[9]),
			Number(parts[10]),
			positions,
		]
	} catch (error) {
		throw new ApiRequestError('cursor is invalid', { cause: error })
	}
}

const riskHistoryCursorFor = (chainId: number, identity: string, asOf: Record<string, unknown>, offset: number, positions: RiskHistoryPositions): string =>
	encodeOpaqueCursor([1, chainId, 'risk-history', identity, ...snapshotBoundary(asOf), offset, positions] satisfies RiskHistoryCursor)

const riskDetailResponse = async (sql: SQL, parts: readonly string[], url: URL): Promise<Response> => {
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
	rejectRawSnapshotOffset(url)
	const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 250
	const limit = Math.min(Math.max(requestedLimit, 1), 1_000)
	const entityIdentity = kind === 'pools' ? poolAddress : `${poolAddress}:${vaultAddress}`
	const historyIdentity = `${kind}:${entityIdentity}`
	const cursor = parseRiskHistoryCursor(url.searchParams.get('cursor'), chainId, historyIdentity)
	const asOf = await operationsAsOfForContinuations(
		sql,
		chainId,
		cursor === undefined ? [] : [{ parts: cursor, offset: 4 }],
		postgresBigint(url.searchParams.get('atBlock'), 'atBlock'),
	)
	const offset = cursor?.[10] ?? 0
	const positions = cursor?.[11] ?? {}
	const risk = await riskCatalogData(sql, chainId, {
		poolAddress,
		...(kind === 'vaults' && vaultAddress !== undefined ? { vaultAddress } : {}),
		limit: 1,
		snapshotBlock: String(asOf['blockNumber']),
	})
	const entity =
		kind === 'pools'
			? risk.pools.find((row: Record<string, unknown>) => row['pool_address'] === poolAddress)
			: risk.vaults.find((row: Record<string, unknown>) => row['pool_address'] === poolAddress && row['vault_address'] === vaultAddress)
	if (entity === undefined) return json({ error: `${kind === 'pools' ? 'Pool' : 'Vault'} risk state not found` }, 404)
	const entityType = kind === 'pools' ? 'pool' : 'vault'
	const [stateSnapshots, accountingSnapshots, lifecycleEvents, liquidations] = await Promise.all([
		sql`
			SELECT observation.*, observation.id::text AS id, observation.indexer_run_id::text AS indexer_run_id,
				to_char(observation.observed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_observed_at,
				block.timestamp AS block_timestamp, invalidation.id::text AS invalidation_id,
				invalidation.reason AS invalidation_reason, invalidation.causes AS invalidation_causes
			FROM entity_state_observations observation
			JOIN blocks block ON block.chain_id = observation.chain_id AND block.hash = observation.block_hash
			LEFT JOIN LATERAL (
				SELECT replacement.id, replacement.reason,
					COALESCE((SELECT jsonb_agg(cause.reason ORDER BY cause.reason) FROM history_invalidation_causes cause
						WHERE cause.invalidation_id = replacement.id), jsonb_build_array(replacement.reason)) AS causes
				FROM history_invalidation_occurrences occurrence
				JOIN chain_reorganizations replacement ON replacement.id = occurrence.invalidation_id
				WHERE occurrence.occurrence_kind = 'entity-state' AND occurrence.chain_id = observation.chain_id
					AND occurrence.block_hash = observation.block_hash AND occurrence.occurrence_id = observation.id::text
				ORDER BY replacement.id DESC LIMIT 1
			) invalidation ON true
			WHERE observation.chain_id = ${chainId} AND observation.entity_type = ${entityType}
				AND observation.entity_identity = ${entityIdentity} AND observation.canonical
				AND observation.block_number <= ${String(asOf['blockNumber'])}
				AND (${positions.state === undefined} OR (observation.block_number, observation.observed_at, observation.id) <
					(${positions.state?.[0] ?? '0'}::bigint, ${positions.state?.[1] ?? '1970-01-01T00:00:00.000Z'}::timestamptz,
						${positions.state?.[2] ?? '0'}::bigint))
			ORDER BY observation.block_number DESC, observation.observed_at DESC, observation.id DESC
			LIMIT ${limit + 1}
		`,
		kind === 'pools'
			? sql`SELECT snapshot.*, block.timestamp AS block_timestamp FROM pool_snapshots snapshot
				JOIN blocks block ON block.chain_id = snapshot.chain_id AND block.hash = snapshot.block_hash
				WHERE snapshot.chain_id = ${chainId} AND snapshot.pool_address = ${poolAddress} AND snapshot.canonical
					AND snapshot.block_number <= ${String(asOf['blockNumber'])}
					AND (${positions.accounting === undefined} OR (snapshot.block_number, snapshot.log_index, snapshot.tx_hash, snapshot.block_hash) <
						(${positions.accounting?.[0] ?? '0'}::bigint, ${positions.accounting?.[1] ?? 0}::integer,
							${positions.accounting?.[2] ?? `0x${'0'.repeat(64)}`}, ${positions.accounting?.[3] ?? `0x${'0'.repeat(64)}`}))
				ORDER BY snapshot.block_number DESC, snapshot.log_index DESC, snapshot.tx_hash DESC, snapshot.block_hash DESC
				LIMIT ${limit + 1}`
			: sql`SELECT snapshot.*, block.timestamp AS block_timestamp FROM vault_snapshots snapshot
				JOIN blocks block ON block.chain_id = snapshot.chain_id AND block.hash = snapshot.block_hash
				WHERE snapshot.chain_id = ${chainId} AND snapshot.pool_address = ${poolAddress}
					AND snapshot.vault_address = ${vaultAddress ?? ''} AND snapshot.canonical
					AND snapshot.block_number <= ${String(asOf['blockNumber'])}
					AND (${positions.accounting === undefined} OR (snapshot.block_number, snapshot.log_index, snapshot.tx_hash, snapshot.block_hash) <
						(${positions.accounting?.[0] ?? '0'}::bigint, ${positions.accounting?.[1] ?? 0}::integer,
							${positions.accounting?.[2] ?? `0x${'0'.repeat(64)}`}, ${positions.accounting?.[3] ?? `0x${'0'.repeat(64)}`}))
				ORDER BY snapshot.block_number DESC, snapshot.log_index DESC, snapshot.tx_hash DESC, snapshot.block_hash DESC
				LIMIT ${limit + 1}`,
		sql`
			SELECT timeline.*, block.timestamp AS block_timestamp FROM protocol_timeline_entries timeline
			JOIN blocks block ON block.chain_id = timeline.chain_id AND block.hash = timeline.block_hash
			WHERE timeline.chain_id = ${chainId} AND timeline.entity_type = ${entityType}
				AND timeline.entity_identity = ${entityIdentity} AND timeline.canonical
				AND timeline.block_number <= ${String(asOf['blockNumber'])}
				AND (${positions.lifecycle === undefined} OR (timeline.block_number, timeline.log_index, timeline.tx_hash, timeline.block_hash) <
					(${positions.lifecycle?.[0] ?? '0'}::bigint, ${positions.lifecycle?.[1] ?? 0}::integer,
						${positions.lifecycle?.[2] ?? `0x${'0'.repeat(64)}`}, ${positions.lifecycle?.[3] ?? `0x${'0'.repeat(64)}`}))
			ORDER BY timeline.block_number DESC, timeline.log_index DESC, timeline.tx_hash DESC, timeline.block_hash DESC
			LIMIT ${limit + 1}
		`,
		sql`
			SELECT timeline.*, block.timestamp AS block_timestamp FROM protocol_timeline_entries timeline
			JOIN blocks block ON block.chain_id = timeline.chain_id AND block.hash = timeline.block_hash
			WHERE timeline.chain_id = ${chainId} AND timeline.semantic_event_kind = 'VaultLiquidated' AND timeline.canonical
				AND timeline.block_number <= ${String(asOf['blockNumber'])}
				AND (timeline.summary_data->>'targetVault' = ${vaultAddress ?? ''} OR timeline.summary_data->>'vault' = ${vaultAddress ?? ''}
					OR (timeline.source_contract = ${poolAddress} AND ${kind === 'pools'}))
				AND (${positions.liquidations === undefined} OR (timeline.block_number, timeline.log_index, timeline.tx_hash, timeline.block_hash,
					timeline.entity_type, timeline.entity_identity) < (${positions.liquidations?.[0] ?? '0'}::bigint,
						${positions.liquidations?.[1] ?? 0}::integer, ${positions.liquidations?.[2] ?? `0x${'0'.repeat(64)}`},
						${positions.liquidations?.[3] ?? `0x${'0'.repeat(64)}`}, ${positions.liquidations?.[4] ?? ''}, ${positions.liquidations?.[5] ?? ''}))
			ORDER BY timeline.block_number DESC, timeline.log_index DESC, timeline.tx_hash DESC, timeline.block_hash DESC,
				timeline.entity_type DESC, timeline.entity_identity DESC
			LIMIT ${limit + 1}
		`,
	])
	const historyTruncated = [stateSnapshots, accountingSnapshots, lifecycleEvents, liquidations].some((rows) => rows.length > limit)
	const statePageRows = stateSnapshots.slice(0, limit)
	const pageRows = {
		stateSnapshots: statePageRows.map((row: Record<string, unknown>) =>
			Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'cursor_observed_at')),
		),
		accountingSnapshots: accountingSnapshots.slice(0, limit),
		lifecycleEvents: lifecycleEvents.slice(0, limit),
		liquidations: liquidations.slice(0, limit),
	}
	const lastState = statePageRows.at(-1)
	const lastAccounting = pageRows.accountingSnapshots.at(-1)
	const lastLifecycle = pageRows.lifecycleEvents.at(-1)
	const lastLiquidation = pageRows.liquidations.at(-1)
	const nextPositions: RiskHistoryPositions = {
		...positions,
		...(lastState === undefined
			? {}
			: { state: [String(lastState['block_number']), cursorTimestamp(lastState['cursor_observed_at']), String(lastState['id'])] as const }),
		...(lastAccounting === undefined
			? {}
			: {
					accounting: [
						String(lastAccounting['block_number']),
						Number(lastAccounting['log_index']),
						String(lastAccounting['tx_hash']),
						String(lastAccounting['block_hash']),
					] as const,
				}),
		...(lastLifecycle === undefined
			? {}
			: {
					lifecycle: [
						String(lastLifecycle['block_number']),
						Number(lastLifecycle['log_index']),
						String(lastLifecycle['tx_hash']),
						String(lastLifecycle['block_hash']),
					] as const,
				}),
		...(lastLiquidation === undefined
			? {}
			: {
					liquidations: [
						String(lastLiquidation['block_number']),
						Number(lastLiquidation['log_index']),
						String(lastLiquidation['tx_hash']),
						String(lastLiquidation['block_hash']),
						String(lastLiquidation['entity_type']),
						String(lastLiquidation['entity_identity']),
					] as const,
				}),
	}
	return json({
		chainId,
		asOf,
		data: {
			...entity,
			approvalEvents: risk.approvalEvents,
			history: {
				...pageRows,
				limit,
				offset,
				truncated: historyTruncated,
				nextCursor: historyTruncated ? riskHistoryCursorFor(chainId, historyIdentity, asOf, offset + limit, nextPositions) : undefined,
			},
		},
	})
}

const timelineCatalogResponse = async (sql: SQL, url: URL): Promise<Response> => {
	const chainId = integer(url.searchParams.get('chainId'), 'chainId')
	if (chainId === undefined) throw new ApiRequestError('chainId is required')
	const entityType = url.searchParams.get('entityType')?.trim() || undefined
	if (entityType !== undefined && !/^[a-z][a-z0-9-]{0,63}$/.test(entityType)) throw new ApiRequestError('entityType must be a lowercase semantic entity type')
	const event = url.searchParams.get('event')?.trim() || undefined
	if (event !== undefined && (event.length > 128 || !/^[A-Za-z][A-Za-z0-9_]*$/.test(event)))
		throw new ApiRequestError('event must be a complete semantic event name')
	const address = evmAddress(url.searchParams.get('address'), 'address')
	const query = url.searchParams.get('q')?.trim() || undefined
	if (query !== undefined && query.length > 128) throw new ApiRequestError('q must not exceed 128 characters')
	const fromBlock = postgresBigint(url.searchParams.get('fromBlock'), 'fromBlock') ?? '0'
	const toBlock = postgresBigint(url.searchParams.get('toBlock'), 'toBlock') ?? POSTGRES_BIGINT_MAX.toString()
	if (BigInt(fromBlock) > BigInt(toBlock)) throw new ApiRequestError('fromBlock must not exceed toBlock')
	const canonical = canonicalHistoryFilter(url)
	const filterIdentity = JSON.stringify({ entityType, event, address, query, fromBlock, toBlock, canonical })
	const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 100
	const limit = Math.min(Math.max(requestedLimit, 1), 250)
	const cursor = parseTimelineCatalogCursor(url.searchParams.get('cursor'), chainId, filterIdentity)
	const asOf = await operationsAsOfForContinuations(sql, chainId, cursor === undefined ? [] : [{ parts: cursor, offset: 2 }])
	const cursorBlock = cursor?.[8] ?? String(asOf['blockNumber'])
	const cursorLog = cursor?.[9] ?? 2_147_483_647
	const cursorTx = cursor?.[10] ?? `0x${'f'.repeat(64)}`
	const cursorBlockHash = cursor?.[11] ?? `0x${'f'.repeat(64)}`
	const cursorEntityType = cursor?.[12] ?? '\uffff'
	const cursorEntityIdentity = cursor?.[13] ?? '\uffff'
	const [rows, totalRows] = await Promise.all([
		sql`
			SELECT timeline.*, block.timestamp AS block_timestamp,
				CASE WHEN timeline.canonical THEN 'canonical'
					WHEN invalidation.reason = 'chain-reorg' THEN 'chain-orphaned'
					WHEN invalidation.reason = 'manifest-reset' THEN 'manifest-superseded'
					WHEN invalidation.reason = 'start-boundary-advanced' THEN 'coverage-reset'
					WHEN invalidation.reason = 'abi-redecode' THEN 'decode-superseded'
					WHEN invalidation.reason = 'projection-rebuild' THEN 'projection-superseded'
					ELSE 'noncanonical-unknown' END AS evidence_status,
				invalidation.id::text AS invalidation_id, invalidation.reason AS invalidation_reason,
				invalidation.causes AS invalidation_causes, invalidation.detected_at AS invalidated_at
			FROM protocol_timeline_entries timeline
			JOIN blocks block ON block.chain_id = timeline.chain_id AND block.hash = timeline.block_hash
			LEFT JOIN LATERAL (
				SELECT replacement.id, replacement.reason,
					COALESCE((SELECT jsonb_agg(cause.reason ORDER BY cause.reason) FROM history_invalidation_causes cause
						WHERE cause.invalidation_id = replacement.id), jsonb_build_array(replacement.reason)) AS causes,
					replacement.detected_at
				FROM history_invalidation_occurrences occurrence
				JOIN chain_reorganizations replacement ON replacement.id = occurrence.invalidation_id
				WHERE occurrence.occurrence_kind = 'log' AND occurrence.chain_id = timeline.chain_id
					AND occurrence.block_hash = timeline.block_hash AND occurrence.occurrence_id = timeline.tx_hash
					AND occurrence.sub_index = timeline.log_index
				ORDER BY replacement.id DESC LIMIT 1
			) invalidation ON true
			WHERE timeline.chain_id = ${chainId} AND timeline.block_number BETWEEN ${fromBlock} AND ${toBlock}
				AND timeline.block_number <= ${String(asOf['blockNumber'])}
				AND (${canonical === 'all'} OR timeline.canonical = ${canonical === 'canonical'})
				AND (${entityType ?? null}::text IS NULL OR timeline.entity_type = ${entityType ?? null})
				AND (${event ?? null}::text IS NULL OR timeline.semantic_event_kind = ${event ?? null})
				AND (${address ?? null}::text IS NULL OR timeline.source_contract = ${address ?? null}
					OR timeline.related_entities ? ${address ?? ''} OR timeline.summary_data::text ILIKE ${address === undefined ? '' : `%${address}%`})
				AND (${query ?? null}::text IS NULL OR timeline.entity_identity ILIKE ${query === undefined ? '' : `%${query}%`}
					OR timeline.semantic_event_kind ILIKE ${query === undefined ? '' : `%${query}%`}
					OR timeline.source_contract ILIKE ${query === undefined ? '' : `%${query}%`}
					OR timeline.summary_data::text ILIKE ${query === undefined ? '' : `%${query}%`})
				AND (timeline.block_number, timeline.log_index, timeline.tx_hash, timeline.block_hash, timeline.entity_type, timeline.entity_identity) <
					(${cursorBlock}::bigint, ${cursorLog}::integer, ${cursorTx}, ${cursorBlockHash}, ${cursorEntityType}, ${cursorEntityIdentity})
			ORDER BY timeline.block_number DESC, timeline.log_index DESC, timeline.tx_hash DESC,
				timeline.block_hash DESC, timeline.entity_type DESC, timeline.entity_identity DESC
			LIMIT ${limit + 1}
		`,
		sql`
			SELECT count(*)::text AS total FROM protocol_timeline_entries timeline
			WHERE timeline.chain_id = ${chainId} AND timeline.block_number BETWEEN ${fromBlock} AND ${toBlock}
				AND timeline.block_number <= ${String(asOf['blockNumber'])}
				AND (${canonical === 'all'} OR timeline.canonical = ${canonical === 'canonical'})
				AND (${entityType ?? null}::text IS NULL OR timeline.entity_type = ${entityType ?? null})
				AND (${event ?? null}::text IS NULL OR timeline.semantic_event_kind = ${event ?? null})
				AND (${address ?? null}::text IS NULL OR timeline.source_contract = ${address ?? null}
					OR timeline.related_entities ? ${address ?? ''} OR timeline.summary_data::text ILIKE ${address === undefined ? '' : `%${address}%`})
				AND (${query ?? null}::text IS NULL OR timeline.entity_identity ILIKE ${query === undefined ? '' : `%${query}%`}
					OR timeline.semantic_event_kind ILIKE ${query === undefined ? '' : `%${query}%`}
					OR timeline.source_contract ILIKE ${query === undefined ? '' : `%${query}%`}
					OR timeline.summary_data::text ILIKE ${query === undefined ? '' : `%${query}%`})
		`,
	])
	return json({
		chainId,
		asOf,
		filters: { entityType, event, address, query, fromBlock, toBlock, canonical },
		data: {
			...paged(rows, limit, (row) => timelineCatalogCursorFor(chainId, filterIdentity, asOf, row)),
			total: String(totalRows[0]?.['total'] ?? '0'),
		},
	})
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
	url.searchParams.set('limit', String(requestedLimit))
	const identity = `${entityType}:${entityIdentity}`
	const cursor = protocolCursorForRequest(url, chainId, 'timeline', identity)
	const asOf = await operationsAsOfForContinuations(sql, chainId, cursor === undefined ? [] : [{ parts: cursor, offset: 3 }])
	const page = detailPage(url, chainId, 'timeline', identity, asOf, cursor)
	const cursorBlock = page.cursor?.[9] ?? String(asOf['blockNumber'])
	const cursorTx = page.cursor?.[10] ?? `0x${'f'.repeat(64)}`
	const cursorLog = page.cursor?.[11] ?? 2_147_483_647
	const rows = await sql`
		SELECT timeline.*, block.timestamp AS block_timestamp FROM protocol_timeline_entries timeline
		JOIN blocks block ON block.chain_id = timeline.chain_id AND block.hash = timeline.block_hash
		WHERE timeline.chain_id = ${chainId} AND timeline.entity_type = ${entityType}
			AND timeline.entity_identity = ${entityIdentity} AND timeline.canonical
			AND (timeline.block_number, timeline.log_index, timeline.tx_hash) < (${cursorBlock}::bigint, ${cursorLog}::integer, ${cursorTx})
		ORDER BY timeline.block_number DESC, timeline.log_index DESC, timeline.tx_hash DESC LIMIT ${page.queryLimit}
	`
	return json({ chainId, asOf, data: paged(rows, page.limit, (row) => protocolCursorFor(chainId, 'timeline', identity, asOf, row)) })
}

const stateCatalog = async (sql: SQL, url: URL): Promise<Response> => {
	const chainId = integer(url.searchParams.get('chainId'), 'chainId')
	const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 500
	const limit = Math.min(Math.max(requestedLimit, 1), 1_000)
	const queryLimit = limit + 1
	const totals =
		chainId === undefined
			? await sql`SELECT
				(SELECT count(DISTINCT (chain_id, pool_address)) FROM pools WHERE canonical)::integer AS pools,
				(SELECT count(DISTINCT (chain_id, question_id)) FROM questions WHERE canonical)::integer AS questions,
				(SELECT count(DISTINCT (chain_id, pool_address, vault_address)) FROM vault_snapshots WHERE canonical)::integer AS vaults,
				(SELECT count(DISTINCT (chain_id, universe_id)) FROM universe_events WHERE canonical)::integer AS universes`
			: await sql`SELECT
				(SELECT count(DISTINCT pool_address) FROM pools WHERE chain_id = ${chainId} AND canonical)::integer AS pools,
				(SELECT count(DISTINCT question_id) FROM questions WHERE chain_id = ${chainId} AND canonical)::integer AS questions,
				(SELECT count(DISTINCT (pool_address, vault_address)) FROM vault_snapshots WHERE chain_id = ${chainId} AND canonical)::integer AS vaults,
				(SELECT count(DISTINCT universe_id) FROM universe_events WHERE chain_id = ${chainId} AND canonical)::integer AS universes`
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
		totals: totals[0],
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
	const fromBlock = postgresBigint(url.searchParams.get('fromBlock'), 'fromBlock') ?? '0'
	const toBlock = postgresBigint(url.searchParams.get('toBlock'), 'toBlock') ?? '9223372036854775807'
	if (BigInt(fromBlock) > BigInt(toBlock)) throw new ApiRequestError('fromBlock must not exceed toBlock')
	const queryLimit = limit + 1
	const chronological = <T>(rows: readonly T[]): T[] => rows.slice(0, limit).reverse()
	if (chainId === undefined) return json({ error: 'Invalid state identifier' }, 400)
	const validStateIdentity =
		(type === 'pools' && parts.length === 3 && /^0x[0-9a-fA-F]{40}$/.test(parts[2] ?? '')) ||
		(type === 'vaults' && parts.length === 4 && /^0x[0-9a-fA-F]{40}$/.test(parts[2] ?? '') && /^0x[0-9a-fA-F]{40}$/.test(parts[3] ?? '')) ||
		((type === 'universes' || type === 'questions') && parts.length === 3 && /^\d+$/.test(parts[2] ?? ''))
	if (!validStateIdentity) {
		if (type !== 'pools' && type !== 'vaults' && type !== 'universes' && type !== 'questions') return json({ error: 'Unknown state history type' }, 404)
		return json({ error: 'Invalid state identifier' }, 400)
	}
	rejectRawSnapshotOffset(url)
	const asOf = await operationsAsOf(sql, chainId)
	const networkRows = await sql`
		SELECT start_block::text, indexed_block::text, indexed_hash FROM networks WHERE chain_id = ${chainId}
	`
	const network = networkRows[0]
	if (network === undefined) throw new ApiRequestError('chainId is not configured')
	const indexedFromBlock = String(network['start_block'])
	const indexedThroughBlock = network['indexed_block'] === null ? undefined : String(network['indexed_block'])
	const requestedFromBlock = url.searchParams.has('fromBlock') ? fromBlock : indexedFromBlock
	const requestedToBlock = url.searchParams.has('toBlock') ? toBlock : indexedThroughBlock
	const historyIdentity = JSON.stringify({ type, identity: parts.slice(2).map((part) => part.toLowerCase()), fromBlock, toBlock, indexedFromBlock })
	const page = offsetPage(url, chainId, 'state-history', historyIdentity)
	if (page.identity !== historyIdentity) throw new ApiRequestError('cursor does not match filters')
	if (page.cursor !== undefined && !snapshotBoundaryMatches(page.cursor, 3, asOf)) throw new ApiConflictError('Indexed state changed; restart pagination')
	const offset = page.offset
	const rangeCovered =
		indexedThroughBlock !== undefined &&
		requestedToBlock !== undefined &&
		BigInt(requestedFromBlock) >= BigInt(indexedFromBlock) &&
		BigInt(requestedToBlock) <= BigInt(indexedThroughBlock)
	const coverage = (truncated: boolean, series: Record<string, number>) => ({
		requestedFromBlock,
		requestedToBlock: requestedToBlock ?? toBlock,
		indexedFromBlock,
		indexedThroughBlock,
		indexedThroughHash: network['indexed_hash'],
		limit,
		offset,
		series,
		complete: rangeCovered && offset === 0 && !truncated,
		rangeCovered,
		hasPreviousPages: offset > 0,
		...(truncated ? { nextCursor: offsetCursorFor(chainId, 'state-history', historyIdentity, asOf, offset + limit) } : {}),
	})
	if (type === 'pools') {
		const address = parts[2]?.toLowerCase()
		if (parts.length !== 3 || address === undefined || !/^0x[0-9a-f]{40}$/.test(address)) return json({ error: 'Invalid pool address' }, 400)
		const [snapshots, events, markets, ammPrices, repEthPrices, uniswapRepEthPrices, openOracleHistory] = await Promise.all([
			sql`SELECT s.*, b.timestamp FROM pool_snapshots s JOIN blocks b ON b.chain_id = s.chain_id AND b.hash = s.block_hash WHERE s.chain_id = ${chainId} AND s.pool_address = ${address} AND s.canonical AND s.block_number BETWEEN ${fromBlock} AND ${toBlock} ORDER BY s.block_number DESC, s.log_index DESC, s.tx_hash DESC, s.block_hash DESC LIMIT ${queryLimit} OFFSET ${offset}`,
			sql`SELECT e.*, b.timestamp FROM pool_state_events e JOIN blocks b ON b.chain_id = e.chain_id AND b.hash = e.block_hash WHERE e.chain_id = ${chainId} AND e.pool_address = ${address} AND e.canonical AND e.block_number BETWEEN ${fromBlock} AND ${toBlock} ORDER BY e.block_number DESC, e.log_index DESC, e.tx_hash DESC, e.block_hash DESC LIMIT ${queryLimit} OFFSET ${offset}`,
			sql`SELECT market.chain_id::text AS chain_id, market.block_hash, market.tx_hash, market.log_index, market.block_number::text AS block_number, market.pair_address, market.pool_address, market.share_token_address, market.universe_id::text AS universe_id, market.fee_bps::text AS fee_bps, market.canonical, block.timestamp FROM amm_markets market JOIN blocks block ON block.chain_id = market.chain_id AND block.hash = market.block_hash WHERE market.chain_id = ${chainId} AND market.pool_address = ${address} AND market.canonical ORDER BY market.block_number DESC, market.log_index DESC LIMIT 1`,
			sql`SELECT price.chain_id::text AS chain_id, price.block_hash, price.tx_hash, price.log_index, price.block_number::text AS block_number, price.pair_address, price.yes_reserve_atto_shares::text AS yes_reserve_atto_shares, price.no_reserve_atto_shares::text AS no_reserve_atto_shares, price.conditional_yes_bps::text AS conditional_yes_bps, price.conditional_no_bps::text AS conditional_no_bps, price.canonical, block.timestamp FROM amm_price_snapshots price JOIN blocks block ON block.chain_id = price.chain_id AND block.hash = price.block_hash JOIN amm_markets market ON market.chain_id = price.chain_id AND market.pair_address = price.pair_address AND market.canonical WHERE price.chain_id = ${chainId} AND market.pool_address = ${address} AND price.canonical AND price.block_number BETWEEN ${fromBlock} AND ${toBlock} ORDER BY price.block_number DESC, price.log_index DESC, price.tx_hash DESC, price.block_hash DESC, price.pair_address LIMIT ${queryLimit} OFFSET ${offset}`,
			sql`SELECT price.chain_id::text AS chain_id, price.block_hash, price.tx_hash, price.log_index, price.block_number::text AS block_number, price.coordinator_address, price.event_name, price.report_id::text AS report_id, price.rep_per_eth_1e18::text AS rep_per_eth_1e18, price.settlement_timestamp, price.canonical, block.timestamp FROM rep_eth_price_snapshots price JOIN blocks block ON block.chain_id = price.chain_id AND block.hash = price.block_hash JOIN pools pool ON pool.chain_id = price.chain_id AND pool.coordinator_address = price.coordinator_address AND pool.canonical WHERE price.chain_id = ${chainId} AND pool.pool_address = ${address} AND price.canonical AND price.block_number BETWEEN ${fromBlock} AND ${toBlock} ORDER BY price.block_number DESC, price.log_index DESC, price.tx_hash DESC, price.block_hash DESC, price.coordinator_address LIMIT ${queryLimit} OFFSET ${offset}`,
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
					JOIN blocks metadata_block ON metadata_block.chain_id = metadata.chain_id
						AND metadata_block.hash = metadata.block_hash AND metadata_block.canonical
					JOIN networks metadata_network ON metadata_network.chain_id = metadata.chain_id
					WHERE metadata.chain_id = market.chain_id AND metadata.address = quote_contract.address AND metadata.canonical
						AND metadata.read_block <= metadata_network.indexed_block
					ORDER BY metadata.read_block DESC LIMIT 1
				) quote_metadata ON true
				WHERE observation.chain_id = ${chainId} AND observation.canonical
					AND observation.block_number BETWEEN ${fromBlock} AND ${toBlock}
					AND CASE WHEN observation.venue = 'v2'
						THEN observation.reserve0 > 0 AND observation.reserve1 > 0
						ELSE observation.sqrt_price_x96 > 0
					END
				ORDER BY observation.block_number DESC, observation.log_index DESC, observation.tx_hash DESC,
					observation.block_hash DESC, observation.venue DESC, observation.market_id DESC
				LIMIT ${queryLimit} OFFSET ${offset}
			`,
			sql`SELECT log.block_number::text AS block_number, log.block_hash, log.tx_hash, log.log_index, log.event_name,
				log.arguments, log.summary, log.emitter_address AS coordinator_address, block.timestamp
				FROM logs log JOIN blocks block ON block.chain_id = log.chain_id AND block.hash = log.block_hash
				JOIN pools pool ON pool.chain_id = log.chain_id AND pool.coordinator_address = log.emitter_address AND pool.canonical
				WHERE log.chain_id = ${chainId} AND pool.pool_address = ${address} AND log.canonical
					AND log.block_number BETWEEN ${fromBlock} AND ${toBlock}
					AND log.event_name IN (
						'PriceRequested', 'PriceReportRejected', 'PriceReported', 'PendingReportRecovered', 'CoordinatorStateCheckpoint',
						'LiquidationRouteStaged', 'StagedOperationQueued', 'ExecutedStagedOperation', 'SecurityPoolSet'
					)
				ORDER BY log.block_number DESC, log.transaction_index DESC, log.log_index DESC, log.tx_hash DESC, log.block_hash DESC
				LIMIT ${queryLimit} OFFSET ${offset}`,
		])
		const truncated =
			snapshots.length > limit ||
			events.length > limit ||
			ammPrices.length > limit ||
			repEthPrices.length > limit ||
			uniswapRepEthPrices.length > limit ||
			openOracleHistory.length > limit
		return json({
			snapshots: chronological(snapshots),
			events: chronological(events),
			market: markets[0],
			ammPrices: chronological(ammPrices),
			repEthPrices: chronological(repEthPrices),
			uniswapRepEthPrices: chronological(uniswapRepEthPrices),
			openOracleHistory: chronological(openOracleHistory),
			truncated,
			limit,
			offset,
			coverage: coverage(truncated, {
				snapshots: Math.min(snapshots.length, limit),
				events: Math.min(events.length, limit),
				ammPrices: Math.min(ammPrices.length, limit),
				repEthPrices: Math.min(repEthPrices.length, limit),
				uniswapRepEthPrices: Math.min(uniswapRepEthPrices.length, limit),
				openOracleHistory: Math.min(openOracleHistory.length, limit),
			}),
		})
	}
	if (type === 'vaults') {
		const pool = parts[2]?.toLowerCase()
		const vault = parts[3]?.toLowerCase()
		if (parts.length !== 4 || pool === undefined || vault === undefined || !/^0x[0-9a-f]{40}$/.test(pool) || !/^0x[0-9a-f]{40}$/.test(vault))
			return json({ error: 'Invalid vault identifier' }, 400)
		const snapshots =
			await sql`SELECT v.*, b.timestamp FROM vault_snapshots v JOIN blocks b ON b.chain_id = v.chain_id AND b.hash = v.block_hash WHERE v.chain_id = ${chainId} AND v.pool_address = ${pool} AND v.vault_address = ${vault} AND v.canonical AND v.block_number BETWEEN ${fromBlock} AND ${toBlock} ORDER BY v.block_number DESC, v.log_index DESC, v.tx_hash DESC, v.block_hash DESC LIMIT ${queryLimit} OFFSET ${offset}`
		const truncated = snapshots.length > limit
		return json({
			snapshots: chronological(snapshots),
			truncated,
			limit,
			offset,
			coverage: coverage(truncated, { snapshots: Math.min(snapshots.length, limit) }),
		})
	}
	if (type === 'universes') {
		const universeId = parts[2]
		if (parts.length !== 3 || universeId === undefined || !/^\d+$/.test(universeId)) return json({ error: 'Invalid universe identifier' }, 400)
		const events =
			await sql`SELECT u.*, b.timestamp FROM universe_events u JOIN blocks b ON b.chain_id = u.chain_id AND b.hash = u.block_hash WHERE u.chain_id = ${chainId} AND u.universe_id = ${universeId} AND u.canonical AND u.block_number BETWEEN ${fromBlock} AND ${toBlock} ORDER BY u.block_number DESC, u.log_index DESC, u.tx_hash DESC, u.block_hash DESC LIMIT ${queryLimit} OFFSET ${offset}`
		const truncated = events.length > limit
		return json({ events: chronological(events), truncated, limit, offset, coverage: coverage(truncated, { events: Math.min(events.length, limit) }) })
	}
	if (type === 'questions') {
		const questionId = parts[2]
		if (parts.length !== 3 || questionId === undefined || !/^\d+$/.test(questionId)) return json({ error: 'Invalid question identifier' }, 400)
		const [pools, forks] = await Promise.all([
			sql`SELECT p.pool_address, p.universe_id, p.block_number, p.block_hash, p.tx_hash, p.log_index, b.timestamp FROM pools p JOIN blocks b ON b.chain_id = p.chain_id AND b.hash = p.block_hash WHERE p.chain_id = ${chainId} AND p.question_id = ${questionId} AND p.canonical AND p.block_number BETWEEN ${fromBlock} AND ${toBlock} ORDER BY p.block_number DESC, p.log_index DESC, p.tx_hash DESC, p.block_hash DESC, p.pool_address LIMIT ${queryLimit} OFFSET ${offset}`,
			sql`SELECT u.universe_id, u.block_number, u.block_hash, u.tx_hash, u.log_index, u.fork_time AS timestamp FROM universe_events u WHERE u.chain_id = ${chainId} AND u.fork_question_id = ${questionId} AND u.event_name = 'UniverseForked' AND u.canonical AND u.block_number BETWEEN ${fromBlock} AND ${toBlock} ORDER BY u.block_number DESC, u.log_index DESC, u.tx_hash DESC, u.block_hash DESC, u.universe_id LIMIT ${queryLimit} OFFSET ${offset}`,
		])
		const truncated = pools.length > limit || forks.length > limit
		return json({
			pools: chronological(pools),
			forks: chronological(forks),
			truncated,
			limit,
			offset,
			coverage: coverage(truncated, { pools: Math.min(pools.length, limit), forks: Math.min(forks.length, limit) }),
		})
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
	const cursor = parseAddressHistoryCursor(url.searchParams.get('cursor'), 'sent')
	if (cursor !== undefined && (cursor[2] !== chainId || cursor[3] !== address)) throw new ApiRequestError('cursor does not match the requested account')
	const asOf = await operationsAsOf(sql, chainId)
	if (
		cursor !== undefined &&
		(cursor[6] !== String(asOf['invalidationId']) ||
			cursor[7] !== String(asOf['abiSourceHash']) ||
			cursor[8] !== String(asOf['applicationSourceHash']) ||
			cursor[9] !== String(asOf['projectionSourceHash']))
	)
		throw new ApiConflictError('Indexed state changed; restart pagination')
	const anchorRows =
		cursor === undefined
			? await sql`SELECT transaction.block_number AS snapshot_block, transaction.block_hash AS snapshot_hash
				FROM transactions transaction
				JOIN blocks block ON block.chain_id = transaction.chain_id AND block.hash = transaction.block_hash AND block.canonical
				WHERE transaction.canonical AND transaction.chain_id = ${chainId} AND transaction.from_address = ${address}
				ORDER BY transaction.block_number DESC, transaction.transaction_index DESC LIMIT 1`
			: []
	const snapshotBlock = cursor?.[4] ?? String(anchorRows[0]?.['snapshot_block'] ?? 0)
	const snapshotHash = cursor?.[5] ?? String(anchorRows[0]?.['snapshot_hash'] ?? '')
	if (cursor !== undefined) {
		const validationRows = await sql`
			SELECT
				EXISTS (SELECT 1 FROM blocks WHERE chain_id = ${chainId} AND number = ${snapshotBlock} AND hash = ${snapshotHash} AND canonical) AS snapshot_canonical,
				(SELECT count(*) FROM transactions transaction
					JOIN blocks block ON block.chain_id = transaction.chain_id AND block.hash = transaction.block_hash AND block.canonical
					WHERE transaction.canonical AND transaction.chain_id = ${chainId} AND transaction.from_address = ${address}
						AND transaction.block_number <= ${snapshotBlock}) AS snapshot_total
		`
		if (validationRows[0]?.['snapshot_canonical'] !== true || Number(validationRows[0]?.['snapshot_total'] ?? -1) !== cursor[10])
			throw new ApiConflictError('Transaction history changed; restart pagination')
	}
	const values: Array<string | number> = [chainId, address, snapshotBlock]
	const cursorClause =
		cursor === undefined
			? ''
			: (() => {
					values.push(cursor[11], cursor[12])
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
	const total = cursor?.[10] ?? Number(rows[0]?.['snapshot_total'] ?? 0)
	const hasMore = rows.length > limit
	const pageRows = rows.slice(0, limit)
	const items = pageRows.map((row: Record<string, unknown>) =>
		decodedJsonColumns(Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'snapshot_total')), actionJsonColumns),
	)
	return json({
		items,
		total,
		limit,
		snapshotBlock,
		nextCursor:
			hasMore && pageRows.length > 0
				? addressHistoryCursorFor('sent', chainId, address, snapshotBlock, snapshotHash, asOf, total, pageRows[pageRows.length - 1] as Record<string, unknown>)
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
	const cursor = parseAddressHistoryCursor(url.searchParams.get('cursor'), 'referenced')
	if (cursor !== undefined && (cursor[2] !== chainId || cursor[3] !== address)) throw new ApiRequestError('cursor does not match the requested account')
	const asOf = await operationsAsOf(sql, chainId)
	if (
		cursor !== undefined &&
		(cursor[6] !== String(asOf['invalidationId']) ||
			cursor[7] !== String(asOf['abiSourceHash']) ||
			cursor[8] !== String(asOf['applicationSourceHash']) ||
			cursor[9] !== String(asOf['projectionSourceHash']))
	)
		throw new ApiConflictError('Indexed state changed; restart pagination')
	const anchorRows =
		cursor === undefined
			? await sql`
				SELECT activity.block_number AS snapshot_block, activity.block_hash AS snapshot_hash
				FROM address_activity activity
				JOIN blocks block ON block.chain_id = activity.chain_id AND block.hash = activity.block_hash AND block.canonical
				JOIN transactions transaction ON transaction.chain_id = activity.chain_id AND transaction.block_hash = activity.block_hash
					AND transaction.hash = activity.tx_hash AND transaction.canonical
				WHERE activity.canonical AND activity.role = 'referenced' AND activity.chain_id = ${chainId} AND activity.address = ${address}
				ORDER BY activity.block_number DESC, transaction.transaction_index DESC LIMIT 1`
			: []
	const snapshotBlock = cursor?.[4] ?? String(anchorRows[0]?.['snapshot_block'] ?? 0)
	const snapshotHash = cursor?.[5] ?? String(anchorRows[0]?.['snapshot_hash'] ?? '')
	if (cursor !== undefined) {
		const validationRows = await sql`
			SELECT
				EXISTS (SELECT 1 FROM blocks WHERE chain_id = ${chainId} AND number = ${snapshotBlock} AND hash = ${snapshotHash} AND canonical) AS snapshot_canonical,
				(SELECT count(*) FROM (
					SELECT activity.block_hash, activity.tx_hash
					FROM address_activity activity
					JOIN blocks block ON block.chain_id = activity.chain_id AND block.hash = activity.block_hash AND block.canonical
					JOIN transactions transaction ON transaction.chain_id = activity.chain_id AND transaction.block_hash = activity.block_hash
						AND transaction.hash = activity.tx_hash AND transaction.canonical
					WHERE activity.canonical AND activity.role = 'referenced' AND activity.chain_id = ${chainId}
						AND activity.address = ${address} AND activity.block_number <= ${snapshotBlock}
					GROUP BY activity.block_hash, activity.tx_hash
				) interaction) AS snapshot_total
		`
		if (validationRows[0]?.['snapshot_canonical'] !== true || Number(validationRows[0]?.['snapshot_total'] ?? -1) !== cursor[10])
			throw new ApiConflictError('Interaction history changed; restart pagination')
	}
	const values: Array<string | number> = [chainId, address, snapshotBlock]
	const cursorClause =
		cursor === undefined
			? ''
			: (() => {
					values.push(cursor[11], cursor[12])
					return `WHERE (interaction.block_number, interaction.transaction_index) < ($${values.length - 1}::bigint, $${values.length}::integer)`
				})()
	values.push(limit + 1)
	const rows = await sql.unsafe(
		`WITH interactions AS (
			SELECT activity.chain_id, activity.block_hash, activity.block_number, activity.tx_hash,
				transaction.transaction_index,
				array_agg(DISTINCT activity.role ORDER BY activity.role) AS roles,
				array_agg(DISTINCT activity.pool_address ORDER BY activity.pool_address)
					FILTER (WHERE activity.pool_address <> '0x0000000000000000000000000000000000000000') AS pool_addresses,
				count(*) OVER () AS snapshot_total
			FROM address_activity activity
			JOIN blocks block ON block.chain_id = activity.chain_id AND block.hash = activity.block_hash AND block.canonical
			JOIN transactions transaction ON transaction.chain_id = activity.chain_id AND transaction.block_hash = activity.block_hash
				AND transaction.hash = activity.tx_hash AND transaction.canonical
			WHERE activity.canonical AND activity.role = 'referenced' AND activity.chain_id = $1 AND activity.address = $2
				AND activity.block_number <= $3::bigint
			GROUP BY activity.chain_id, activity.block_hash, activity.block_number, activity.tx_hash, transaction.transaction_index
		)
		SELECT interaction.*, transaction.from_address, transaction.to_address,
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
		${cursorClause}
		ORDER BY interaction.block_number DESC, interaction.transaction_index DESC
		LIMIT $${values.length}`,
		values,
	)
	const total = cursor?.[10] ?? Number(rows[0]?.['snapshot_total'] ?? 0)
	const hasMore = rows.length > limit
	const pageRows = rows.slice(0, limit)
	return json({
		items: pageRows.map((row: Record<string, unknown>) =>
			decodedJsonColumns(Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'snapshot_total')), actionJsonColumns),
		),
		total,
		limit,
		snapshotBlock,
		nextCursor:
			hasMore && pageRows.length > 0
				? addressHistoryCursorFor(
						'referenced',
						chainId,
						address,
						snapshotBlock,
						snapshotHash,
						asOf,
						total,
						pageRows[pageRows.length - 1] as Record<string, unknown>,
					)
				: undefined,
	})
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
	const offset = boundedInteger(url.searchParams.get('offset'), 'offset', 100_000) ?? 0
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
			JOIN blocks observed_block ON observed_block.chain_id = snapshot.chain_id
				AND observed_block.hash = snapshot.block_hash AND observed_block.canonical
			JOIN networks observed_network ON observed_network.chain_id = snapshot.chain_id
			WHERE snapshot.canonical AND snapshot.block_number <= observed_network.indexed_block AND (
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
			SELECT DISTINCT ON (metadata.chain_id, metadata.address)
				metadata.chain_id, metadata.address, metadata.name, metadata.symbol, metadata.decimals
			FROM token_metadata metadata
			JOIN blocks observed_block ON observed_block.chain_id = metadata.chain_id
				AND observed_block.hash = metadata.block_hash AND observed_block.canonical
			JOIN networks observed_network ON observed_network.chain_id = metadata.chain_id
			WHERE metadata.canonical AND metadata.read_block <= observed_network.indexed_block
			ORDER BY metadata.chain_id, metadata.address, metadata.read_block DESC
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

type PortfolioCollection = 'forks' | 'lp' | 'reports'
type PortfolioCursor = readonly [number, string, PortfolioCollection, string, string, string, string, string, string, number, number]

const parsePortfolioCursor = (
	value: string | null,
	chainId: number,
	address: string,
	kind: PortfolioCollection,
): { readonly total: number; readonly offset: number; readonly cursor?: PortfolioCursor } => {
	if (value === null) return { total: 0, offset: 0 }
	let parts: unknown[]
	try {
		const parsed = decodeOpaqueCursor(value)
		parts = Array.isArray(parsed) ? parsed : []
	} catch (error) {
		throw new ApiRequestError(`${kind}Cursor is invalid`, { cause: error })
	}
	if (
		parts.length !== 11 ||
		!isNonNegativeSafeInteger(parts[0]) ||
		typeof parts[1] !== 'string' ||
		(parts[2] !== 'forks' && parts[2] !== 'lp' && parts[2] !== 'reports') ||
		!isPostgresBigint(parts[3]) ||
		typeof parts[4] !== 'string' ||
		!/^0x[0-9a-f]{64}$/.test(parts[4]) ||
		!isPostgresBigint(parts[5]) ||
		!parts.slice(6, 9).every((part) => typeof part === 'string') ||
		!isNonNegativeSafeInteger(parts[9]) ||
		!isNonNegativeSafeInteger(parts[10]) ||
		parts[10] > parts[9]
	)
		throw new ApiRequestError(`${kind}Cursor is invalid`)
	if (parts[0] !== chainId || parts[1] !== address || parts[2] !== kind) throw new ApiRequestError(`${kind}Cursor does not match the requested collection`)
	return {
		total: parts[9],
		offset: parts[10],
		cursor: parts as [number, string, PortfolioCollection, string, string, string, string, string, string, number, number],
	}
}

const portfolioCursorFor = (
	chainId: number,
	address: string,
	kind: PortfolioCollection,
	asOf: Record<string, unknown>,
	total: number,
	offset: number,
): string => encodeOpaqueCursor([chainId, address, kind, ...snapshotBoundary(asOf), total, offset] satisfies PortfolioCursor)

const addressPortfolioResponse = async (sql: SQL, url: URL): Promise<Response> => {
	const chainId = integer(url.searchParams.get('chainId'), 'chainId')
	if (chainId === undefined) throw new ApiRequestError('chainId is required')
	const address = evmAddress(url.searchParams.get('address'), 'address')
	if (address === undefined) throw new ApiRequestError('address is required')
	const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 100
	const limit = Math.min(Math.max(requestedLimit, 1), 100)
	const lpPage = parsePortfolioCursor(url.searchParams.get('lpCursor'), chainId, address, 'lp')
	const forkPage = parsePortfolioCursor(url.searchParams.get('forkCursor'), chainId, address, 'forks')
	const reportPage = parsePortfolioCursor(url.searchParams.get('reportCursor'), chainId, address, 'reports')
	const asOf = await operationsAsOfForContinuations(
		sql,
		chainId,
		[lpPage.cursor, forkPage.cursor, reportPage.cursor].flatMap((cursor) => (cursor === undefined ? [] : [{ parts: cursor, offset: 3 }])),
	)
	const snapshotBlock = String(asOf['blockNumber'])
	const requestUrl = new URL(url)
	requestUrl.pathname = '/api/v1/richlist'
	requestUrl.search = new URLSearchParams({ chainId: String(chainId), address, limit: '1' }).toString()
	const [portfolioResponse, lpRows, forkRows, reportRows] = await Promise.all([
		richList(sql, requestUrl),
		sql`
			WITH transfers AS (
				SELECT event.market_address, lower(event.event_data->>'from') AS from_address,
					lower(event.event_data->>'to') AS to_address, (event.event_data->>'amount')::numeric AS amount
				FROM amm_trade_events event
				WHERE event.chain_id = ${chainId} AND event.canonical AND event.block_number <= ${snapshotBlock}
					AND event.event_name = 'Transfer' AND event.event_data ? 'from'
					AND event.event_data ? 'to' AND event.event_data ? 'amount'
			), deltas AS (
				SELECT transfer.market_address, transfer.amount AS balance_delta FROM transfers transfer WHERE transfer.to_address = ${address}
				UNION ALL
				SELECT transfer.market_address, -transfer.amount FROM transfers transfer WHERE transfer.from_address = ${address}
			), balances AS (
				SELECT delta.market_address, sum(delta.balance_delta) AS balance FROM deltas delta GROUP BY delta.market_address
			), transfer_counts AS (
				SELECT transfer.market_address, count(*)::integer AS transfer_count FROM transfers transfer
				WHERE transfer.from_address = ${address} OR transfer.to_address = ${address} GROUP BY transfer.market_address
			), positions AS (
				SELECT balance.market_address, balance.balance, transfer_count.transfer_count,
					market.pool_address, question.title AS question_title
				FROM balances balance JOIN transfer_counts transfer_count USING (market_address)
				LEFT JOIN amm_markets market ON market.chain_id = ${chainId}
					AND market.pair_address = balance.market_address AND market.canonical
				LEFT JOIN pools pool ON pool.chain_id = market.chain_id AND pool.pool_address = market.pool_address AND pool.canonical
				LEFT JOIN questions question ON question.chain_id = pool.chain_id AND question.question_id = pool.question_id AND question.canonical
				WHERE balance.balance <> 0
			), totals AS (SELECT count(*)::integer AS total FROM positions)
			SELECT page.market_address, page.balance::text, page.transfer_count, page.pool_address, page.question_title, totals.total
			FROM totals LEFT JOIN LATERAL (
				SELECT * FROM positions ORDER BY balance DESC, market_address LIMIT ${limit} OFFSET ${lpPage.offset}
			) page ON true
		`,
		sql`
			WITH participation AS (
				SELECT universe_identity, event_name, event_data, block_number, block_hash, tx_hash, log_index
				FROM fork_migration_events event
				WHERE event.chain_id = ${chainId} AND event.canonical AND event.block_number <= ${snapshotBlock} AND (
					lower(event.event_data->>'migrator') = ${address} OR lower(event.event_data->>'vault') = ${address}
					OR lower(event.event_data->>'recipient') = ${address}
				)
			), totals AS (SELECT count(*)::integer AS total FROM participation)
			SELECT page.universe_identity, page.event_name, page.event_data, page.block_number::text,
				page.block_hash, page.tx_hash, page.log_index, totals.total
			FROM totals LEFT JOIN LATERAL (
				SELECT * FROM participation ORDER BY block_number DESC, log_index DESC, tx_hash DESC, block_hash DESC, universe_identity
				LIMIT ${limit} OFFSET ${forkPage.offset}
			) page ON true
		`,
		sql`
			WITH participation AS (
				SELECT open_oracle_address, report_id, event_name, round_number, report_data,
					block_number, block_hash, tx_hash, log_index
				FROM open_oracle_report_events event
				WHERE event.chain_id = ${chainId} AND event.canonical AND event.block_number <= ${snapshotBlock}
					AND lower(event.report_data->>'currentReporter') = ${address}
			), totals AS (SELECT count(*)::integer AS total FROM participation)
			SELECT page.open_oracle_address, page.report_id::text, page.event_name, page.round_number::text,
				page.report_data, page.block_number::text, page.block_hash, page.tx_hash, page.log_index, totals.total
			FROM totals LEFT JOIN LATERAL (
				SELECT * FROM participation ORDER BY block_number DESC, log_index DESC, tx_hash DESC, block_hash DESC,
					open_oracle_address, report_id
				LIMIT ${limit} OFFSET ${reportPage.offset}
			) page ON true
		`,
	])
	const payload: unknown = await portfolioResponse.json()
	const payloadRecord = jsonRecord(payload)
	const items = Array.isArray(payloadRecord['items']) ? payloadRecord['items'] : []
	const collection = (
		kind: PortfolioCollection,
		rows: readonly Record<string, unknown>[],
		page: { readonly total: number; readonly offset: number },
		identityField: string,
	) => {
		const total = Number(rows[0]?.['total'] ?? 0)
		if (page.offset > 0 && page.total !== total) throw new ApiConflictError('Portfolio history changed; restart pagination')
		const collectionItems = rows
			.filter((row) => row[identityField] !== null)
			.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'total')))
		const nextOffset = page.offset + collectionItems.length
		const hasMore = nextOffset < total
		return {
			items: collectionItems,
			page: {
				total,
				limit,
				offset: page.offset,
				hasMore,
				...(hasMore ? { nextCursor: portfolioCursorFor(chainId, address, kind, asOf, total, nextOffset) } : {}),
			},
		}
	}
	const lp = collection('lp', lpRows, lpPage, 'market_address')
	const forks = collection('forks', forkRows, forkPage, 'universe_identity')
	const reports = collection('reports', reportRows, reportPage, 'open_oracle_address')
	const base = items[0]
	return json({
		chainId,
		asOf,
		data: {
			...jsonRecord(base),
			...(base === undefined ? { address, availability: 'Awaiting indexed evidence' } : {}),
			lp_positions: lp.items,
			fork_participation: forks.items,
			report_participation: reports.items,
			portfolioPagination: { lp: lp.page, forks: forks.page, reports: reports.page },
		},
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
			return json({ items: rows.map((row: Record<string, unknown>) => decodedJsonColumns(row, actionJsonColumns)) })
		}
		if (url.pathname === '/api/v1/logs') return await listLogs(sql, url)
		if (url.pathname.startsWith('/api/v1/logs/')) return await logDetail(sql, url.pathname.slice('/api/v1/logs/'.length).split('/'), url)
		if (url.pathname === '/api/v1/reorgs') return await reorganizationHistory(sql, url)
		if (url.pathname === '/api/v1/provenance') return await provenanceHistory(sql, url)
		if (url.pathname === '/api/v1/export') return await historicalExport(sql, url)
		if (url.pathname === '/api/v1/operations') return await operationsResponse(sql, url)
		if (url.pathname === '/api/v1/state/reports') return await domainCatalogResponse(sql, url, 'reports')
		if (url.pathname === '/api/v1/state/escalations') return await domainCatalogResponse(sql, url, 'escalations')
		if (url.pathname === '/api/v1/state/auctions') return await domainCatalogResponse(sql, url, 'auctions')
		if (url.pathname === '/api/v1/state/risk') return await domainCatalogResponse(sql, url, 'risk')
		if (url.pathname === '/api/v1/state/forks') return await domainCatalogResponse(sql, url, 'forks')
		if (url.pathname === '/api/v1/state/trading') return await tradingCatalogResponse(sql, url)
		if (url.pathname === '/api/v1/state/integrity') return await integrityCatalogResponse(sql, url)
		if (url.pathname === '/api/v1/state/direct-observations') return await directObservationsResponse(sql, url)
		if (url.pathname.startsWith('/api/v1/state/reports/'))
			return await reportDetailResponse(sql, url.pathname.slice('/api/v1/state/reports/'.length).split('/'), url)
		if (url.pathname.startsWith('/api/v1/state/escalations/'))
			return await eventEntityDetailResponse(sql, url.pathname.slice('/api/v1/state/escalations/'.length).split('/'), url, 'escalation')
		if (url.pathname.startsWith('/api/v1/state/auctions/'))
			return await eventEntityDetailResponse(sql, url.pathname.slice('/api/v1/state/auctions/'.length).split('/'), url, 'auction')
		if (url.pathname.startsWith('/api/v1/state/forks/')) return await forkDetailResponse(sql, url.pathname.slice('/api/v1/state/forks/'.length).split('/'), url)
		if (url.pathname.startsWith('/api/v1/state/risk/')) return await riskDetailResponse(sql, url.pathname.slice('/api/v1/state/risk/'.length).split('/'), url)
		if (url.pathname.startsWith('/api/v1/state/trading/'))
			return await tradingDetailResponse(sql, url.pathname.slice('/api/v1/state/trading/'.length).split('/'), url)
		if (url.pathname === '/api/v1/state/address-portfolio') return await addressPortfolioResponse(sql, url)
		if (url.pathname === '/api/v1/state/timeline') return await timelineCatalogResponse(sql, url)
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
			if (chainId === undefined) throw new ApiRequestError('chainId is required')
			const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 100
			const limit = Math.min(Math.max(requestedLimit, 1), 250)
			if (url.searchParams.has('offset')) throw new ApiRequestError('offset requires a snapshot-bound cursor')
			const cursor = parseActionCursor(url.searchParams.get('cursor'), chainId)
			const asOf = await operationsAsOfForContinuations(sql, chainId, cursor === undefined ? [] : [{ parts: cursor, offset: 2 }])
			const values: Array<string | number> = []
			const clauses = ['t.canonical', 'block.canonical']
			const bind = (value: string | number): string => {
				values.push(value)
				return `$${values.length}`
			}
			clauses.push(`a.chain_id = ${bind(chainId)}`)
			if (cursor !== undefined)
				clauses.push(
					`(block.timestamp, t.block_number, t.transaction_index, a.block_hash, a.tx_hash) < (${bind(cursor[8])}::timestamptz, ${bind(cursor[9])}::bigint, ${bind(cursor[10])}, ${bind(cursor[11])}, ${bind(cursor[12])})`,
				)
			values.push(limit + 1)
			const rows = await sql.unsafe(
				`SELECT a.*, t.block_number, t.transaction_index, t.from_address, t.to_address, t.status, t.value,
					block.timestamp AS block_timestamp, n.id AS network_id
				FROM actions a
				JOIN transactions t ON t.chain_id = a.chain_id AND t.block_hash = a.block_hash AND t.hash = a.tx_hash
				JOIN blocks block ON block.chain_id = a.chain_id AND block.hash = a.block_hash
				JOIN networks n ON n.chain_id = a.chain_id
				WHERE ${clauses.join(' AND ')}
				ORDER BY block.timestamp DESC, a.chain_id DESC, t.block_number DESC, t.transaction_index DESC, a.block_hash DESC, a.tx_hash DESC
				LIMIT $${values.length}`,
				values,
			)
			const hasMore = rows.length > limit
			const pageRows = rows.slice(0, limit)
			return json({
				items: pageRows.map((row: Record<string, unknown>) => decodedJsonColumns(row, actionJsonColumns)),
				limit,
				asOf,
				nextCursor: hasMore && pageRows.length > 0 ? actionCursorFor(chainId, asOf, pageRows[pageRows.length - 1] as Record<string, unknown>) : undefined,
			})
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
