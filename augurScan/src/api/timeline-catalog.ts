import type { SQL } from 'bun'
import { stateCatalogRows, timelineCatalogRows, timelineRows } from '../repositories/timeline.ts'
import { detailPage, paged, parseTimelineCatalogCursor, protocolCursorFor, protocolCursorForRequest, timelineCatalogCursorFor } from './entity-details.ts'
import { ApiRequestError, canonicalHistoryFilter, evmAddress, integer, json, POSTGRES_BIGINT_MAX, postgresBigint, routeInteger } from './shared.ts'
import { operationsAsOfForContinuations } from './snapshot.ts'

export const timelineCatalogResponse = async (sql: SQL, url: URL): Promise<Response> => {
	const chainId = integer(url.searchParams.get('chainId'), 'chainId')
	if (chainId === undefined) throw new ApiRequestError('chainId is required')
	const entityType = url.searchParams.get('entityType')?.trim() || undefined
	if (entityType !== undefined && !/^[a-z][a-z0-9-]{0,63}$/.test(entityType)) throw new ApiRequestError('entityType must be a lowercase semantic entity type')
	const event = url.searchParams.get('event')?.trim() || undefined
	if (event !== undefined && (event.length > 128 || !/^[A-Za-z][A-Za-z0-9_]*$/.test(event)))
		throw new ApiRequestError('event must be a complete semantic event name')
	const address = evmAddress(url.searchParams.get('address'), 'address')
	const query = url.searchParams.get('q')?.trim() || undefined
	if (query !== undefined && query.length > 128) throw new ApiRequestError('q must not exceed 128 characters')
	const fromBlock = postgresBigint(url.searchParams.get('fromBlock'), 'fromBlock') ?? '0'
	const toBlock = postgresBigint(url.searchParams.get('toBlock'), 'toBlock') ?? POSTGRES_BIGINT_MAX.toString()
	if (BigInt(fromBlock) > BigInt(toBlock)) throw new ApiRequestError('fromBlock must not exceed toBlock')
	const canonical = canonicalHistoryFilter(url)
	const filterIdentity = JSON.stringify({ entityType, event, address, query, fromBlock, toBlock, canonical })
	const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 100
	const limit = Math.min(Math.max(requestedLimit, 1), 250)
	const cursor = parseTimelineCatalogCursor(url.searchParams.get('cursor'), chainId, filterIdentity)
	const asOf = await operationsAsOfForContinuations(sql, chainId, cursor === undefined ? [] : [{ parts: cursor, offset: 2 }])
	const cursorBlock = cursor?.[8] ?? String(asOf['blockNumber'])
	const cursorLog = cursor?.[9] ?? 2_147_483_647
	const cursorTx = cursor?.[10] ?? `0x${'f'.repeat(64)}`
	const cursorBlockHash = cursor?.[11] ?? `0x${'f'.repeat(64)}`
	const cursorEntityType = cursor?.[12] ?? '\uffff'
	const cursorEntityIdentity = cursor?.[13] ?? '\uffff'
	const { rows, totalRows } = await timelineCatalogRows(sql, {
		chainId,
		entityType,
		event,
		address,
		query,
		fromBlock,
		toBlock,
		canonical,
		asOfBlock: String(asOf['blockNumber']),
		cursor: { block: cursorBlock, log: cursorLog, tx: cursorTx, blockHash: cursorBlockHash, entityType: cursorEntityType, identity: cursorEntityIdentity },
		limit,
	})
	return json({
		chainId,
		asOf,
		filters: { entityType, event, address, query, fromBlock, toBlock, canonical },
		data: {
			...paged(rows, limit, (row) => timelineCatalogCursorFor(chainId, filterIdentity, asOf, row)),
			total: String(totalRows[0]?.['total'] ?? '0'),
		},
	})
}

export const timelineResponse = async (sql: SQL, parts: readonly string[], url: URL): Promise<Response> => {
	const chainId = routeInteger(parts[0])
	const entityType = parts[1]
	const entityIdentity = parts[2] === undefined ? undefined : decodeURIComponent(parts[2])
	if (
		parts.length !== 3 ||
		chainId === undefined ||
		entityType === undefined ||
		!/^[a-z][a-z0-9-]{0,63}$/.test(entityType) ||
		entityIdentity === undefined ||
		entityIdentity.length > 256
	)
		return json({ error: 'Invalid timeline identifier' }, 400)
	const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 100
	url.searchParams.set('limit', String(requestedLimit))
	const identity = `${entityType}:${entityIdentity}`
	const cursor = protocolCursorForRequest(url, chainId, 'timeline', identity)
	const asOf = await operationsAsOfForContinuations(sql, chainId, cursor === undefined ? [] : [{ parts: cursor, offset: 3 }])
	const page = detailPage(url, chainId, 'timeline', identity, asOf, cursor)
	const cursorBlock = page.cursor?.[9] ?? String(asOf['blockNumber'])
	const cursorTx = page.cursor?.[10] ?? `0x${'f'.repeat(64)}`
	const cursorLog = page.cursor?.[11] ?? 2_147_483_647
	const rows = await timelineRows(sql, { chainId, entityType, entityIdentity, cursorBlock, cursorLog, cursorTx, limit: page.queryLimit })
	return json({ chainId, asOf, data: paged(rows, page.limit, (row) => protocolCursorFor(chainId, 'timeline', identity, asOf, row)) })
}

export const stateCatalog = async (sql: SQL, url: URL): Promise<Response> => {
	const chainId = integer(url.searchParams.get('chainId'), 'chainId')
	const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 500
	const limit = Math.min(Math.max(requestedLimit, 1), 1_000)
	const queryLimit = limit + 1
	const { totals, questions, pools, vaults, universes, poolStates } = await stateCatalogRows(sql, chainId, queryLimit)
	const truncate = (rows: readonly unknown[]): readonly unknown[] => rows.slice(0, limit)
	return json({
		questions: truncate(questions),
		pools: truncate(pools),
		vaults: truncate(vaults),
		universes: truncate(universes),
		poolStates: truncate(poolStates),
		limit,
		totals: totals[0],
		truncated: {
			questions: questions.length > limit,
			pools: pools.length > limit,
			vaults: vaults.length > limit,
			universes: universes.length > limit,
			poolStates: poolStates.length > limit,
		},
	})
}
