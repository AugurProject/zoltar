import type { SQL } from 'bun'
import type { JsonValue } from '../ethereum.ts'

type CanonicalHistoryFilter = 'canonical' | 'orphaned' | 'all'

export type LogListQuery = {
	readonly chainId: number
	readonly event: string | null
	readonly address: string | null
	readonly decoded: 'true' | 'false' | null
	readonly canonical: CanonicalHistoryFilter
	readonly limit: number
	readonly cursor?: readonly JsonValue[]
}

export const logListRows = async (sql: SQL, query: LogListQuery) => {
	const values: Array<string | number> = []
	const clauses = query.canonical === 'all' ? ['true'] : [`l.canonical = ${query.canonical === 'canonical' ? 'true' : 'false'}`]
	const bind = (value: string | number): string => {
		values.push(value)
		return `$${values.length}`
	}
	clauses.push(`l.chain_id = ${bind(query.chainId)}`)
	if (query.event !== null) clauses.push(`l.event_name ILIKE ${bind(`%${query.event}%`)}`)
	if (query.address !== null) {
		const addressParameter = bind(query.address)
		const addressPatternParameter = bind(`%${query.address}%`)
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
	if (query.decoded === 'true') clauses.push("l.decode_status = 'decoded'")
	if (query.decoded === 'false') clauses.push("l.decode_status <> 'decoded'")
	if (query.cursor !== undefined) {
		clauses.push(
			`(b.timestamp, l.block_number, l.transaction_index, l.log_index, l.block_hash) < (${bind(String(query.cursor[12]))}::timestamptz, ${bind(String(query.cursor[13]))}::bigint, ${bind(Number(query.cursor[14]))}, ${bind(Number(query.cursor[15]))}, ${bind(String(query.cursor[16]))})`,
		)
	}
	values.push(query.limit + 1)
	return await sql.unsafe(
		`SELECT l.*, b.timestamp AS block_timestamp, b.hash AS canonical_block_hash, t.from_address AS origin_address, t.to_address, a.function_name, a.function_signature, a.summary AS action_summary, c.label AS contract_label, c.kind AS contract_kind, n.id AS network_id, n.name AS network_name, n.explorer_base_url,
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
}

export const logDetailData = async (sql: SQL, chainId: number, blockHash: string, hash: string, logIndex: number, canonicalOnly: boolean) => {
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
			AND l.chain_id = ${chainId} AND l.block_hash = ${blockHash} AND l.tx_hash = ${hash} AND l.log_index = ${logIndex}
	`
	if (rows.length === 0) return { rows, related: [], logInterpretations: [], actionInterpretations: [] }
	const [related, logInterpretations, actionInterpretations] = await Promise.all([
		sql`SELECT log_index, emitter_address, event_name, summary, canonical FROM logs
			WHERE (${canonicalOnly} = false OR canonical) AND chain_id = ${chainId} AND block_hash = ${blockHash} AND tx_hash = ${hash}
			ORDER BY log_index`,
		sql`SELECT interpretation_kind, interpretation_key, indexer_run_id::text, abi_source_hash,
			application_source_hash, projection_source_hash, interpretation, interpreted_at FROM log_interpretations
			WHERE chain_id = ${chainId} AND block_hash = ${blockHash} AND tx_hash = ${hash} AND log_index = ${logIndex}
			ORDER BY interpreted_at DESC, indexer_run_id DESC, interpretation_kind, interpretation_key`,
		sql`SELECT indexer_run_id::text, abi_source_hash, application_source_hash, interpretation, interpreted_at
			FROM action_interpretations WHERE chain_id = ${chainId} AND block_hash = ${blockHash} AND tx_hash = ${hash}
			ORDER BY interpreted_at DESC, indexer_run_id DESC`,
	])
	return { rows, related, logInterpretations, actionInterpretations }
}

export const reorganizationHistoryData = async (sql: SQL, chainId: number, snapshotInvalidationId: string, limit: number, cursor?: readonly JsonValue[]) => {
	const cursorClause = cursor === undefined ? sql`` : sql`AND (reorganization.detected_at, reorganization.id) < (${String(cursor[8])}, ${String(cursor[9])})`
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
	const totalRows = await sql`SELECT count(*)::text AS total FROM chain_reorganizations WHERE chain_id = ${chainId} AND id <= ${snapshotInvalidationId}`
	return { rows, totalRows }
}

export const provenanceHistoryData = async (sql: SQL, limit: number, cursor?: readonly JsonValue[]) => {
	const values: Array<string | number> = []
	const cursorClause =
		cursor === undefined
			? ''
			: (() => {
					values.push(String(cursor[1]), String(cursor[2]))
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
	return { migrations, runRows }
}
