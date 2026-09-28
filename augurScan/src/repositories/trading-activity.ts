import type { SQL } from 'bun'

type TradingLegFilter = {
	readonly chainId: number
	readonly asOfBlock: string
	/** Restricts the legs to these pair addresses. */
	readonly markets?: readonly string[]
	/** Restricts the legs to transactions in which this account moved shares, minted, redeemed, or received pair output. */
	readonly account?: string
}

// One row per trading action in an Augur AMM market. Pool complete-set events carry the exact ETH amounts; the pair's
// Swap or liquidity event in the same transaction, sent by the same minter or redeemer, identifies a router enter,
// exit, or ETH-funded liquidity action. A minter or redeemer whose share balance is unchanged by the transaction is a
// pass-through such as the router, so the action belongs to the single account it forwarded shares to or received
// shares from. Pair events not linked to a complete-set event are share-for-share actions without an ETH amount.
const tradingLegs = (sql: SQL, filter: TradingLegFilter) => {
	const { chainId, asOfBlock } = filter
	const markets = filter.markets === undefined ? null : JSON.stringify(filter.markets)
	const account = filter.account ?? null
	return sql`
		WITH account_transactions AS (
			SELECT log.block_hash, log.tx_hash FROM logs log
			WHERE ${account}::text IS NOT NULL AND log.chain_id = ${chainId} AND log.canonical AND log.block_number <= ${asOfBlock}
				AND log.event_name IN ('TransferSingle', 'TransferBatch', 'CompleteSetCreated', 'CompleteSetRedeemed', 'SharesRedeemed')
				AND ${account} IN (lower(log.arguments->>'from'), lower(log.arguments->>'to'), lower(log.arguments->>'creator'), lower(log.arguments->>'redeemer'))
			UNION
			SELECT event.block_hash, event.tx_hash FROM amm_trade_events event
			WHERE ${account}::text IS NOT NULL AND event.chain_id = ${chainId} AND event.canonical AND event.block_number <= ${asOfBlock}
				AND lower(event.event_data->>'recipient') = ${account}
		), markets AS (
			SELECT DISTINCT ON (market.pair_address) market.pair_address, market.pool_address, market.share_token_address, market.universe_id
			FROM amm_markets market
			WHERE market.chain_id = ${chainId} AND market.canonical AND market.block_number <= ${asOfBlock}
				AND (${markets}::text IS NULL OR market.pair_address IN (SELECT jsonb_array_elements_text((${markets}::text)::jsonb)))
			ORDER BY market.pair_address, market.block_number DESC, market.log_index DESC
		), pool_events AS (
			SELECT market.pair_address, market.share_token_address, market.universe_id, log.block_hash, log.tx_hash, log.block_number, log.log_index,
				EXTRACT(EPOCH FROM block.timestamp)::bigint AS timestamp_seconds, log.event_name,
				lower(COALESCE(log.arguments->>'creator', log.arguments->>'redeemer')) AS actor,
				(CASE log.event_name WHEN 'CompleteSetCreated' THEN log.arguments->>'settlementCollateralProvidedAttoEth' ELSE log.arguments->>'settlementCollateralRedeemedAttoEth' END)::numeric AS eth,
				(CASE log.event_name WHEN 'CompleteSetCreated' THEN log.arguments->>'completeSetsMintedAttoShares' WHEN 'CompleteSetRedeemed' THEN log.arguments->>'completeSetsBurnedAttoShares' ELSE log.arguments->>'winningSharesBurnedAttoShares' END)::numeric AS sets
			FROM markets market
			JOIN logs log ON log.chain_id = ${chainId} AND log.emitter_address = market.pool_address AND log.canonical AND log.block_number <= ${asOfBlock}
				AND log.event_name IN ('CompleteSetCreated', 'CompleteSetRedeemed', 'SharesRedeemed')
				AND (${account}::text IS NULL OR (log.block_hash, log.tx_hash) IN (SELECT block_hash, tx_hash FROM account_transactions))
			JOIN blocks block ON block.chain_id = log.chain_id AND block.hash = log.block_hash AND block.canonical
		), pair_events AS (
			SELECT market.pair_address, event.block_hash, event.tx_hash, event.block_number, event.log_index,
				EXTRACT(EPOCH FROM block.timestamp)::bigint AS timestamp_seconds, event.event_name, event.event_data,
				lower(COALESCE(event.event_data->>'sender', event.event_data->>'provider')) AS caller,
				lower(event.event_data->>'recipient') AS recipient
			FROM markets market
			JOIN amm_trade_events event ON event.chain_id = ${chainId} AND event.market_address = market.pair_address AND event.canonical AND event.block_number <= ${asOfBlock}
				AND event.event_name IN ('Swap', 'LiquidityInitialized', 'LiquidityAdded', 'LiquidityRemoved')
				AND (${account}::text IS NULL OR (event.block_hash, event.tx_hash) IN (SELECT block_hash, tx_hash FROM account_transactions))
			JOIN blocks block ON block.chain_id = event.chain_id AND block.hash = event.block_hash AND block.canonical
		), pool_legs AS (
			SELECT pool_event.*, companion.event_name AS companion_name, companion.event_data AS companion_data, companion.log_index AS companion_log_index, flow.holder, flow.forwarded_to, flow.received_from
			FROM pool_events pool_event
			LEFT JOIN LATERAL (
				SELECT pair_event.event_name, pair_event.event_data, pair_event.log_index FROM pair_events pair_event
				WHERE pair_event.pair_address = pool_event.pair_address AND pair_event.block_hash = pool_event.block_hash
					AND pair_event.tx_hash = pool_event.tx_hash AND pair_event.caller = pool_event.actor AND (
						(pool_event.event_name = 'CompleteSetCreated' AND pair_event.event_name IN ('LiquidityInitialized', 'LiquidityAdded'))
						OR (pool_event.event_name = 'CompleteSetCreated' AND pair_event.event_name = 'Swap' AND pair_event.event_data->>'exactOutput' = 'false')
						OR (pool_event.event_name = 'CompleteSetRedeemed' AND pair_event.event_name = 'Swap' AND pair_event.event_data->>'exactOutput' = 'true')
					)
				ORDER BY pair_event.event_name = 'Swap', abs(pair_event.log_index - pool_event.log_index), pair_event.log_index LIMIT 1
			) companion ON pool_event.event_name <> 'SharesRedeemed'
			LEFT JOIN LATERAL (
				WITH moves AS (
					SELECT lower(transfer.arguments->>'from') AS sender, lower(transfer.arguments->>'to') AS receiver, item.id::numeric AS id, item.amount::numeric AS amount
					FROM logs transfer
					CROSS JOIN LATERAL (
						SELECT transfer.arguments->>'id' AS id, transfer.arguments->>'value' AS amount WHERE transfer.event_name = 'TransferSingle'
						UNION ALL
						SELECT ids.value #>> '{}', amounts.value #>> '{}'
						FROM jsonb_array_elements(CASE WHEN transfer.event_name = 'TransferBatch' THEN transfer.arguments->'ids' ELSE '[]'::jsonb END) WITH ORDINALITY ids(value, n)
						JOIN jsonb_array_elements(CASE WHEN transfer.event_name = 'TransferBatch' THEN transfer.arguments->'values' ELSE '[]'::jsonb END) WITH ORDINALITY amounts(value, n) USING (n)
					) item
					WHERE transfer.chain_id = ${chainId} AND transfer.block_hash = pool_event.block_hash AND transfer.tx_hash = pool_event.tx_hash
						AND transfer.emitter_address = pool_event.share_token_address AND transfer.canonical
						AND transfer.event_name IN ('TransferSingle', 'TransferBatch')
				), market_moves AS (
					SELECT * FROM moves WHERE trunc(id / 256) = pool_event.universe_id AND sender <> receiver
				)
				SELECT
					EXISTS (
						SELECT 1 FROM market_moves WHERE sender = pool_event.actor OR receiver = pool_event.actor
						GROUP BY id HAVING sum(CASE WHEN receiver = pool_event.actor THEN amount ELSE -amount END) <> 0
					) AS holder,
					(SELECT CASE WHEN count(DISTINCT receiver) = 1 THEN min(receiver) END FROM market_moves
						WHERE sender = pool_event.actor AND receiver NOT IN (pool_event.pair_address, '0x0000000000000000000000000000000000000000')) AS forwarded_to,
					(SELECT CASE WHEN count(DISTINCT sender) = 1 THEN min(sender) END FROM market_moves
						WHERE receiver = pool_event.actor AND sender NOT IN (pool_event.pair_address, '0x0000000000000000000000000000000000000000')) AS received_from
			) flow ON true
		)
		SELECT pair_address, block_hash, tx_hash, block_number, log_index, timestamp_seconds,
			CASE
				WHEN event_name = 'SharesRedeemed' THEN 'settlement'
				WHEN companion_name IN ('LiquidityInitialized', 'LiquidityAdded') THEN 'add-liquidity'
				WHEN companion_name = 'Swap' AND event_name = 'CompleteSetCreated' THEN 'enter'
				WHEN companion_name = 'Swap' THEN 'exit'
				WHEN event_name = 'CompleteSetCreated' THEN 'mint-complete-sets'
				ELSE 'redeem-complete-sets'
			END AS kind,
			CASE
				WHEN companion_name <> 'Swap' OR companion_name IS NULL THEN NULL
				WHEN event_name = 'CompleteSetCreated' THEN CASE WHEN companion_data->>'yesForNo' = 'true' THEN 'NO' ELSE 'YES' END
				ELSE CASE WHEN companion_data->>'yesForNo' = 'true' THEN 'YES' ELSE 'NO' END
			END AS side,
			CASE
				WHEN holder THEN actor
				WHEN event_name = 'CompleteSetCreated' THEN COALESCE(forwarded_to, actor)
				ELSE COALESCE(received_from, actor)
			END AS account,
			CASE
				WHEN companion_name IN ('LiquidityInitialized', 'LiquidityAdded') THEN (companion_data->>'liquidity')::numeric
				WHEN companion_name = 'Swap' AND event_name = 'CompleteSetCreated' THEN sets + (companion_data->>'amountOut')::numeric
				WHEN companion_name = 'Swap' THEN sets + (companion_data->>'amountIn')::numeric
				ELSE sets
			END AS shares,
			CASE WHEN event_name = 'CompleteSetCreated' THEN eth ELSE 0 END AS eth_in,
			CASE WHEN event_name = 'CompleteSetCreated' THEN 0 ELSE eth END AS eth_out,
			companion_log_index
		FROM pool_legs
		UNION ALL
		SELECT pair_event.pair_address, pair_event.block_hash, pair_event.tx_hash, pair_event.block_number, pair_event.log_index, pair_event.timestamp_seconds,
			CASE pair_event.event_name WHEN 'Swap' THEN 'swap' WHEN 'LiquidityRemoved' THEN 'remove-liquidity' ELSE 'add-liquidity' END AS kind,
			CASE WHEN pair_event.event_name <> 'Swap' THEN NULL WHEN pair_event.event_data->>'yesForNo' = 'true' THEN 'NO' ELSE 'YES' END AS side,
			pair_event.recipient AS account,
			(CASE WHEN pair_event.event_name = 'Swap' THEN pair_event.event_data->>'amountOut' ELSE pair_event.event_data->>'liquidity' END)::numeric AS shares,
			NULL::numeric AS eth_in, NULL::numeric AS eth_out, NULL::integer AS companion_log_index
		FROM pair_events pair_event
		WHERE NOT EXISTS (
			SELECT 1 FROM pool_legs WHERE pool_legs.pair_address = pair_event.pair_address AND pool_legs.block_hash = pair_event.block_hash
				AND pool_legs.tx_hash = pair_event.tx_hash AND pool_legs.companion_log_index = pair_event.log_index
		)
	`
}

export type TradingActivityQuery = {
	readonly chainId: number
	readonly asOfBlock: string
	readonly market: string
	readonly cursorBlock: string
	readonly cursorLog: number
	readonly cursorTx: string
	readonly queryLimit: number
}

export const tradingActivityRows = async (sql: SQL, query: TradingActivityQuery) => {
	const { cursorBlock, cursorLog, cursorTx, queryLimit } = query
	return await sql`
		SELECT leg.block_hash, leg.tx_hash, leg.block_number::text, leg.log_index, leg.timestamp_seconds::text, leg.kind, leg.side, leg.account,
			leg.shares::text, leg.eth_in::text AS eth_in_atto_eth, leg.eth_out::text AS eth_out_atto_eth, network.explorer_base_url
		FROM (${tradingLegs(sql, { chainId: query.chainId, asOfBlock: query.asOfBlock, markets: [query.market] })}) leg
		JOIN networks network ON network.chain_id = ${query.chainId}
		WHERE (leg.block_number, leg.log_index, leg.tx_hash) < (${cursorBlock}::bigint, ${cursorLog}::integer, ${cursorTx})
		ORDER BY leg.block_number DESC, leg.log_index DESC, leg.tx_hash DESC LIMIT ${queryLimit}
	`
}

// Traded volume counts router enters and exits: the ETH that bought a position and the ETH its sale returned.
export const tradingVolumeRows = async (sql: SQL, query: TradingLegFilter & { readonly asOfTimestamp: string }) =>
	await sql`
		SELECT leg.pair_address,
			COALESCE(sum(COALESCE(leg.eth_in, 0) + COALESCE(leg.eth_out, 0)) FILTER (WHERE leg.kind IN ('enter', 'exit')), 0)::text AS eth_volume_atto_eth,
			COALESCE(sum(COALESCE(leg.eth_in, 0) + COALESCE(leg.eth_out, 0)) FILTER (WHERE leg.kind IN ('enter', 'exit') AND leg.timestamp_seconds >= ${query.asOfTimestamp}::bigint - 86400), 0)::text AS eth_volume_24h_atto_eth,
			COALESCE(sum(COALESCE(leg.eth_in, 0) + COALESCE(leg.eth_out, 0)) FILTER (WHERE leg.kind IN ('enter', 'exit') AND leg.timestamp_seconds >= ${query.asOfTimestamp}::bigint - 604800), 0)::text AS eth_volume_7d_atto_eth,
			count(*) FILTER (WHERE leg.kind IN ('enter', 'exit'))::integer AS eth_trade_count,
			count(*) FILTER (WHERE leg.kind IN ('enter', 'exit') AND leg.timestamp_seconds >= ${query.asOfTimestamp}::bigint - 86400)::integer AS eth_trade_count_24h
		FROM (${tradingLegs(sql, query)}) leg
		GROUP BY leg.pair_address
	`

// Per-market ETH flows attributed to one account plus the evidence needed to value what it still holds.
export const accountTradingRows = async (sql: SQL, query: { readonly chainId: number; readonly asOfBlock: string; readonly account: string }) => {
	const { chainId, asOfBlock, account } = query
	return await sql`
		WITH flows AS (
			SELECT leg.pair_address, sum(COALESCE(leg.eth_in, 0)) AS eth_in, sum(COALESCE(leg.eth_out, 0)) AS eth_out, count(*)::integer AS action_count,
				max(leg.block_number) AS last_block
			FROM (${tradingLegs(sql, { chainId, asOfBlock, account })}) leg
			WHERE leg.account = ${account}
			GROUP BY leg.pair_address
		), markets AS (
			SELECT DISTINCT ON (market.pair_address) market.pair_address, market.pool_address, market.share_token_address, market.universe_id, market.fee_bps
			FROM amm_markets market
			WHERE market.chain_id = ${chainId} AND market.canonical AND market.block_number <= ${asOfBlock}
			ORDER BY market.pair_address, market.block_number DESC, market.log_index DESC
		), share_moves AS (
			SELECT transfer.emitter_address AS token, trunc(item.id::numeric / 256) AS universe_id, mod(item.id::numeric, 256) AS outcome,
				CASE WHEN lower(transfer.arguments->>'to') = ${account} THEN item.amount::numeric ELSE -item.amount::numeric END AS delta
			FROM logs transfer
			JOIN blocks block ON block.chain_id = transfer.chain_id AND block.hash = transfer.block_hash AND block.canonical
			CROSS JOIN LATERAL (
				SELECT transfer.arguments->>'id' AS id, transfer.arguments->>'value' AS amount WHERE transfer.event_name = 'TransferSingle'
				UNION ALL
				SELECT ids.value #>> '{}', amounts.value #>> '{}'
				FROM jsonb_array_elements(CASE WHEN transfer.event_name = 'TransferBatch' THEN transfer.arguments->'ids' ELSE '[]'::jsonb END) WITH ORDINALITY ids(value, n)
				JOIN jsonb_array_elements(CASE WHEN transfer.event_name = 'TransferBatch' THEN transfer.arguments->'values' ELSE '[]'::jsonb END) WITH ORDINALITY amounts(value, n) USING (n)
			) item
			WHERE transfer.chain_id = ${chainId} AND transfer.canonical AND transfer.block_number <= ${asOfBlock}
				AND transfer.event_name IN ('TransferSingle', 'TransferBatch')
				AND (lower(transfer.arguments->>'to') = ${account}) <> (lower(transfer.arguments->>'from') = ${account})
		), share_balances AS (
			SELECT token, universe_id,
				COALESCE(sum(delta) FILTER (WHERE outcome = 0), 0) AS invalid,
				COALESCE(sum(delta) FILTER (WHERE outcome = 1), 0) AS yes,
				COALESCE(sum(delta) FILTER (WHERE outcome = 2), 0) AS no
			FROM share_moves GROUP BY token, universe_id
		), lp_moves AS (
			SELECT event.market_address, lower(event.event_data->>'from') AS sender, lower(event.event_data->>'to') AS receiver, (event.event_data->>'amount')::numeric AS amount
			FROM amm_trade_events event
			WHERE event.chain_id = ${chainId} AND event.canonical AND event.block_number <= ${asOfBlock} AND event.event_name = 'Transfer'
				AND event.event_data ? 'from' AND event.event_data ? 'to' AND event.event_data ? 'amount'
		), lp_balances AS (
			SELECT market_address, sum(CASE WHEN receiver = ${account} THEN amount ELSE -amount END) AS balance
			FROM lp_moves WHERE (receiver = ${account}) <> (sender = ${account}) GROUP BY market_address
		), positions AS (
			SELECT market.*, COALESCE(flows.eth_in, 0) AS eth_in, COALESCE(flows.eth_out, 0) AS eth_out, COALESCE(flows.action_count, 0) AS action_count,
				COALESCE(share.invalid, 0) AS invalid, COALESCE(share.yes, 0) AS yes, COALESCE(share.no, 0) AS no, COALESCE(lp.balance, 0) AS lp_balance
			FROM markets market
			LEFT JOIN flows ON flows.pair_address = market.pair_address
			LEFT JOIN share_balances share ON share.token = market.share_token_address AND share.universe_id = market.universe_id
			LEFT JOIN lp_balances lp ON lp.market_address = market.pair_address
			WHERE flows.pair_address IS NOT NULL OR COALESCE(share.invalid, 0) <> 0 OR COALESCE(share.yes, 0) <> 0 OR COALESCE(share.no, 0) <> 0 OR COALESCE(lp.balance, 0) <> 0
		)
		SELECT position.pair_address, position.pool_address, question.title AS question_title, position.fee_bps::text,
			position.eth_in::text AS cost_basis_atto_eth, position.eth_out::text AS proceeds_atto_eth, position.action_count,
			position.invalid::text AS invalid_atto_shares, position.yes::text AS yes_atto_shares, position.no::text AS no_atto_shares,
			position.lp_balance::text AS lp_tokens,
			(SELECT COALESCE(sum(CASE WHEN supply.sender = '0x0000000000000000000000000000000000000000' THEN supply.amount ELSE -supply.amount END), 0)
				FROM lp_moves supply WHERE supply.market_address = position.pair_address
					AND (supply.sender = '0x0000000000000000000000000000000000000000') <> (supply.receiver = '0x0000000000000000000000000000000000000000'))::text AS lp_total_supply,
			reserve.yes_reserve_atto_shares::text AS yes_reserve, reserve.no_reserve_atto_shares::text AS no_reserve, reserve.block_number::text AS reserve_block,
			supply_state.supply::text AS share_supply_atto_shares, supply_state.block_number::text AS share_supply_block,
			collateral_state.collateral::text AS settlement_collateral_atto_eth, collateral_state.block_number::text AS settlement_collateral_block,
			question.end_time::text AS question_end_time, lifecycle.read_result->>'systemState' AS pool_system_state,
			lifecycle.read_result->>'awaitingForkContinuation' AS pool_awaiting_fork_continuation, lifecycle.read_result->>'escalationResolved' AS pool_escalation_resolved,
			EXISTS (SELECT 1 FROM pool_state_events settlement WHERE settlement.chain_id = ${chainId} AND settlement.pool_address = position.pool_address
				AND settlement.canonical AND settlement.block_number <= ${asOfBlock} AND settlement.event_name = 'SharesRedeemed') AS settlement_observed,
			count(*) OVER ()::integer AS total
		FROM positions position
		LEFT JOIN pools pool ON pool.chain_id = ${chainId} AND pool.pool_address = position.pool_address AND pool.canonical
		LEFT JOIN questions question ON question.chain_id = pool.chain_id AND question.question_id = pool.question_id AND question.canonical
		LEFT JOIN LATERAL (
			SELECT snapshot.yes_reserve_atto_shares, snapshot.no_reserve_atto_shares, snapshot.block_number FROM amm_price_snapshots snapshot
			WHERE snapshot.chain_id = ${chainId} AND snapshot.pair_address = position.pair_address AND snapshot.canonical AND snapshot.block_number <= ${asOfBlock}
			ORDER BY snapshot.block_number DESC, snapshot.log_index DESC LIMIT 1
		) reserve ON true
		LEFT JOIN LATERAL (
			SELECT (state.state->>'shareTokenSupplyAttoShares')::numeric AS supply, state.block_number FROM pool_state_events state
			WHERE state.chain_id = ${chainId} AND state.pool_address = position.pool_address AND state.canonical AND state.block_number <= ${asOfBlock}
				AND state.state ? 'shareTokenSupplyAttoShares'
			ORDER BY state.block_number DESC, state.log_index DESC LIMIT 1
		) supply_state ON true
		LEFT JOIN LATERAL (
			SELECT collateral, block_number FROM (
				SELECT (state.state->>'resultingSettlementCollateralAttoEth')::numeric AS collateral, state.block_number, state.log_index FROM pool_state_events state
				WHERE state.chain_id = ${chainId} AND state.pool_address = position.pool_address AND state.canonical AND state.block_number <= ${asOfBlock}
					AND state.state ? 'resultingSettlementCollateralAttoEth'
				UNION ALL
				SELECT snapshot.settlement_collateral_atto_eth, snapshot.block_number, snapshot.log_index FROM pool_snapshots snapshot
				WHERE snapshot.chain_id = ${chainId} AND snapshot.pool_address = position.pool_address AND snapshot.canonical AND snapshot.block_number <= ${asOfBlock}
			) candidate ORDER BY block_number DESC, log_index DESC LIMIT 1
		) collateral_state ON true
		LEFT JOIN LATERAL (
			SELECT state.read_result FROM entity_state_snapshots state
			JOIN blocks block ON block.chain_id = state.chain_id AND block.hash = state.block_hash AND block.canonical
			WHERE state.chain_id = ${chainId} AND state.entity_type = 'pool' AND state.entity_identity = position.pool_address
				AND state.canonical AND state.block_number <= ${asOfBlock} AND state.read_status = 'success'
			ORDER BY state.block_number DESC, state.observed_at DESC LIMIT 1
		) lifecycle ON true
		ORDER BY position.eth_in DESC, position.pair_address
		LIMIT 251
	`
}
