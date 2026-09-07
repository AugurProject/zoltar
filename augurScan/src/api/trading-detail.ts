import type { SQL } from 'bun'
import { candlestickBuckets, fixedWindowTwap, swapAnalytics } from '../operations.ts'
import { tradingDetailData } from '../repositories/trading-detail.ts'
import { detailPage, paged, protocolCursorFor, protocolCursorForRequest } from './entity-details.ts'
import { operationsAsOfForContinuations } from './snapshot.ts'
import { json, jsonRecord, routeInteger } from './shared.ts'

export const tradingDetailResponse = async (sql: SQL, parts: readonly string[], url: URL): Promise<Response> => {
	const chainId = routeInteger(parts[0])
	const market = parts[1]?.toLowerCase()
	if (parts.length !== 2 || chainId === undefined || market === undefined || !/^0x[0-9a-f]{40}$/.test(market))
		return json({ error: 'Invalid AMM identifier' }, 400)
	const cursor = protocolCursorForRequest(url, chainId, 'trading', market)
	const asOf = await operationsAsOfForContinuations(sql, chainId, cursor === undefined ? [] : [{ parts: cursor, offset: 3 }])
	const page = detailPage(url, chainId, 'trading', market, asOf, cursor)
	const cursorBlock = page.cursor?.[9] ?? String(asOf['blockNumber'])
	const cursorTx = page.cursor?.[10] ?? `0x${'f'.repeat(64)}`
	const cursorLog = page.cursor?.[11] ?? 2_147_483_647
	const { events: rows, observations, summaries, lpPositions } = await tradingDetailData(sql, {
		chainId,
		market,
		asOfBlock: String(asOf['blockNumber']),
		asOfTimestamp: String(asOf['blockTimestamp']),
		cursorBlock,
		cursorLog,
		cursorTx,
		queryLimit: page.queryLimit,
	})
	if (rows.length === 0 && page.cursor === undefined) return json({ error: 'AMM not found' }, 404)
	const eventRows = rows.map((row: Record<string, unknown>) => {
		const eventData = jsonRecord(row['event_data'])
		if (row['event_name'] !== 'Swap') return { ...row, event_data: eventData }
		return {
			...row,
			event_data: eventData,
			analytics: swapAnalytics({
				yesForNo: eventData['yesForNo'] === true,
				amountIn: String(eventData['amountIn']),
				amountOut: String(eventData['amountOut']),
				feeAmount: String(eventData['feeAmount']),
				resultingYesReserve: String(eventData['resultingYesReserve']),
				resultingNoReserve: String(eventData['resultingNoReserve']),
			}),
		}
	})
	const exactObservations = observations.slice(-10_000).map((row: Record<string, unknown>) => ({
		timestamp: String(row['timestamp_seconds']),
		numerator: String(row['numerator']),
		denominator: String(row['denominator']),
	}))
	const end = String(asOf['blockTimestamp'])
	const endValue = BigInt(end)
	const firstObservation = exactObservations[0]
	const lastObservation = exactObservations.at(-1)
	return json({
		chainId,
		asOf,
		data: {
			market,
			summary: summaries[0],
			lpPositions,
			events: paged(eventRows, page.limit, (row) => protocolCursorFor(chainId, 'trading', market, asOf, row)),
			twap24h: fixedWindowTwap(exactObservations, (endValue > 86_400n ? endValue - 86_400n : 0n).toString(), end),
			twap7d: fixedWindowTwap(exactObservations, (endValue > 604_800n ? endValue - 604_800n : 0n).toString(), end),
			candles: candlestickBuckets(exactObservations, '3600'),
			observationLimit: 10_000,
			observationsTruncated: observations.length > 10_000,
			observationRange:
				firstObservation === undefined || lastObservation === undefined
					? undefined
					: { firstTimestamp: firstObservation.timestamp, lastTimestamp: lastObservation.timestamp, count: exactObservations.length },
		},
	})
}
