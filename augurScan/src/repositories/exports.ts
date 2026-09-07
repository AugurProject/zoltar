import type { SQL } from 'bun'

type CanonicalHistoryFilter = 'canonical' | 'orphaned' | 'all'

type HistoricalExportDataset = 'logs' | 'timeline' | 'reorgs'

export type HistoricalExportQuery = {
	readonly dataset: HistoricalExportDataset
	readonly chainId: number
	readonly canonical: CanonicalHistoryFilter
	readonly fromBlock: string
	readonly toBlock: string
	readonly snapshotBlock: string
	readonly snapshotInvalidationId: string
	readonly limit: number
	readonly lastKey?: readonly string[]
}

const ZERO_HASH = `0x${'0'.repeat(64)}`

export const historicalExportSnapshot = async (sql: SQL, chainId: number) =>
	await sql`
		SELECT COALESCE(network.indexed_block, 0)::text AS snapshot_block,
			COALESCE(network.indexed_hash, ${ZERO_HASH}) AS snapshot_hash,
			COALESCE((SELECT max(id) FROM chain_reorganizations WHERE chain_id = ${chainId}), 0)::text AS invalidation_id,
			COALESCE(network.applied_abi_source_hash, 'unavailable') AS abi_source_hash,
			COALESCE(network.applied_application_source_hash, 'unavailable') AS application_source_hash,
			COALESCE(network.applied_projection_source_hash, 'unavailable') AS projection_source_hash
		FROM networks network WHERE network.chain_id = ${chainId}
	`

export const historicalExportSnapshotCanonical = async (sql: SQL, chainId: number, snapshotBlock: string, snapshotHash: string) =>
	await sql`
		SELECT (${snapshotBlock} = '0' AND ${snapshotHash} = ${ZERO_HASH}) OR EXISTS (
			SELECT 1 FROM blocks WHERE chain_id = ${chainId} AND number = ${snapshotBlock} AND hash = ${snapshotHash} AND canonical
		) AS snapshot_canonical
	`

export const historicalExportTotal = async (sql: SQL, query: Omit<HistoricalExportQuery, 'limit' | 'lastKey'>) => {
	const { dataset, chainId, canonical, fromBlock, toBlock, snapshotBlock, snapshotInvalidationId } = query
	if (dataset === 'logs')
		return await sql`SELECT count(*)::text AS total FROM logs log
			WHERE log.chain_id = ${chainId} AND log.block_number BETWEEN ${fromBlock} AND ${toBlock}
				AND log.block_number <= ${snapshotBlock} AND (${canonical === 'all'} OR log.canonical = ${canonical === 'canonical'})`
	if (dataset === 'timeline')
		return await sql`SELECT count(*)::text AS total FROM protocol_timeline_entries timeline
			WHERE timeline.chain_id = ${chainId} AND timeline.block_number BETWEEN ${fromBlock} AND ${toBlock}
				AND timeline.block_number <= ${snapshotBlock} AND (${canonical === 'all'} OR timeline.canonical = ${canonical === 'canonical'})`
	return await sql`SELECT count(*)::text AS total FROM chain_reorganizations
		WHERE chain_id = ${chainId} AND id <= ${snapshotInvalidationId} AND (
			reason = 'start-boundary-advanced' OR COALESCE(previous_block, ancestor_block) BETWEEN ${fromBlock} AND ${toBlock}
		)`
}

export const historicalExportRows = async (sql: SQL, query: HistoricalExportQuery) => {
	const { dataset, chainId, canonical, fromBlock, toBlock, snapshotBlock, snapshotInvalidationId, limit, lastKey } = query
	if (dataset === 'logs')
		return await sql`
			SELECT log.chain_id, log.block_number::text, log.block_hash, log.tx_hash, log.log_index,
				log.transaction_index, log.emitter_address, log.topics, log.data, log.event_name, log.event_signature,
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
				SELECT jsonb_agg(jsonb_build_object(
					'interpretation_kind', interpretation.interpretation_kind,
					'interpretation_key', interpretation.interpretation_key,
					'indexer_run_id', interpretation.indexer_run_id::text,
					'schema_version', run.schema_version, 'app_version', run.app_version,
					'abi_source_hash', interpretation.abi_source_hash,
					'application_source_hash', interpretation.application_source_hash,
					'projection_source_hash', interpretation.projection_source_hash,
					'interpretation', interpretation.interpretation, 'interpreted_at', interpretation.interpreted_at
				) ORDER BY interpretation.interpreted_at, interpretation.indexer_run_id,
					interpretation.interpretation_kind, interpretation.interpretation_key) AS interpretations
				FROM log_interpretations interpretation JOIN indexer_runs run ON run.id = interpretation.indexer_run_id
				WHERE interpretation.chain_id = log.chain_id AND interpretation.block_hash = log.block_hash
					AND interpretation.tx_hash = log.tx_hash AND interpretation.log_index = log.log_index
			) interpretation_history ON true
			LEFT JOIN LATERAL (
				SELECT replacement.id, replacement.reason,
					COALESCE((SELECT jsonb_agg(cause.reason ORDER BY cause.reason) FROM history_invalidation_causes cause
						WHERE cause.invalidation_id = replacement.id), jsonb_build_array(replacement.reason)) AS causes
				FROM history_invalidation_occurrences occurrence JOIN chain_reorganizations replacement ON replacement.id = occurrence.invalidation_id
				WHERE occurrence.occurrence_kind = 'log' AND occurrence.chain_id = log.chain_id
					AND occurrence.block_hash = log.block_hash AND occurrence.occurrence_id = log.tx_hash AND occurrence.sub_index = log.log_index
				ORDER BY replacement.id DESC LIMIT 1
			) invalidation ON true
			WHERE log.chain_id = ${chainId} AND log.block_number BETWEEN ${fromBlock} AND ${toBlock}
				AND log.block_number <= ${snapshotBlock} AND (${canonical === 'all'} OR log.canonical = ${canonical === 'canonical'})
				AND (${lastKey === undefined} OR (log.block_number, log.transaction_index, log.log_index, log.block_hash, log.tx_hash) >
					(${lastKey?.[0] ?? '0'}::bigint, ${lastKey?.[1] ?? '0'}::integer, ${lastKey?.[2] ?? '0'}::integer,
						${lastKey?.[3] ?? ZERO_HASH}, ${lastKey?.[4] ?? ZERO_HASH}))
			ORDER BY log.block_number, log.transaction_index, log.log_index, log.block_hash, log.tx_hash LIMIT ${limit + 1}
		`
	if (dataset === 'timeline')
		return await sql`
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
				invalidation.id::text AS invalidation_id, invalidation.reason AS invalidation_reason, invalidation.causes AS invalidation_causes
			FROM protocol_timeline_entries timeline JOIN blocks block ON block.chain_id = timeline.chain_id AND block.hash = timeline.block_hash
			LEFT JOIN LATERAL (
				SELECT replacement.id, replacement.reason,
					COALESCE((SELECT jsonb_agg(cause.reason ORDER BY cause.reason) FROM history_invalidation_causes cause
						WHERE cause.invalidation_id = replacement.id), jsonb_build_array(replacement.reason)) AS causes
				FROM history_invalidation_occurrences occurrence JOIN chain_reorganizations replacement ON replacement.id = occurrence.invalidation_id
				WHERE occurrence.occurrence_kind = 'log' AND occurrence.chain_id = timeline.chain_id
					AND occurrence.block_hash = timeline.block_hash AND occurrence.occurrence_id = timeline.tx_hash AND occurrence.sub_index = timeline.log_index
				ORDER BY replacement.id DESC LIMIT 1
			) invalidation ON true
			WHERE timeline.chain_id = ${chainId} AND timeline.block_number BETWEEN ${fromBlock} AND ${toBlock}
				AND timeline.block_number <= ${snapshotBlock} AND (${canonical === 'all'} OR timeline.canonical = ${canonical === 'canonical'})
				AND (${lastKey === undefined} OR (timeline.block_number, timeline.block_hash, timeline.tx_hash, timeline.log_index,
					timeline.entity_type, timeline.entity_identity) > (${lastKey?.[0] ?? '0'}::bigint,
					${lastKey?.[1] ?? ZERO_HASH}, ${lastKey?.[2] ?? ZERO_HASH}, ${lastKey?.[3] ?? '0'}::integer,
					${lastKey?.[4] ?? ''}, ${lastKey?.[5] ?? ''}))
			ORDER BY timeline.block_number, timeline.block_hash, timeline.tx_hash, timeline.log_index,
				timeline.entity_type, timeline.entity_identity LIMIT ${limit + 1}
		`
	return await sql`
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
}
