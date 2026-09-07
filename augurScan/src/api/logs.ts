import type { SQL } from 'bun'
import { decodeOpaqueCursor, encodeOpaqueCursor } from '../cursor-codec.ts'
import { logDetailData, logListRows, provenanceHistoryData, reorganizationHistoryData } from '../repositories/logs.ts'
import { snapshotBoundary } from './entity-details.ts'
import {
	ApiRequestError,
	actionJsonColumns,
	canonicalHistoryFilter,
	cursorTimestamp,
	decodedJsonColumns,
	directObservationTotal,
	evmAddress,
	integer,
	isCursorTimestamp,
	isNonNegativeSafeInteger,
	isPostgresBigint,
	json,
	logCursorFor,
	parseLogCursor,
	routeInteger,
} from './shared.ts'
import { operationsAsOfForContinuations } from './snapshot.ts'

export const listLogs = async (sql: SQL, url: URL): Promise<Response> => {
	const chainId = integer(url.searchParams.get('chainId'), 'chainId')
	const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 100
	const limit = Math.min(Math.max(requestedLimit, 1), 250)
	if (url.searchParams.has('offset')) throw new ApiRequestError('offset requires a snapshot-bound cursor')
	const event = url.searchParams.get('event')?.trim() || null
	const address = evmAddress(url.searchParams.get('address'), 'address') ?? null
	const decoded = url.searchParams.get('decoded')
	if (decoded !== null && decoded !== '' && decoded !== 'true' && decoded !== 'false') throw new ApiRequestError('decoded must be true or false')
	const decodedFilter: 'true' | 'false' | null = decoded === 'true' || decoded === 'false' ? decoded : null
	const canonical = canonicalHistoryFilter(url)
	if (chainId === undefined) throw new ApiRequestError('chainId is required')
	const cursor = parseLogCursor(url.searchParams.get('cursor'), chainId, event, address, decodedFilter, canonical)
	const asOf = await operationsAsOfForContinuations(sql, chainId, cursor === undefined ? [] : [{ parts: cursor, offset: 6 }])
	const rows = await logListRows(sql, { chainId, event, address, decoded: decodedFilter, canonical, limit, cursor })
	const hasMore = rows.length > limit
	const items = rows.slice(0, limit)
	return json({
		items,
		canonical,
		asOf,
		nextCursor:
			hasMore && items.length > 0
				? logCursorFor(chainId, event, address, decodedFilter, canonical, asOf, items[items.length - 1] as Record<string, unknown>)
				: undefined,
	})
}

export const logDetail = async (sql: SQL, parts: readonly string[], url: URL): Promise<Response> => {
	const chainId = routeInteger(parts[0])
	const blockHash = parts[1]
	const hash = parts[2]
	const logIndex = routeInteger(parts[3], true)
	if (
		parts.length !== 4 ||
		chainId === undefined ||
		blockHash === undefined ||
		!/^0x[0-9a-fA-F]{64}$/.test(blockHash) ||
		hash === undefined ||
		!/^0x[0-9a-fA-F]{64}$/.test(hash) ||
		logIndex === undefined
	)
		return json({ error: 'Invalid log identifier' }, 400)
	const canonical = canonicalHistoryFilter(url)
	const canonicalOnly = canonical === 'canonical'
	if (canonical === 'orphaned') throw new ApiRequestError('log detail canonical filter must be canonical or all')
	const normalizedBlockHash = blockHash.toLowerCase()
	const normalizedHash = hash.toLowerCase()
	const { rows, related, logInterpretations, actionInterpretations } = await logDetailData(
		sql,
		chainId,
		normalizedBlockHash,
		normalizedHash,
		logIndex,
		canonicalOnly,
	)
	if (rows.length === 0) return json({ error: 'Log not found' }, 404)
	const detail = decodedJsonColumns(rows[0] ?? {}, actionJsonColumns)
	return json({
		...detail,
		relatedLogs: related,
		interpretations: {
			log: logInterpretations.map((row: Record<string, unknown>) => decodedJsonColumns(row, ['interpretation'])),
			action: actionInterpretations.map((row: Record<string, unknown>) => decodedJsonColumns(row, ['interpretation'])),
		},
	})
}

type ReorganizationCursor = readonly [
	version: 1,
	chainId: number,
	snapshotBlock: string,
	snapshotHash: string,
	invalidationId: string,
	abiSourceHash: string,
	applicationSourceHash: string,
	projectionSourceHash: string,
	detectedAt: string,
	id: string,
]

const isReorganizationCursor = (parts: readonly unknown[]): parts is ReorganizationCursor =>
	parts.length === 10 &&
	parts[0] === 1 &&
	isNonNegativeSafeInteger(parts[1]) &&
	isPostgresBigint(parts[2]) &&
	typeof parts[3] === 'string' &&
	/^0x[0-9a-f]{64}$/.test(parts[3]) &&
	isPostgresBigint(parts[4]) &&
	parts.slice(5, 8).every((part) => typeof part === 'string') &&
	typeof parts[8] === 'string' &&
	isCursorTimestamp(parts[8]) &&
	isPostgresBigint(parts[9])

const parseReorganizationCursor = (value: string | null, chainId: number): ReorganizationCursor | undefined => {
	if (value === null) return undefined
	let parts: unknown[]
	try {
		const parsed = decodeOpaqueCursor(value)
		parts = Array.isArray(parsed) ? parsed : []
		if (!isReorganizationCursor(parts)) throw new Error('shape')
	} catch (error) {
		throw new ApiRequestError('cursor is invalid', { cause: error })
	}
	if (parts[1] !== chainId) throw new ApiRequestError('cursor does not match the requested reorganization collection')
	return parts
}

const reorganizationCursorFor = (chainId: number, asOf: Record<string, unknown>, row: Record<string, unknown>): string =>
	encodeOpaqueCursor([1, chainId, ...snapshotBoundary(asOf), cursorTimestamp(row['cursor_detected_at']), String(row['id'])] satisfies ReorganizationCursor)

export const reorganizationHistory = async (sql: SQL, url: URL): Promise<Response> => {
	const chainId = integer(url.searchParams.get('chainId'), 'chainId')
	if (chainId === undefined) throw new ApiRequestError('chainId is required')
	const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 50
	const limit = Math.min(Math.max(requestedLimit, 1), 250)
	if (url.searchParams.has('offset')) throw new ApiRequestError('offset requires a snapshot-bound cursor')
	const cursor = parseReorganizationCursor(url.searchParams.get('cursor'), chainId)
	const asOf = await operationsAsOfForContinuations(sql, chainId, cursor === undefined ? [] : [{ parts: cursor, offset: 2 }])
	const snapshotInvalidationId = String(asOf['invalidationId'])
	const { rows, totalRows } = await reorganizationHistoryData(sql, chainId, snapshotInvalidationId, limit, cursor)
	const total = directObservationTotal(totalRows[0]?.['total'] ?? '0')
	const hasMore = rows.length > limit
	const pageRows = rows.slice(0, limit)
	const items = pageRows.map((row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'cursor_detected_at')))
	const last = pageRows[pageRows.length - 1]
	return json({
		items,
		total,
		limit,
		asOf,
		nextCursor: hasMore && last !== undefined ? reorganizationCursorFor(chainId, asOf, last) : undefined,
	})
}

type ProvenanceCursor = readonly [version: 1, startedAt: string, runId: string]

const parseProvenanceCursor = (value: string | null): ProvenanceCursor | undefined => {
	if (value === null) return undefined
	try {
		const parsed = decodeOpaqueCursor(value)
		const parts = Array.isArray(parsed) ? parsed : []
		if (parts.length !== 3 || parts[0] !== 1 || typeof parts[1] !== 'string' || !isCursorTimestamp(parts[1]) || !isPostgresBigint(parts[2]))
			throw new Error('shape')
		return [1, parts[1], parts[2]]
	} catch (error) {
		throw new ApiRequestError('cursor is invalid', { cause: error })
	}
}

export const provenanceHistory = async (sql: SQL, url: URL): Promise<Response> => {
	const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 100
	const limit = Math.min(Math.max(requestedLimit, 1), 250)
	const cursor = parseProvenanceCursor(url.searchParams.get('cursor'))
	const { migrations, runRows } = await provenanceHistoryData(sql, limit, cursor)
	const pageRows = runRows.slice(0, limit)
	const runs = pageRows.map((row: Record<string, unknown>) =>
		Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'remaining_total' && key !== 'cursor_started_at')),
	)
	const hasMore = runRows.length > limit
	const last = pageRows[pageRows.length - 1]
	return json({
		migrations,
		runs,
		runLimit: limit,
		runsTruncated: hasMore,
		remainingTotal: Number(runRows[0]?.['remaining_total'] ?? 0),
		nextCursor:
			hasMore && last !== undefined
				? encodeOpaqueCursor([1, cursorTimestamp(last['cursor_started_at']), String(last['id'])] satisfies ProvenanceCursor)
				: undefined,
	})
}
