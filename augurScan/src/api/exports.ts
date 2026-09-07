import type { SQL } from 'bun'
import { decodeOpaqueCursor, encodeOpaqueCursor } from '../cursor-codec.ts'
import {
	ApiConflictError,
	ApiRequestError,
	type CanonicalHistoryFilter,
	canonicalHistoryFilter,
	integer,
	isNonNegativeSafeInteger,
	isPostgresBigint,
	isPostgresIntegerString,
	normalize,
	postgresBigint,
} from './shared.ts'

export type HistoricalExportDataset = 'logs' | 'timeline' | 'reorgs'
export type HistoricalExportCursor = readonly [
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

export const historicalExportKeyValid = (dataset: HistoricalExportDataset, key: readonly unknown[]): key is readonly string[] => {
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

export const historicalExportCursorFor = (snapshot: readonly unknown[], lastKey: readonly string[]): string => encodeOpaqueCursor([...snapshot, lastKey])

export const historicalExport = async (sql: SQL, url: URL): Promise<Response> => {
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
