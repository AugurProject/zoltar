import type { SQL } from 'bun'
import { operationsAsOf } from '../repositories/operations.ts'
import { poolStateHistory, questionStateHistory, stateHistoryNetwork, universeStateHistory, vaultStateHistory } from '../repositories/state-history.ts'
import { ApiConflictError, ApiRequestError, integer, json, postgresBigint, routeInteger } from './shared.ts'
import { snapshotBoundaryMatches } from './snapshot.ts'
import { offsetCursorFor, offsetPage, rejectRawSnapshotOffset } from './trading-catalog.ts'

export const stateHistory = async (sql: SQL, parts: readonly string[], url: URL): Promise<Response> => {
	const type = parts[0]
	const chainId = routeInteger(parts[1])
	const requestedLimit = integer(url.searchParams.get('limit'), 'limit') ?? 1_000
	const limit = Math.min(Math.max(requestedLimit, 1), 2_000)
	const fromBlock = postgresBigint(url.searchParams.get('fromBlock'), 'fromBlock') ?? '0'
	const toBlock = postgresBigint(url.searchParams.get('toBlock'), 'toBlock') ?? '9223372036854775807'
	if (BigInt(fromBlock) > BigInt(toBlock)) throw new ApiRequestError('fromBlock must not exceed toBlock')
	const queryLimit = limit + 1
	const chronological = <T>(rows: readonly T[]): T[] => rows.slice(0, limit).reverse()
	if (chainId === undefined) return json({ error: 'Invalid state identifier' }, 400)
	const validStateIdentity =
		(type === 'pools' && parts.length === 3 && /^0x[0-9a-fA-F]{40}$/.test(parts[2] ?? '')) ||
		(type === 'vaults' && parts.length === 4 && /^0x[0-9a-fA-F]{40}$/.test(parts[2] ?? '') && /^0x[0-9a-fA-F]{40}$/.test(parts[3] ?? '')) ||
		((type === 'universes' || type === 'questions') && parts.length === 3 && /^\d+$/.test(parts[2] ?? ''))
	if (!validStateIdentity) {
		if (type !== 'pools' && type !== 'vaults' && type !== 'universes' && type !== 'questions') return json({ error: 'Unknown state history type' }, 404)
		return json({ error: 'Invalid state identifier' }, 400)
	}
	rejectRawSnapshotOffset(url)
	const asOf = await operationsAsOf(sql, chainId)
	const networkRows = await stateHistoryNetwork(sql, chainId)
	const network = networkRows[0]
	if (network === undefined) throw new ApiRequestError('chainId is not configured')
	const indexedFromBlock = String(network['start_block'])
	const indexedThroughBlock = network['indexed_block'] === null ? undefined : String(network['indexed_block'])
	const requestedFromBlock = url.searchParams.has('fromBlock') ? fromBlock : indexedFromBlock
	const requestedToBlock = url.searchParams.has('toBlock') ? toBlock : indexedThroughBlock
	const historyIdentity = JSON.stringify({ type, identity: parts.slice(2).map(part => part.toLowerCase()), fromBlock, toBlock, indexedFromBlock })
	const page = offsetPage(url, chainId, 'state-history', historyIdentity)
	if (page.identity !== historyIdentity) throw new ApiRequestError('cursor does not match filters')
	if (page.cursor !== undefined && !snapshotBoundaryMatches(page.cursor, 3, asOf)) throw new ApiConflictError('Indexed state changed; restart pagination')
	const offset = page.offset
	const rangeCovered = indexedThroughBlock !== undefined && requestedToBlock !== undefined && BigInt(requestedFromBlock) >= BigInt(indexedFromBlock) && BigInt(requestedToBlock) <= BigInt(indexedThroughBlock)
	const coverage = (truncated: boolean, series: Record<string, number>) => ({
		requestedFromBlock,
		requestedToBlock: requestedToBlock ?? toBlock,
		indexedFromBlock,
		indexedThroughBlock,
		indexedThroughHash: network['indexed_hash'],
		limit,
		offset,
		series,
		complete: rangeCovered && offset === 0 && !truncated,
		rangeCovered,
		hasPreviousPages: offset > 0,
		...(truncated ? { nextCursor: offsetCursorFor(chainId, 'state-history', historyIdentity, asOf, offset + limit) } : {}),
	})
	if (type === 'pools') {
		const address = parts[2]?.toLowerCase()
		if (parts.length !== 3 || address === undefined || !/^0x[0-9a-f]{40}$/.test(address)) return json({ error: 'Invalid pool address' }, 400)
		const { snapshots, events, markets, ammPrices, repEthPrices, uniswapRepEthPrices, openOracleHistory } = await poolStateHistory(sql, address, {
			chainId,
			fromBlock,
			toBlock,
			queryLimit,
			offset,
		})
		const truncated = snapshots.length > limit || events.length > limit || ammPrices.length > limit || repEthPrices.length > limit || uniswapRepEthPrices.length > limit || openOracleHistory.length > limit
		return json({
			snapshots: chronological(snapshots),
			events: chronological(events),
			market: markets[0],
			ammPrices: chronological(ammPrices),
			repEthPrices: chronological(repEthPrices),
			uniswapRepEthPrices: chronological(uniswapRepEthPrices),
			openOracleHistory: chronological(openOracleHistory),
			truncated,
			limit,
			offset,
			coverage: coverage(truncated, {
				snapshots: Math.min(snapshots.length, limit),
				events: Math.min(events.length, limit),
				ammPrices: Math.min(ammPrices.length, limit),
				repEthPrices: Math.min(repEthPrices.length, limit),
				uniswapRepEthPrices: Math.min(uniswapRepEthPrices.length, limit),
				openOracleHistory: Math.min(openOracleHistory.length, limit),
			}),
		})
	}
	if (type === 'vaults') {
		const pool = parts[2]?.toLowerCase()
		const vault = parts[3]?.toLowerCase()
		if (parts.length !== 4 || pool === undefined || vault === undefined || !/^0x[0-9a-f]{40}$/.test(pool) || !/^0x[0-9a-f]{40}$/.test(vault)) return json({ error: 'Invalid vault identifier' }, 400)
		const snapshots = await vaultStateHistory(sql, pool, vault, { chainId, fromBlock, toBlock, queryLimit, offset })
		const truncated = snapshots.length > limit
		return json({
			snapshots: chronological(snapshots),
			truncated,
			limit,
			offset,
			coverage: coverage(truncated, { snapshots: Math.min(snapshots.length, limit) }),
		})
	}
	if (type === 'universes') {
		const universeId = parts[2]
		if (parts.length !== 3 || universeId === undefined || !/^\d+$/.test(universeId)) return json({ error: 'Invalid universe identifier' }, 400)
		const events = await universeStateHistory(sql, universeId, { chainId, fromBlock, toBlock, queryLimit, offset })
		const truncated = events.length > limit
		return json({ events: chronological(events), truncated, limit, offset, coverage: coverage(truncated, { events: Math.min(events.length, limit) }) })
	}
	if (type === 'questions') {
		const questionId = parts[2]
		if (parts.length !== 3 || questionId === undefined || !/^\d+$/.test(questionId)) return json({ error: 'Invalid question identifier' }, 400)
		const { pools, forks } = await questionStateHistory(sql, questionId, { chainId, fromBlock, toBlock, queryLimit, offset })
		const truncated = pools.length > limit || forks.length > limit
		return json({
			pools: chronological(pools),
			forks: chronological(forks),
			truncated,
			limit,
			offset,
			coverage: coverage(truncated, { pools: Math.min(pools.length, limit), forks: Math.min(forks.length, limit) }),
		})
	}
	return json({ error: 'Unknown state history type' }, 404)
}
