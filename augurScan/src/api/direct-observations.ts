import type { SQL } from 'bun'
import { decodeOpaqueCursor, encodeOpaqueCursor } from '../cursor-codec.ts'
import { snapshotBoundary } from './entity-details.ts'
import { operationsAsOfForContinuations } from './operation-data.ts'
import {
	ApiRequestError,
	type CanonicalHistoryFilter,
	canonicalHistoryFilter,
	cursorTimestamp,
	directObservationTotal,
	evmAddress,
	integer,
	isCursorTimestamp,
	isNonNegativeSafeInteger,
	isPostgresBigint,
	json,
	jsonRecord,
} from './shared.ts'
import { rejectRawSnapshotOffset } from './trading-catalog.ts'

export type DirectObservationKind = 'all' | 'address-balance' | 'token-metadata'

export type DirectObservationSnapshot = {
	readonly kind: DirectObservationKind
	readonly address?: string
	readonly canonical: CanonicalHistoryFilter
	readonly maxBalanceId: string
	readonly maxMetadataId: string
	readonly total: string
}

export type DirectObservationCursor = readonly [
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

export const parseDirectObservationCursor = (value: string | null, chainId: number): DirectObservationCursor | undefined => {
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

export const directObservationCursorFor = (
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

export const directObservationSnapshot = (value: string): DirectObservationSnapshot => {
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

export const directObservationsResponse = async (sql: SQL, url: URL): Promise<Response> => {
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
