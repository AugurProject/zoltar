import type { SQL } from 'bun'
import { candlestickBuckets, fixedWindowTwap, swapAnalytics } from '../operations.ts'
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
	const rows = await sql`
		SELECT event.*, block.timestamp AS block_timestamp,
			EXTRACT(EPOCH FROM block.timestamp)::bigint::text AS timestamp_seconds
		FROM amm_trade_events event JOIN blocks block ON block.chain_id = event.chain_id AND block.hash = event.block_hash
		WHERE event.chain_id = ${chainId} AND event.market_address = ${market} AND event.canonical
			AND (event.event_name <> 'Swap' OR (event.event_data ? 'yesForNo' AND event.event_data ? 'amountIn'
				AND event.event_data ? 'amountOut' AND event.event_data ? 'resultingYesReserve' AND event.event_data ? 'resultingNoReserve'))
			AND (event.event_name <> 'Sync' OR (event.event_data ? 'yesReserve' AND event.event_data ? 'noReserve'))
			AND (event.block_number, event.log_index, event.tx_hash) < (${cursorBlock}::bigint, ${cursorLog}::integer, ${cursorTx})
		ORDER BY event.block_number DESC, event.log_index DESC, event.tx_hash DESC LIMIT ${page.queryLimit}
	`
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
	const observations = await sql`
		WITH window_observations AS (
			SELECT EXTRACT(EPOCH FROM block.timestamp)::bigint::text AS timestamp_seconds,
				event.event_data->>'noReserve' AS numerator, event.event_data->>'yesReserve' AS denominator,
				event.block_number, event.tx_hash, event.log_index
			FROM amm_trade_events event JOIN blocks block ON block.chain_id = event.chain_id AND block.hash = event.block_hash
			WHERE event.chain_id = ${chainId} AND event.market_address = ${market} AND event.canonical
				AND event.event_name = 'Sync' AND event.event_data ? 'yesReserve' AND event.event_data ? 'noReserve'
				AND event.block_number <= ${String(asOf['blockNumber'])}
				AND block.timestamp >= to_timestamp(${String(asOf['blockTimestamp'])}::numeric - 604800)
		), prior_observation AS (
			SELECT EXTRACT(EPOCH FROM block.timestamp)::bigint::text AS timestamp_seconds,
				event.event_data->>'noReserve' AS numerator, event.event_data->>'yesReserve' AS denominator,
				event.block_number, event.tx_hash, event.log_index
			FROM amm_trade_events event JOIN blocks block ON block.chain_id = event.chain_id AND block.hash = event.block_hash
			WHERE event.chain_id = ${chainId} AND event.market_address = ${market} AND event.canonical
				AND event.event_name = 'Sync' AND event.event_data ? 'yesReserve' AND event.event_data ? 'noReserve'
				AND event.block_number <= ${String(asOf['blockNumber'])}
				AND block.timestamp < to_timestamp(${String(asOf['blockTimestamp'])}::numeric - 604800)
			ORDER BY event.block_number DESC, event.log_index DESC LIMIT 1
		)
		SELECT * FROM (
			SELECT * FROM (SELECT * FROM window_observations UNION ALL SELECT * FROM prior_observation) candidate
			ORDER BY block_number DESC, log_index DESC, tx_hash DESC LIMIT 10001
		) retained ORDER BY block_number, log_index, tx_hash
	`
	const summaries = await sql`
		SELECT
			count(*) FILTER (WHERE event.event_name = 'Swap' AND block.timestamp >= to_timestamp(${String(asOf['blockTimestamp'])}::numeric - 86400))::integer AS swaps_24h,
			count(*) FILTER (WHERE event.event_name = 'Swap' AND block.timestamp >= to_timestamp(${String(asOf['blockTimestamp'])}::numeric - 604800))::integer AS swaps_7d,
			COALESCE(sum((event.event_data->>'amountIn')::numeric) FILTER (WHERE event.event_name = 'Swap' AND block.timestamp >= to_timestamp(${String(asOf['blockTimestamp'])}::numeric - 86400)), 0)::text AS input_volume_24h,
			COALESCE(sum((event.event_data->>'amountIn')::numeric) FILTER (WHERE event.event_name = 'Swap' AND block.timestamp >= to_timestamp(${String(asOf['blockTimestamp'])}::numeric - 604800)), 0)::text AS input_volume_7d,
			COALESCE(sum((event.event_data->>'feeAmount')::numeric) FILTER (WHERE event.event_name = 'Swap' AND block.timestamp >= to_timestamp(${String(asOf['blockTimestamp'])}::numeric - 86400)), 0)::text AS fees_24h,
			COALESCE(sum((event.event_data->>'feeAmount')::numeric) FILTER (WHERE event.event_name = 'Swap' AND block.timestamp >= to_timestamp(${String(asOf['blockTimestamp'])}::numeric - 604800)), 0)::text AS fees_7d,
			count(*) FILTER (WHERE event.event_name IN ('LiquidityInitialized', 'LiquidityAdded', 'LiquidityRemoved') AND block.timestamp >= to_timestamp(${String(asOf['blockTimestamp'])}::numeric - 604800))::integer AS liquidity_events_7d
		FROM amm_trade_events event JOIN blocks block ON block.chain_id = event.chain_id AND block.hash = event.block_hash
		WHERE event.chain_id = ${chainId} AND event.market_address = ${market} AND event.canonical
			AND event.block_number <= ${String(asOf['blockNumber'])}
			AND (event.event_name <> 'Swap' OR (event.event_data ? 'amountIn' AND event.event_data ? 'feeAmount'
				AND event.event_data ? 'resultingYesReserve' AND event.event_data ? 'resultingNoReserve'))
			AND (event.event_name <> 'Sync' OR (event.event_data ? 'yesReserve' AND event.event_data ? 'noReserve'))
	`
	const lpPositions = await sql`
		WITH transfers AS (
			SELECT lower(event.event_data->>'from') AS from_address, lower(event.event_data->>'to') AS to_address,
				(event.event_data->>'amount')::numeric AS amount
			FROM amm_trade_events event
			WHERE event.chain_id = ${chainId} AND event.market_address = ${market} AND event.canonical
				AND event.block_number <= ${String(asOf['blockNumber'])}
				AND event.event_name = 'Transfer' AND event.event_data ? 'from' AND event.event_data ? 'to' AND event.event_data ? 'amount'
		), deltas AS (
			SELECT to_address AS address, amount AS received_liquidity, 0::numeric AS sent_liquidity, amount AS balance_delta
			FROM transfers WHERE to_address <> '0x0000000000000000000000000000000000000000'
			UNION ALL
			SELECT from_address, 0::numeric, amount, -amount
			FROM transfers WHERE from_address <> '0x0000000000000000000000000000000000000000'
		)
		SELECT delta.address, sum(delta.received_liquidity)::text AS received_liquidity,
			sum(delta.sent_liquidity)::text AS sent_liquidity, sum(delta.balance_delta)::text AS balance
		FROM deltas delta
		GROUP BY delta.address
		HAVING sum(delta.balance_delta) <> 0
		ORDER BY sum(delta.balance_delta) DESC, delta.address
		LIMIT 250
	`
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
