import type { SQL } from 'bun'
import { decodeOpaqueCursor, encodeOpaqueCursor } from '../cursor-codec.ts'
import { integrityCatalogData, latestInvalidationId } from '../repositories/integrity.ts'
import { snapshotBoundary } from './entity-details.ts'
import { ApiRequestError, cursorTimestamp, integer, isCursorTimestamp, isNonNegativeSafeInteger, isPostgresBigint, json } from './shared.ts'
import { operationsAsOfForContinuations } from './snapshot.ts'
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
	const snapshotRows = await latestInvalidationId(sql, chainId)
	const currentSnapshotId = snapshotRows[0]?.['id']
	if (!isPostgresBigint(currentSnapshotId)) throw new Error('Integrity snapshot boundary is unavailable')
	if (cursor !== undefined && BigInt(cursor[3]) > BigInt(currentSnapshotId)) throw new ApiRequestError('cursor is invalid')
	const asOf = await operationsAsOfForContinuations(sql, chainId, cursor === undefined ? [] : [{ parts: cursor, offset: 5 }])
	const snapshotId = cursor?.[3] ?? currentSnapshotId
	const offset = cursor?.[11] ?? 0
	const { reorganizations, migrations, runs } = await integrityCatalogData(sql, {
		chainId,
		snapshotId,
		limit,
		...(cursor === undefined ? {} : { cursor: { detectedAt: cursor[12], id: cursor[13] } }),
	})
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
