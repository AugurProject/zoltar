import type { SQL } from 'bun'
import { decodeOpaqueCursor, encodeOpaqueCursor } from '../cursor-codec.ts'
import { tradingCatalogRows } from '../repositories/trading-catalog.ts'
import { snapshotBoundary } from './entity-details.ts'
import { operationsAsOfForContinuations } from './snapshot.ts'
import { ApiRequestError, integer, isNonNegativeSafeInteger, isPostgresBigint, json } from './shared.ts'

export type OffsetCursor = readonly [number, string, string, string, string, string, string, string, string, number]

export const rejectRawSnapshotOffset = (url: URL): void => {
	if (url.searchParams.has('offset')) throw new ApiRequestError('offset requires a snapshot-bound cursor')
}

export const offsetPage = (url: URL, chainId: number, domain: string, identity: string) => {
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

export const offsetCursorFor = (chainId: number, domain: string, identity: string, asOf: Record<string, unknown>, offset: number): string =>
	encodeOpaqueCursor([chainId, domain, identity, ...snapshotBoundary(asOf), offset] satisfies OffsetCursor)

export const tradingCatalogResponse = async (sql: SQL, url: URL): Promise<Response> => {
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
	const rows = await tradingCatalogRows(sql, { chainId, asOfBlock: String(asOf['blockNumber']), search: query, limit, offset })
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
