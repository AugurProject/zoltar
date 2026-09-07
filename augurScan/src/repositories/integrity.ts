import type { SQL } from 'bun'

export const latestInvalidationId = async (sql: SQL, chainId: number) =>
	await sql`SELECT COALESCE(max(id), 0)::text AS id FROM chain_reorganizations WHERE chain_id = ${chainId}`

export const integrityCatalogData = async (
	sql: SQL,
	query: {
		readonly chainId: number
		readonly snapshotId: string
		readonly limit: number
		readonly cursor?: { readonly detectedAt: string; readonly id: string }
	},
) => {
	const { chainId, snapshotId, limit, cursor } = query
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
					(${cursor?.detectedAt ?? '9999-12-31T23:59:59.999Z'}::timestamptz, ${cursor?.id ?? '0'}::bigint))
			ORDER BY reorganization.detected_at DESC, reorganization.id DESC LIMIT ${limit + 1}`,
		sql`SELECT schema_version, description, applied_at FROM augurscan_schema_migrations ORDER BY applied_at, schema_version`,
		sql`SELECT id::text, schema_version, app_version, abi_source_hash, application_source_hash,
			projection_source_hash, indexer_enabled, network_configuration, started_at, stopped_at
			FROM indexer_runs ORDER BY started_at DESC, id DESC LIMIT 25`,
	])
	return { reorganizations, migrations, runs }
}
