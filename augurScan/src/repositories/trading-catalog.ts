import type { SQL } from 'bun'

export const tradingCatalogRows = async (sql: SQL, query: { readonly chainId: number; readonly asOfBlock: string; readonly search?: string; readonly limit: number; readonly offset: number }) => {
	const { chainId, asOfBlock, search, limit, offset } = query
	return await sql`
		WITH markets AS (
			SELECT DISTINCT ON (market.pair_address) market.*
			FROM amm_markets market
			WHERE market.chain_id = ${chainId} AND market.canonical AND market.block_number <= ${asOfBlock}
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
				AND snapshot.block_number <= ${asOfBlock}
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
							AND transfer.canonical AND transfer.event_name = 'Transfer' AND transfer.block_number <= ${asOfBlock}
						UNION ALL
						SELECT lower(transfer.event_data->>'from'), -(transfer.event_data->>'amount')::numeric
						FROM amm_trade_events transfer
						WHERE transfer.chain_id = market.chain_id AND transfer.market_address = market.pair_address
							AND transfer.canonical AND transfer.event_name = 'Transfer' AND transfer.block_number <= ${asOfBlock}
					) movement
					WHERE movement.address <> '0x0000000000000000000000000000000000000000'
					GROUP BY movement.address HAVING sum(movement.delta) <> 0
				) holder) AS lp_holder_count,
				COALESCE(sum((event.event_data->>'feeAmount')::numeric) FILTER (WHERE event.event_name = 'Swap'), 0) AS fees_atto_shares
			FROM amm_trade_events event
			WHERE event.chain_id = market.chain_id AND event.market_address = market.pair_address AND event.canonical
				AND event.block_number <= ${asOfBlock}
		) activity ON true
		WHERE (${search ?? null}::text IS NULL OR market.pair_address ILIKE ${search === undefined ? null : `%${search}%`}
			OR market.pool_address ILIKE ${search === undefined ? null : `%${search}%`}
			OR question.title ILIKE ${search === undefined ? null : `%${search}%`})
		ORDER BY price.block_number DESC NULLS LAST, market.block_number DESC, market.pair_address
		LIMIT ${limit} OFFSET ${offset}
	`
}
