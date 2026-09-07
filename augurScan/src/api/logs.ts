import type { SQL } from 'bun'
import { decodeOpaqueCursor, encodeOpaqueCursor } from '../cursor-codec.ts'
import { snapshotBoundary } from './entity-details.ts'
import { operationsAsOfForContinuations } from './snapshot.ts'
import {
	ApiRequestError,
	actionJsonColumns,
	canonicalHistoryFilter,
	cursorTimestamp,
	decodedJsonColumns,
	directObservationTotal,
	evmAddress,
	integer,
	isCursorTimestamp,
	isNonNegativeSafeInteger,
	isPostgresBigint,
	json,
	logCursorFor,
	parseLogCursor,
	routeInteger,
} from './shared.ts'

export const listLogs = async (sql: SQL, url: URL): Promise<Response> => {
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

export const logDetail = async (sql: SQL, parts: readonly string[], url: URL): Promise<Response> => {
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

export type ReorganizationCursor = readonly [
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

export const isReorganizationCursor = (parts: readonly unknown[]): parts is ReorganizationCursor =>
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

export const parseReorganizationCursor = (value: string | null, chainId: number): ReorganizationCursor | undefined => {
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

export const reorganizationCursorFor = (chainId: number, asOf: Record<string, unknown>, row: Record<string, unknown>): string =>
	encodeOpaqueCursor([1, chainId, ...snapshotBoundary(asOf), cursorTimestamp(row['cursor_detected_at']), String(row['id'])] satisfies ReorganizationCursor)

export const reorganizationHistory = async (sql: SQL, url: URL): Promise<Response> => {
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

export type ProvenanceCursor = readonly [version: 1, startedAt: string, runId: string]

export const parseProvenanceCursor = (value: string | null): ProvenanceCursor | undefined => {
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

export const provenanceHistory = async (sql: SQL, url: URL): Promise<Response> => {
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
