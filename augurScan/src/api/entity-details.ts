import type { SQL } from 'bun'
import type { JsonValue } from '../ethereum.ts'
import { decodeOpaqueCursor, encodeOpaqueCursor, isJsonArray } from '../cursor-codec.ts'
import { auctionDemandCurve, reportLifecycle, reportRoundChanges } from '../operations.ts'
import { auctionDetailData, eventEntityRows, forkDetailData, latestEntitySnapshot, reportDetailData } from '../repositories/entity-details.ts'
import {
	ApiConflictError,
	ApiRequestError,
	integer,
	isNonNegativeSafeInteger,
	isPostgresBigint,
	isPostgresInteger,
	json,
	jsonRecord,
	routeInteger,
} from './shared.ts'
import { operationsAsOfForContinuations, snapshotBoundaryMatches } from './snapshot.ts'

export const snapshotBoundary = (asOf: Record<string, unknown>): readonly [string, string, string, string, string, string] => [
	String(asOf['blockNumber']),
	String(asOf['blockHash']),
	String(asOf['invalidationId']),
	String(asOf['abiSourceHash']),
	String(asOf['applicationSourceHash']),
	String(asOf['projectionSourceHash']),
]

export type ProtocolCursor = readonly [number, string, string, string, string, string, string, string, string, string, string, number]

export type RiskCursor = readonly [number, 'pool' | 'vault', string, string, string, string, string, string, string]
export const parseRiskCursor = (value: string | null, chainId: number, kind: 'pool' | 'vault'): RiskCursor | undefined => {
	if (value === null) return undefined
	let parts: readonly JsonValue[]
	try {
		const parsed = decodeOpaqueCursor(value)
		parts = isJsonArray(parsed) ? parsed : []
		if (
			parts.length !== 9 ||
			!isNonNegativeSafeInteger(parts[0]) ||
			(parts[1] !== 'pool' && parts[1] !== 'vault') ||
			!isPostgresBigint(parts[2]) ||
			typeof parts[3] !== 'string' ||
			!/^0x[0-9a-f]{64}$/.test(parts[3]) ||
			!isPostgresBigint(parts[4]) ||
			!parts.slice(5, 8).every((part) => typeof part === 'string') ||
			typeof parts[8] !== 'string' ||
			(kind === 'pool' ? !/^0x[0-9a-f]{40}$/.test(parts[8]) : !/^0x[0-9a-f]{40}:0x[0-9a-f]{40}$/.test(parts[8]))
		)
			throw new Error('shape')
	} catch (error) {
		throw new ApiRequestError(`${kind}Cursor is invalid`, { cause: error })
	}
	if (parts[0] !== chainId || parts[1] !== kind) throw new ApiRequestError(`${kind}Cursor does not match the requested collection`)
	return parts as [number, 'pool' | 'vault', string, string, string, string, string, string, string]
}

export const riskCursorFor = (chainId: number, kind: 'pool' | 'vault', asOf: Record<string, unknown>, key: string): string =>
	encodeOpaqueCursor([chainId, kind, ...snapshotBoundary(asOf), key] satisfies RiskCursor)

const parseProtocolCursor = (value: string | null): ProtocolCursor | undefined => {
	if (value === null) return undefined
	try {
		const parsed = decodeOpaqueCursor(value)
		const parts = isJsonArray(parsed) ? parsed : []
		if (
			parts.length !== 12 ||
			!isNonNegativeSafeInteger(parts[0]) ||
			typeof parts[1] !== 'string' ||
			typeof parts[2] !== 'string' ||
			!isPostgresBigint(parts[3]) ||
			typeof parts[4] !== 'string' ||
			!/^0x[0-9a-f]{64}$/.test(parts[4]) ||
			!isPostgresBigint(parts[5]) ||
			!parts.slice(6, 9).every((part) => typeof part === 'string') ||
			!isPostgresBigint(parts[9]) ||
			typeof parts[10] !== 'string' ||
			!/^0x[0-9a-f]{64}$/.test(parts[10]) ||
			!isPostgresInteger(parts[11]) ||
			BigInt(parts[9]) > BigInt(parts[3])
		)
			throw new Error('shape')
		return parts as [number, string, string, string, string, string, string, string, string, string, string, number]
	} catch (error) {
		throw new ApiRequestError('cursor is invalid', { cause: error })
	}
}

export const protocolCursorForRequest = (url: URL, chainId: number, domain: string, identity: string): ProtocolCursor | undefined => {
	const cursor = parseProtocolCursor(url.searchParams.get('cursor'))
	if (cursor !== undefined && (cursor[0] !== chainId || cursor[1] !== domain || cursor[2] !== identity))
		throw new ApiRequestError('cursor does not match the requested entity')
	return cursor
}

export const protocolCursorFor = (chainId: number, domain: string, identity: string, asOf: Record<string, unknown>, row: Record<string, unknown>): string =>
	encodeOpaqueCursor([
		chainId,
		domain,
		identity,
		...snapshotBoundary(asOf),
		String(row['block_number']),
		String(row['tx_hash']),
		Number(row['log_index']),
	] satisfies ProtocolCursor)

export const detailPage = (
	url: URL,
	chainId: number,
	domain: string,
	identity: string,
	asOf: Record<string, unknown>,
	cursor = protocolCursorForRequest(url, chainId, domain, identity),
) => {
	const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 100
	const limit = Math.min(Math.max(requestedLimit, 1), 250)
	if (cursor !== undefined && !snapshotBoundaryMatches(cursor, 3, asOf)) throw new ApiConflictError('Indexed state changed; restart pagination')
	return { limit, queryLimit: limit + 1, cursor }
}

export type TimelineCatalogCursor = readonly [
	number,
	string,
	string,
	string,
	string,
	string,
	string,
	string,
	string,
	number,
	string,
	string,
	string,
	string,
	'v2',
]

export const parseTimelineCatalogCursor = (value: string | null, chainId: number, filterIdentity: string): TimelineCatalogCursor | undefined => {
	if (value === null) return undefined
	let parts: readonly JsonValue[]
	try {
		const parsed = decodeOpaqueCursor(value)
		parts = isJsonArray(parsed) ? parsed : []
		if (
			parts.length !== 15 ||
			!isNonNegativeSafeInteger(parts[0]) ||
			typeof parts[1] !== 'string' ||
			!isPostgresBigint(parts[2]) ||
			typeof parts[3] !== 'string' ||
			!/^0x[0-9a-f]{64}$/.test(parts[3]) ||
			!isPostgresBigint(parts[4]) ||
			!parts.slice(5, 8).every((part) => typeof part === 'string') ||
			!isPostgresBigint(parts[8]) ||
			!isPostgresInteger(parts[9]) ||
			typeof parts[10] !== 'string' ||
			!/^0x[0-9a-f]{64}$/.test(parts[10]) ||
			typeof parts[11] !== 'string' ||
			!/^0x[0-9a-f]{64}$/.test(parts[11]) ||
			typeof parts[12] !== 'string' ||
			typeof parts[13] !== 'string' ||
			parts[14] !== 'v2'
		)
			throw new Error('shape')
	} catch (error) {
		throw new ApiRequestError('cursor is invalid', { cause: error })
	}
	if (parts[0] !== chainId || parts[1] !== filterIdentity) throw new ApiRequestError('cursor does not match the requested timeline filters')
	return [
		Number(parts[0]),
		String(parts[1]),
		String(parts[2]),
		String(parts[3]),
		String(parts[4]),
		String(parts[5]),
		String(parts[6]),
		String(parts[7]),
		String(parts[8]),
		Number(parts[9]),
		String(parts[10]),
		String(parts[11]),
		String(parts[12]),
		String(parts[13]),
		'v2',
	]
}

export const timelineCatalogCursorFor = (chainId: number, filterIdentity: string, asOf: Record<string, unknown>, row: Record<string, unknown>): string =>
	encodeOpaqueCursor([
		chainId,
		filterIdentity,
		...snapshotBoundary(asOf),
		String(row['block_number']),
		Number(row['log_index']),
		String(row['tx_hash']),
		String(row['block_hash']),
		String(row['entity_type']),
		String(row['entity_identity']),
		'v2',
	] satisfies TimelineCatalogCursor)

const snapshotFor = async (sql: SQL, chainId: number, entityType: string, entityIdentity: string) => {
	return await latestEntitySnapshot(sql, chainId, entityType, entityIdentity)
}

export const paged = (rows: readonly Record<string, unknown>[], limit: number, cursor: (row: Record<string, unknown>) => string) => {
	const hasMore = rows.length > limit
	const items = rows.slice(0, limit)
	return { items, limit, hasMore, nextCursor: hasMore && items.length > 0 ? cursor(items[items.length - 1] as Record<string, unknown>) : undefined }
}

export const reportDetailResponse = async (sql: SQL, parts: readonly string[], url: URL): Promise<Response> => {
	const chainId = routeInteger(parts[0])
	const openOracleAddress = parts[1]?.toLowerCase()
	const reportId = parts[2]
	if (
		parts.length !== 3 ||
		chainId === undefined ||
		openOracleAddress === undefined ||
		!/^0x[0-9a-f]{40}$/.test(openOracleAddress) ||
		reportId === undefined ||
		!/^\d+$/.test(reportId)
	)
		return json({ error: 'Invalid report identifier' }, 400)
	const identity = `${openOracleAddress}:${reportId}`
	const cursor = protocolCursorForRequest(url, chainId, 'report', identity)
	const decisionUrl = new URL(url)
	decisionUrl.searchParams.delete('cursor')
	decisionUrl.searchParams.delete('limit')
	const decisionCursorValue = url.searchParams.get('decisionCursor')
	const decisionLimitValue = url.searchParams.get('decisionLimit')
	if (decisionCursorValue !== null) decisionUrl.searchParams.set('cursor', decisionCursorValue)
	if (decisionLimitValue !== null) decisionUrl.searchParams.set('limit', decisionLimitValue)
	const decisionCursor = protocolCursorForRequest(decisionUrl, chainId, 'report-decisions', identity)
	const asOf = await operationsAsOfForContinuations(
		sql,
		chainId,
		[cursor, decisionCursor].flatMap((item) => (item === undefined ? [] : [{ parts: item, offset: 3 }])),
	)
	const page = detailPage(url, chainId, 'report', identity, asOf, cursor)
	const decisionPage = detailPage(decisionUrl, chainId, 'report-decisions', identity, asOf, decisionCursor)
	const cursorBlock = page.cursor?.[9] ?? String(asOf['blockNumber'])
	const cursorTx = page.cursor?.[10] ?? `0x${'f'.repeat(64)}`
	const cursorLog = page.cursor?.[11] ?? 2_147_483_647
	const decisionCursorBlock = decisionPage.cursor?.[9] ?? String(asOf['blockNumber'])
	const decisionCursorTx = decisionPage.cursor?.[10] ?? `0x${'f'.repeat(64)}`
	const decisionCursorLog = decisionPage.cursor?.[11] ?? 2_147_483_647
	const { rows, current, coordinatorDecisions } = await reportDetailData(sql, {
		chainId,
		openOracleAddress,
		reportId,
		rounds: { block: cursorBlock, log: cursorLog, tx: cursorTx, limit: page.queryLimit },
		decisions: { block: decisionCursorBlock, log: decisionCursorLog, tx: decisionCursorTx, limit: decisionPage.queryLimit },
	})
	if (rows.length === 0 && page.cursor === undefined) return json({ error: 'Report not found' }, 404)
	const currentData = jsonRecord(current?.['report_data'])
	const lifecycle =
		current === undefined
			? undefined
			: reportLifecycle({
					eventName:
						current['event_name'] === 'ReportSettled' ? 'ReportSettled' : current['event_name'] === 'ReportDisputed' ? 'ReportDisputed' : 'ReportSubmitted',
					flags: typeof currentData['flags'] === 'string' ? currentData['flags'] : undefined,
					reportTimestamp: typeof currentData['reportTimestamp'] === 'string' ? currentData['reportTimestamp'] : undefined,
					disputeDelay: typeof currentData['disputeDelay'] === 'string' ? currentData['disputeDelay'] : undefined,
					settlementTime: typeof currentData['settlementTime'] === 'string' ? currentData['settlementTime'] : undefined,
					indexedBlock: String(asOf['blockNumber']),
					indexedTimestamp: String(asOf['blockTimestamp']),
				})
	return json({
		chainId,
		asOf,
		data: {
			identity: { openOracleAddress, reportId },
			current: current === undefined ? undefined : { ...current, report_data: currentData, lifecycle },
			rounds: paged(reportRoundChanges(rows), page.limit, (row) => protocolCursorFor(chainId, 'report', identity, asOf, row)),
			coordinatorDecisions: paged(coordinatorDecisions, decisionPage.limit, (row) => protocolCursorFor(chainId, 'report-decisions', identity, asOf, row)),
		},
	})
}

export const eventEntityDetailResponse = async (sql: SQL, parts: readonly string[], url: URL, domain: 'auction' | 'escalation'): Promise<Response> => {
	const chainId = routeInteger(parts[0])
	const address = parts[1]?.toLowerCase()
	if (parts.length !== 2 || chainId === undefined || address === undefined || !/^0x[0-9a-f]{40}$/.test(address))
		return json({ error: `Invalid ${domain} identifier` }, 400)
	const cursor = protocolCursorForRequest(url, chainId, domain, address)
	const asOf = await operationsAsOfForContinuations(sql, chainId, cursor === undefined ? [] : [{ parts: cursor, offset: 3 }])
	const page = detailPage(url, chainId, domain, address, asOf, cursor)
	const cursorBlock = page.cursor?.[9] ?? String(asOf['blockNumber'])
	const cursorTx = page.cursor?.[10] ?? `0x${'f'.repeat(64)}`
	const cursorLog = page.cursor?.[11] ?? 2_147_483_647
	const rows = await eventEntityRows(sql, {
		chainId,
		address,
		domain,
		page: { block: cursorBlock, log: cursorLog, tx: cursorTx, limit: page.queryLimit },
	})
	if (rows.length === 0 && page.cursor === undefined) return json({ error: `${domain === 'auction' ? 'Auction' : 'Escalation game'} not found` }, 404)
	const snapshot = await snapshotFor(sql, chainId, domain, address)
	const result: Record<string, unknown> = {
		identity: address,
		snapshot,
		events: paged(rows, page.limit, (row) => protocolCursorFor(chainId, domain, address, asOf, row)),
	}
	if (domain === 'auction') {
		const { bids, finalization } = await auctionDetailData(sql, chainId, address)
		result['demandCurve'] = auctionDemandCurve(
			bids.slice(0, 1000).map((row: Record<string, unknown>) => ({ tick: String(row['tick']), amountAttoEth: String(row['amount_atto_eth']) })),
		)
		result['demandCurveTruncated'] = bids.length > 1000
		result['finalization'] = finalization
	} else {
		result['deposits'] = rows.filter((row: Record<string, unknown>) => row['event_name'] === 'DepositOnOutcome' || row['event_name'] === 'LocalDepositAppended')
		result['claims'] = rows.filter((row: Record<string, unknown>) => String(row['event_name']).includes('Claim'))
	}
	return json({ chainId, asOf, data: result })
}

export const forkDetailResponse = async (sql: SQL, parts: readonly string[], url: URL): Promise<Response> => {
	const chainId = routeInteger(parts[0])
	const identity = parts[1] === undefined ? undefined : decodeURIComponent(parts[1]).toLowerCase()
	if (parts.length !== 2 || chainId === undefined || identity === undefined || identity.length === 0 || identity.length > 128)
		return json({ error: 'Invalid fork identifier' }, 400)
	const cursor = protocolCursorForRequest(url, chainId, 'fork', identity)
	const asOf = await operationsAsOfForContinuations(sql, chainId, cursor === undefined ? [] : [{ parts: cursor, offset: 3 }])
	const page = detailPage(url, chainId, 'fork', identity, asOf, cursor)
	const cursorBlock = page.cursor?.[9] ?? String(asOf['blockNumber'])
	const cursorTx = page.cursor?.[10] ?? `0x${'f'.repeat(64)}`
	const cursorLog = page.cursor?.[11] ?? 2_147_483_647
	const { rows, branches, summary } = await forkDetailData(sql, {
		chainId,
		identity,
		page: { block: cursorBlock, log: cursorLog, tx: cursorTx, limit: page.queryLimit },
	})
	if (rows.length === 0 && page.cursor === undefined) return json({ error: 'Fork not found' }, 404)
	return json({
		chainId,
		asOf,
		data: { identity, summary, branches, events: paged(rows, page.limit, (row) => protocolCursorFor(chainId, 'fork', identity, asOf, row)) },
	})
}
