import type { SQL } from 'bun'
import { decodeOpaqueCursor, encodeOpaqueCursor } from '../cursor-codec.ts'
import { directObservationMaxima, directObservationRows } from '../repositories/direct-observations.ts'
import { snapshotBoundary } from './entity-details.ts'
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
import { operationsAsOfForContinuations } from './snapshot.ts'
import { rejectRawSnapshotOffset } from './trading-catalog.ts'

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
		const maxima = await directObservationMaxima(sql, chainId)
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
	const rows = await directObservationRows(sql, {
		chainId,
		snapshot,
		limit,
		...(cursor === undefined ? {} : { cursor: { observedAt: cursor[11], kind: cursor[12], id: cursor[13] } }),
	})
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
