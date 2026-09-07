import type { SQL } from 'bun'
import { decodeOpaqueCursor, encodeOpaqueCursor } from '../cursor-codec.ts'
import { snapshotBoundary } from './entity-details.ts'
import { operationsAsOfForContinuations } from './operation-data.ts'
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
	const rows = await sql`
		WITH markets AS (
			SELECT DISTINCT ON (market.pair_address) market.*
			FROM amm_markets market
			WHERE market.chain_id = ${chainId} AND market.canonical AND market.block_number <= ${String(asOf['blockNumber'])}
			ORDER BY market.pair_address, market.block_number DESC, market.log_index DESC
		)
		SELECT market.pair_address, market.pool_address, market.share_token_address,
			market.universe_id::text, market.fee_bps::text, question.question_id::text, question.title AS question_title,
			price.yes_reserve_atto_shares::text, price.no_reserve_atto_shares::text,
			price.conditional_yes_bps::text, price.conditional_no_bps::text,
			price.block_number::text AS price_block_number, price.timestamp AS price_timestamp,
			COALESCE(activity.swap_count, 0)::integer AS swap_count,
			COALESCE(activity.liquidity_event_count, 0)::integer AS liquidity_event_count,
			COALESCE(activity.lp_holder_count, 0)::integer AS lp_holder_count,
			COALESCE(activity.fees_atto_shares, 0)::text AS fees_atto_shares,
			count(*) OVER ()::integer AS total
		FROM markets market
		LEFT JOIN pools pool ON pool.chain_id = market.chain_id AND pool.pool_address = market.pool_address AND pool.canonical
		LEFT JOIN questions question ON question.chain_id = pool.chain_id AND question.question_id = pool.question_id AND question.canonical
		LEFT JOIN LATERAL (
			SELECT snapshot.*, block.timestamp FROM amm_price_snapshots snapshot
			JOIN blocks block ON block.chain_id = snapshot.chain_id AND block.hash = snapshot.block_hash
			WHERE snapshot.chain_id = market.chain_id AND snapshot.pair_address = market.pair_address AND snapshot.canonical
				AND snapshot.block_number <= ${String(asOf['blockNumber'])}
			ORDER BY snapshot.block_number DESC, snapshot.log_index DESC LIMIT 1
		) price ON true
		LEFT JOIN LATERAL (
			SELECT count(*) FILTER (WHERE event.event_name = 'Swap') AS swap_count,
				count(*) FILTER (WHERE event.event_name IN ('LiquidityInitialized', 'LiquidityAdded', 'LiquidityRemoved')) AS liquidity_event_count,
				(SELECT count(*) FROM (
					SELECT movement.address
					FROM (
						SELECT lower(transfer.event_data->>'to') AS address, (transfer.event_data->>'amount')::numeric AS delta
						FROM amm_trade_events transfer
						WHERE transfer.chain_id = market.chain_id AND transfer.market_address = market.pair_address
							AND transfer.canonical AND transfer.event_name = 'Transfer' AND transfer.block_number <= ${String(asOf['blockNumber'])}
						UNION ALL
						SELECT lower(transfer.event_data->>'from'), -(transfer.event_data->>'amount')::numeric
						FROM amm_trade_events transfer
						WHERE transfer.chain_id = market.chain_id AND transfer.market_address = market.pair_address
							AND transfer.canonical AND transfer.event_name = 'Transfer' AND transfer.block_number <= ${String(asOf['blockNumber'])}
					) movement
					WHERE movement.address <> '0x0000000000000000000000000000000000000000'
					GROUP BY movement.address HAVING sum(movement.delta) <> 0
				) holder) AS lp_holder_count,
				COALESCE(sum((event.event_data->>'feeAmount')::numeric) FILTER (WHERE event.event_name = 'Swap'), 0) AS fees_atto_shares
			FROM amm_trade_events event
			WHERE event.chain_id = market.chain_id AND event.market_address = market.pair_address AND event.canonical
				AND event.block_number <= ${String(asOf['blockNumber'])}
		) activity ON true
		WHERE (${query ?? null}::text IS NULL OR market.pair_address ILIKE ${query === undefined ? null : `%${query}%`}
			OR market.pool_address ILIKE ${query === undefined ? null : `%${query}%`}
			OR question.title ILIKE ${query === undefined ? null : `%${query}%`})
		ORDER BY price.block_number DESC NULLS LAST, market.block_number DESC, market.pair_address
		LIMIT ${limit} OFFSET ${offset}
	`
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
