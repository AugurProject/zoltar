import type { SQL } from 'bun'
import { decodeOpaqueCursor, encodeOpaqueCursor } from '../cursor-codec.ts'
import { addressPortfolioRows, richListRows, type RichListSort } from '../repositories/portfolio.ts'
import { snapshotBoundary } from './entity-details.ts'
import { operationsAsOfForContinuations } from './snapshot.ts'
import {
	ApiConflictError,
	ApiRequestError,
	boundedInteger,
	evmAddress,
	integer,
	isNonNegativeSafeInteger,
	isPostgresBigint,
	json,
	jsonRecord,
} from './shared.ts'

export const richList = async (sql: SQL, url: URL): Promise<Response> => {
	const chainId = integer(url.searchParams.get('chainId'), 'chainId')
	const address = evmAddress(url.searchParams.get('address'), 'address')
	if (address !== undefined && chainId === undefined) throw new ApiRequestError('chainId is required when filtering by address')
	const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 50
	const limit = Math.min(Math.max(requestedLimit, 1), 100)
	const offset = boundedInteger(url.searchParams.get('offset'), 'offset', 100_000) ?? 0
	const requestedSort = url.searchParams.get('sort') ?? 'transactions'
	if (requestedSort !== 'eth' && requestedSort !== 'weth' && requestedSort !== 'transactions')
		throw new ApiRequestError('sort must be eth, weth, or transactions')
	const sort: RichListSort = requestedSort
	const rows = await richListRows(sql, { chainId, address, limit, offset, sort })
	return json({
		items: rows.filter((row: Record<string, unknown>) => row['address'] !== null),
		total: Number(rows[0]?.['total'] ?? 0),
		limit,
		offset,
		sort,
		positionLimit: 100,
		assetLimit: 100,
	})
}

export type PortfolioCollection = 'forks' | 'lp' | 'reports'
export type PortfolioCursor = readonly [number, string, PortfolioCollection, string, string, string, string, string, string, number, number]

export const parsePortfolioCursor = (
	value: string | null,
	chainId: number,
	address: string,
	kind: PortfolioCollection,
): { readonly total: number; readonly offset: number; readonly cursor?: PortfolioCursor } => {
	if (value === null) return { total: 0, offset: 0 }
	let parts: unknown[]
	try {
		const parsed = decodeOpaqueCursor(value)
		parts = Array.isArray(parsed) ? parsed : []
	} catch (error) {
		throw new ApiRequestError(`${kind}Cursor is invalid`, { cause: error })
	}
	if (
		parts.length !== 11 ||
		!isNonNegativeSafeInteger(parts[0]) ||
		typeof parts[1] !== 'string' ||
		(parts[2] !== 'forks' && parts[2] !== 'lp' && parts[2] !== 'reports') ||
		!isPostgresBigint(parts[3]) ||
		typeof parts[4] !== 'string' ||
		!/^0x[0-9a-f]{64}$/.test(parts[4]) ||
		!isPostgresBigint(parts[5]) ||
		!parts.slice(6, 9).every((part) => typeof part === 'string') ||
		!isNonNegativeSafeInteger(parts[9]) ||
		!isNonNegativeSafeInteger(parts[10]) ||
		parts[10] > parts[9]
	)
		throw new ApiRequestError(`${kind}Cursor is invalid`)
	if (parts[0] !== chainId || parts[1] !== address || parts[2] !== kind) throw new ApiRequestError(`${kind}Cursor does not match the requested collection`)
	return {
		total: parts[9],
		offset: parts[10],
		cursor: parts as [number, string, PortfolioCollection, string, string, string, string, string, string, number, number],
	}
}

export const portfolioCursorFor = (
	chainId: number,
	address: string,
	kind: PortfolioCollection,
	asOf: Record<string, unknown>,
	total: number,
	offset: number,
): string => encodeOpaqueCursor([chainId, address, kind, ...snapshotBoundary(asOf), total, offset] satisfies PortfolioCursor)

export const addressPortfolioResponse = async (sql: SQL, url: URL): Promise<Response> => {
	const chainId = integer(url.searchParams.get('chainId'), 'chainId')
	if (chainId === undefined) throw new ApiRequestError('chainId is required')
	const address = evmAddress(url.searchParams.get('address'), 'address')
	if (address === undefined) throw new ApiRequestError('address is required')
	const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 100
	const limit = Math.min(Math.max(requestedLimit, 1), 100)
	const lpPage = parsePortfolioCursor(url.searchParams.get('lpCursor'), chainId, address, 'lp')
	const forkPage = parsePortfolioCursor(url.searchParams.get('forkCursor'), chainId, address, 'forks')
	const reportPage = parsePortfolioCursor(url.searchParams.get('reportCursor'), chainId, address, 'reports')
	const asOf = await operationsAsOfForContinuations(
		sql,
		chainId,
		[lpPage.cursor, forkPage.cursor, reportPage.cursor].flatMap((cursor) => (cursor === undefined ? [] : [{ parts: cursor, offset: 3 }])),
	)
	const snapshotBlock = String(asOf['blockNumber'])
	const requestUrl = new URL(url)
	requestUrl.pathname = '/api/v1/richlist'
	requestUrl.search = new URLSearchParams({ chainId: String(chainId), address, limit: '1' }).toString()
	const portfolioResponsePromise = richList(sql, requestUrl)
	const { lpRows, forkRows, reportRows } = await addressPortfolioRows(sql, {
		chainId,
		address,
		snapshotBlock,
		limit,
		lpOffset: lpPage.offset,
		forkOffset: forkPage.offset,
		reportOffset: reportPage.offset,
	})
	const portfolioResponse = await portfolioResponsePromise
	const payload: unknown = await portfolioResponse.json()
	const payloadRecord = jsonRecord(payload)
	const items = Array.isArray(payloadRecord['items']) ? payloadRecord['items'] : []
	const collection = (
		kind: PortfolioCollection,
		rows: readonly Record<string, unknown>[],
		page: { readonly total: number; readonly offset: number },
		identityField: string,
	) => {
		const total = Number(rows[0]?.['total'] ?? 0)
		if (page.offset > 0 && page.total !== total) throw new ApiConflictError('Portfolio history changed; restart pagination')
		const collectionItems = rows
			.filter((row) => row[identityField] !== null)
			.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'total')))
		const nextOffset = page.offset + collectionItems.length
		const hasMore = nextOffset < total
		return {
			items: collectionItems,
			page: {
				total,
				limit,
				offset: page.offset,
				hasMore,
				...(hasMore ? { nextCursor: portfolioCursorFor(chainId, address, kind, asOf, total, nextOffset) } : {}),
			},
		}
	}
	const lp = collection('lp', lpRows, lpPage, 'market_address')
	const forks = collection('forks', forkRows, forkPage, 'universe_identity')
	const reports = collection('reports', reportRows, reportPage, 'open_oracle_address')
	const base = items[0]
	return json({
		chainId,
		asOf,
		data: {
			...jsonRecord(base),
			...(base === undefined ? { address, availability: 'Awaiting indexed evidence' } : {}),
			lp_positions: lp.items,
			fork_participation: forks.items,
			report_participation: reports.items,
			portfolioPagination: { lp: lp.page, forks: forks.page, reports: reports.page },
		},
	})
}
