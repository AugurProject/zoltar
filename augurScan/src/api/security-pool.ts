import { escalationPayouts, escalationPositions, sharePositions } from '../repositories/share-positions.ts'
import type { SQL } from 'bun'
import { encodeOpaqueCursor, parseCursor } from '../cursor-codec.ts'
import { addressSecurityPoolRows, richListRows, type RichListSort } from '../repositories/security-pool.ts'
import { snapshotBoundary } from './entity-details.ts'
import { ApiConflictError, ApiRequestError, boundedInteger, evmAddress, hasCursorSnapshot, integer, isNonNegativeSafeInteger, isPostgresBigint, json, jsonRecord } from './shared.ts'
import { RICH_LIST_MAX_OFFSET } from '../rich-list-limits.ts'
import { operationsAsOfForContinuations } from './snapshot.ts'
import { accountTradingPnl } from './trading-activity.ts'

export const richList = async (sql: SQL, url: URL): Promise<Response> => {
	const chainId = integer(url.searchParams.get('chainId'), 'chainId')
	const address = evmAddress(url.searchParams.get('address'), 'address')
	if (address !== undefined && chainId === undefined) throw new ApiRequestError('chainId is required when filtering by address')
	const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 50
	const limit = Math.min(Math.max(requestedLimit, 1), 100)
	const offset = boundedInteger(url.searchParams.get('offset'), 'offset', RICH_LIST_MAX_OFFSET) ?? 0
	const requestedSort = url.searchParams.get('sort') ?? 'transactions'
	if (requestedSort !== 'eth' && requestedSort !== 'weth' && requestedSort !== 'rep' && requestedSort !== 'transactions') throw new ApiRequestError('sort must be eth, weth, rep, or transactions')
	const sort: RichListSort = requestedSort
	const snapshotInput = url.searchParams.get('snapshot')
	const snapshot =
		snapshotInput === null
			? undefined
			: parseCursor(
					snapshotInput,
					parts => {
						if (parts.length !== 9 || parts[0] !== chainId || parts[1] !== sort || parts[2] !== (address ?? '') || !parts.slice(3).every(part => typeof part === 'string') || !isPostgresBigint(parts[3])) throw new Error('snapshot scope')
						return parts
					},
					() => new ApiRequestError('Invalid rich list snapshot'),
				)
	const asOf = chainId === undefined ? undefined : await operationsAsOfForContinuations(sql, chainId, snapshot === undefined ? [] : [{ parts: snapshot, offset: 3 }])
	const snapshotBlock = asOf === undefined ? undefined : String(asOf['blockNumber'])
	const snapshotCursor = asOf === undefined || chainId === undefined ? undefined : encodeOpaqueCursor([chainId, sort, address ?? '', ...snapshotBoundary(asOf)])
	const rows = await richListRows(sql, { chainId, address, snapshotBlock, limit, offset, sort })
	return json({
		items: rows.filter((row: Record<string, unknown>) => row['address'] !== null),
		total: Number(rows[0]?.['total'] ?? 0),
		limit,
		offset,
		sort,
		snapshotBlock,
		snapshotCursor,
		positionLimit: 100,
		assetLimit: 100,
	})
}

type SecurityPoolCollection = 'forks' | 'lp' | 'reports' | 'positions'
type SecurityPoolCursor = readonly [number, string, SecurityPoolCollection, string, string, string, string, string, string, number, number]

const parseSecurityPoolCursor = (value: string | null, chainId: number, address: string, kind: SecurityPoolCollection): { readonly total: number; readonly offset: number; readonly cursor?: SecurityPoolCursor } => {
	if (value === null) return { total: 0, offset: 0 }
	const parts = parseCursor(
		value,
		parts => {
			return parts
		},
		error => new ApiRequestError(`${kind}Cursor is invalid`, { cause: error }),
	)
	if (
		parts.length !== 11 ||
		!isNonNegativeSafeInteger(parts[0]) ||
		typeof parts[1] !== 'string' ||
		(parts[2] !== 'forks' && parts[2] !== 'lp' && parts[2] !== 'reports' && parts[2] !== 'positions') ||
		!hasCursorSnapshot(parts, 3) ||
		!isNonNegativeSafeInteger(parts[9]) ||
		!isNonNegativeSafeInteger(parts[10]) ||
		parts[10] > parts[9]
	)
		throw new ApiRequestError(`${kind}Cursor is invalid`)
	if (parts[0] !== chainId || parts[1] !== address || parts[2] !== kind) throw new ApiRequestError(`${kind}Cursor does not match the requested collection`)
	return {
		total: parts[9],
		offset: parts[10],
		cursor: parts as [number, string, SecurityPoolCollection, string, string, string, string, string, string, number, number],
	}
}

const securityPoolCursorFor = (chainId: number, address: string, kind: SecurityPoolCollection, asOf: Record<string, unknown>, total: number, offset: number): string => encodeOpaqueCursor([chainId, address, kind, ...snapshotBoundary(asOf), total, offset] satisfies SecurityPoolCursor)

const balanceAvailability = (sampledCount: number, expectedCount: number) => {
	if (sampledCount === 0) return 'unavailable'
	return sampledCount < expectedCount ? 'partial' : 'available'
}

export const addressSecurityPoolResponse = async (sql: SQL, url: URL): Promise<Response> => {
	const chainId = integer(url.searchParams.get('chainId'), 'chainId')
	if (chainId === undefined) throw new ApiRequestError('chainId is required')
	const address = evmAddress(url.searchParams.get('address'), 'address')
	if (address === undefined) throw new ApiRequestError('address is required')
	const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 100
	const limit = Math.min(Math.max(requestedLimit, 1), 100)
	const lpPage = parseSecurityPoolCursor(url.searchParams.get('lpCursor'), chainId, address, 'lp')
	const forkPage = parseSecurityPoolCursor(url.searchParams.get('forkCursor'), chainId, address, 'forks')
	const reportPage = parseSecurityPoolCursor(url.searchParams.get('reportCursor'), chainId, address, 'reports')
	const positionPage = parseSecurityPoolCursor(url.searchParams.get('positionCursor'), chainId, address, 'positions')
	const asOf = await operationsAsOfForContinuations(
		sql,
		chainId,
		[lpPage.cursor, forkPage.cursor, reportPage.cursor, positionPage.cursor].flatMap(cursor => (cursor === undefined ? [] : [{ parts: cursor, offset: 3 }])),
	)
	const snapshotBlock = String(asOf['blockNumber'])
	const securityPoolRowsPromise = richListRows(sql, { chainId, address, snapshotBlock, limit: 1, offset: 0, sort: 'transactions' })
	const { lpRows, forkRows, reportRows } = await addressSecurityPoolRows(sql, {
		chainId,
		address,
		snapshotBlock,
		limit,
		lpOffset: lpPage.offset,
		forkOffset: forkPage.offset,
		reportOffset: reportPage.offset,
	})
	const items = (await securityPoolRowsPromise).filter((row: Record<string, unknown>) => row['address'] !== null)
	const collection = (kind: SecurityPoolCollection, rows: readonly Record<string, unknown>[], page: { readonly total: number; readonly offset: number }, identityField: string, pageLimit = limit) => {
		const total = Number(rows[0]?.['total'] ?? 0)
		if (page.offset > 0 && page.total !== total) throw new ApiConflictError('Security pool history changed; restart pagination')
		const collectionItems = rows.filter(row => row[identityField] !== null).map(row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'total')))
		const nextOffset = page.offset + collectionItems.length
		const hasMore = nextOffset < total
		return {
			items: collectionItems,
			page: {
				total,
				limit: pageLimit,
				offset: page.offset,
				hasMore,
				...(hasMore ? { nextCursor: securityPoolCursorFor(chainId, address, kind, asOf, total, nextOffset) } : {}),
			},
		}
	}
	const lp = collection('lp', lpRows, lpPage, 'market_address')
	const forks = collection('forks', forkRows, forkPage, 'universe_identity')
	const reports = collection('reports', reportRows, reportPage, 'open_oracle_address')
	const [positions, tradingPnl] = await Promise.all([escalationPositions(sql, chainId, snapshotBlock, address, 250, positionPage.offset), accountTradingPnl(sql, { chainId, asOfBlock: snapshotBlock, asOfTimestamp: String(asOf['blockTimestamp']), account: address })])
	const positionCollection = collection('positions', positions, positionPage, 'game_address', 250)
	const base = items[0]
	// Omit unknown aggregate balances instead of turning absent historical reads into zero.
	const balances =
		base === undefined
			? {}
			: {
					native_balance: Number(base['sampled_native_count']) > 0 ? base['native_balance'] : undefined,
					weth_balance: Number(base['sampled_weth_token_count']) > 0 ? base['weth_balance'] : undefined,
					balanceAvailability: {
						native: Number(base['sampled_native_count']) > 0 ? 'available' : 'unavailable',
						weth: balanceAvailability(Number(base['sampled_weth_token_count']), Number(base['weth_token_count'])),
						rep: balanceAvailability(Number(base['sampled_rep_token_count']), Number(base['rep_token_count'])),
					},
				}
	return json({
		chainId,
		asOf,
		data: {
			...jsonRecord(base),
			...balances,
			...(base === undefined ? { address, availability: 'Awaiting indexed evidence' } : {}),
			escalation_positions: positionCollection.items,
			escalation_payouts: await escalationPayouts(sql, chainId, snapshotBlock, address),
			escalation_positions_truncated: positionCollection.page.hasMore,
			share_positions: await sharePositions(sql, chainId, snapshotBlock, { address }),
			lp_positions: lp.items,
			trading_pnl: tradingPnl,
			fork_participation: forks.items,
			report_participation: reports.items,
			securityPoolPagination: { lp: lp.page, forks: forks.page, reports: reports.page, positions: positionCollection.page },
		},
	})
}
