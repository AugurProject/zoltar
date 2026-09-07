import type { SQL } from 'bun'
import { decodeOpaqueCursor, encodeOpaqueCursor } from '../cursor-codec.ts'
import { snapshotBoundary } from './entity-details.ts'
import { operationsAsOfForContinuations } from './snapshot.ts'
import { ApiRequestError, cursorTimestamp, integer, isCursorTimestamp, isNonNegativeSafeInteger, isPostgresBigint, json } from './shared.ts'
import { rejectRawSnapshotOffset } from './trading-catalog.ts'

export type IntegrityCursor = readonly [
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

export const parseIntegrityCursor = (value: string | null, chainId: number): IntegrityCursor | undefined => {
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

export const integrityCursorFor = (
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

export const integrityCatalogResponse = async (sql: SQL, url: URL): Promise<Response> => {
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
