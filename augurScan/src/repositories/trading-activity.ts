import type { SQL } from 'bun'

type TradingLegFilter = {
	readonly chainId: number
	readonly asOfBlock: string
	/** Restricts the legs to these pair addresses. */
	readonly markets?: readonly string[]
	/** Restricts the legs to transactions in which this account moved shares, minted, redeemed, or received pair output. */
	readonly account?: string
}

// One row per trading action in an Augur AMM market. CompleteSetsFunded adds purchase fees and identifies the funded
// recipient when the pool minted shares through Security Pool Services. The pair's
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
				AND log.event_name IN ('TransferSingle', 'TransferBatch', 'CompleteSetCreated', 'CompleteSetsFunded', 'CompleteSetRedeemed', 'SharesRedeemed', 'PositionExitedByTransfer', 'CompleteSetRedeemedByTransfer')
				AND (lower(log.arguments->>'from') = ${account} OR lower(log.arguments->>'to') = ${account}
					OR lower(log.arguments->>'payoutRecipient') = ${account} OR lower(log.arguments->>'creator') = ${account} OR lower(log.arguments->>'redeemer') = ${account} OR lower(log.arguments->>'recipient') = ${account})
			UNION
			SELECT tx.block_hash, tx.hash FROM transactions tx
			WHERE ${account}::text IS NOT NULL AND tx.chain_id = ${chainId} AND tx.canonical AND tx.block_number <= ${asOfBlock} AND tx.from_address = ${account}
			UNION
			SELECT event.block_hash, event.tx_hash FROM amm_trade_events event
			WHERE ${account}::text IS NOT NULL AND event.chain_id = ${chainId} AND event.canonical AND event.block_number <= ${asOfBlock}
				AND (lower(event.event_data->>'recipient') = ${account} OR
					(event.event_name = 'Transfer' AND (lower(event.event_data->>'from') = ${account} OR lower(event.event_data->>'to') = ${account})))
		), requested_pairs AS (
			SELECT jsonb_array_elements_text((${markets}::text)::jsonb) AS pair_address
		), markets AS (
			-- Match pair operations across all indexed pairs for the same ledger, even on a single-pair page.
			SELECT market.pair_address, market.pool_address, market.share_token_address, market.universe_id, market.block_number, market.log_index
			FROM amm_markets market
			WHERE market.chain_id = ${chainId} AND market.canonical AND market.block_number <= ${asOfBlock}
				AND (${markets}::text IS NULL OR market.pool_address IN (
					SELECT requested.pool_address FROM amm_markets requested JOIN requested_pairs USING (pair_address)
					WHERE requested.chain_id = market.chain_id AND requested.canonical AND requested.block_number <= ${asOfBlock}
				))
		), ledgers AS (
			SELECT DISTINCT ON (pool_address) pool_address, share_token_address, universe_id, pair_address
			FROM markets ORDER BY pool_address, block_number, log_index, pair_address
		), pool_events AS (
			SELECT market.pair_address AS standalone_pair_address, market.pool_address, market.share_token_address, market.universe_id, log.block_hash, log.tx_hash, log.block_number, log.log_index,
				EXTRACT(EPOCH FROM block.timestamp)::bigint AS timestamp_seconds, log.event_name, payout.recipient AS payout_recipient, payout.pair_address AS payout_pair_address, payout.event_name AS payout_event_name, payout.log_index AS payout_log_index, funding.mint_log_index,
				recovery.amount AS recovery_rep, previous.log_index AS previous_pool_log_index, following.log_index AS next_pool_log_index,
				COALESCE(router.address = lower(funding.arguments->>'recipient') AND action.function_name IN ('enterPosition', 'initializeWithEth', 'createPairAndInitializeWithEth', 'addLiquidityWithEth'), false)
					OR (funding.mint_log_index IS NOT NULL AND EXISTS (
						SELECT 1 FROM logs deposit
						JOIN contracts weth ON weth.chain_id = deposit.chain_id AND weth.address = deposit.emitter_address AND weth.canonical AND weth.kind = 'weth'
						JOIN contracts recipient ON recipient.chain_id = deposit.chain_id AND recipient.address = lower(deposit.arguments->>'dst') AND recipient.canonical AND recipient.kind = 'ammRouter'
						WHERE deposit.chain_id = log.chain_id AND deposit.block_hash = log.block_hash AND deposit.tx_hash = log.tx_hash
							AND deposit.canonical AND deposit.event_name = 'Deposit' AND deposit.log_index < log.log_index
							AND recipient.address = lower(funding.arguments->>'recipient')
							AND (deposit.arguments->>'wad')::numeric = (funding.arguments->>'cashAttoEth')::numeric + (funding.arguments->>'purchaseFeeAttoEth')::numeric
							AND NOT EXISTS (
								SELECT 1 FROM logs prior WHERE prior.chain_id = log.chain_id AND prior.block_hash = log.block_hash AND prior.tx_hash = log.tx_hash
									AND prior.canonical AND prior.event_name = 'CompleteSetsFunded' AND lower(prior.arguments->>'recipient') = recipient.address
									AND prior.log_index > deposit.log_index AND prior.log_index < log.log_index
							)
					))
					OR EXISTS (
						SELECT 1 FROM logs withdrawal
						JOIN contracts weth ON weth.chain_id = withdrawal.chain_id AND weth.address = withdrawal.emitter_address AND weth.canonical AND weth.kind = 'weth'
						WHERE withdrawal.chain_id = log.chain_id AND withdrawal.block_hash = log.block_hash AND withdrawal.tx_hash = log.tx_hash
							AND withdrawal.canonical AND withdrawal.event_name = 'Withdrawal' AND withdrawal.log_index > log.log_index AND withdrawal.log_index < payout.log_index
							AND lower(withdrawal.arguments->>'src') = lower(log.arguments->>'redeemer')
							AND withdrawal.arguments->>'wad' = log.arguments->>'settlementCollateralRedeemedAttoEth'
					) AS native_collateral,
				CASE WHEN (tx.to_address = funding.emitter_address AND action.function_name IN ('createCompleteSet', 'createCompleteSetWithRecoveryRep'))
					OR (router.address = lower(funding.arguments->>'recipient') AND action.function_name IN ('enterPosition', 'enterPositionWithCollateral', 'initializeWithEth', 'initializeWithCollateral',
						'createPairAndInitializeWithEth', 'createPairAndInitializeWithCollateral', 'addLiquidityWithEth', 'addLiquidityWithCollateral')) THEN tx.from_address END AS payer,
				lower(COALESCE(funding.arguments->>'recipient', log.arguments->>'creator', log.arguments->>'redeemer')) AS actor,
				(CASE log.event_name WHEN 'CompleteSetCreated' THEN log.arguments->>'settlementCollateralProvidedAttoEth' ELSE log.arguments->>'settlementCollateralRedeemedAttoEth' END)::numeric
					+ COALESCE((funding.arguments->>'purchaseFeeAttoEth')::numeric, 0) AS eth,
				(CASE log.event_name WHEN 'CompleteSetCreated' THEN log.arguments->>'completeSetsMintedAttoShares' WHEN 'CompleteSetRedeemed' THEN log.arguments->>'completeSetsBurnedAttoShares' ELSE log.arguments->>'winningSharesBurnedAttoShares' END)::numeric AS sets
			FROM ledgers market
			JOIN logs log ON log.chain_id = ${chainId} AND log.emitter_address = market.pool_address AND log.canonical AND log.block_number <= ${asOfBlock}
				AND log.event_name IN ('CompleteSetCreated', 'CompleteSetRedeemed', 'SharesRedeemed')
				AND (${account}::text IS NULL OR (log.block_hash, log.tx_hash) IN (SELECT block_hash, tx_hash FROM account_transactions))
			JOIN blocks block ON block.chain_id = log.chain_id AND block.hash = log.block_hash AND block.canonical
			LEFT JOIN pools pool ON pool.chain_id = log.chain_id AND pool.pool_address = market.pool_address AND pool.canonical
			LEFT JOIN LATERAL (
				SELECT other.log_index FROM logs other
				WHERE other.chain_id = log.chain_id AND other.block_hash = log.block_hash AND other.tx_hash = log.tx_hash
					AND other.emitter_address = log.emitter_address AND other.canonical AND other.log_index < log.log_index
					AND other.event_name IN ('CompleteSetCreated', 'CompleteSetRedeemed', 'SharesRedeemed')
				ORDER BY other.log_index DESC LIMIT 1
			) previous ON true
			LEFT JOIN LATERAL (
				SELECT other.log_index FROM logs other
				WHERE other.chain_id = log.chain_id AND other.block_hash = log.block_hash AND other.tx_hash = log.tx_hash
					AND other.emitter_address = log.emitter_address AND other.canonical AND other.log_index > log.log_index
					AND other.event_name IN ('CompleteSetCreated', 'CompleteSetRedeemed', 'SharesRedeemed')
				ORDER BY other.log_index LIMIT 1
			) following ON true
			LEFT JOIN LATERAL (
				SELECT funded.arguments, funded.emitter_address, delivery.log_index AS mint_log_index
				FROM logs funded
				JOIN contracts security_pool ON security_pool.chain_id = funded.chain_id AND security_pool.address = funded.emitter_address
					AND security_pool.canonical AND security_pool.kind = 'securityPool'
				JOIN logs delivery ON delivery.chain_id = funded.chain_id AND delivery.block_hash = funded.block_hash AND delivery.tx_hash = funded.tx_hash
					AND delivery.canonical AND delivery.emitter_address = market.share_token_address AND delivery.event_name = 'TransferBatch'
					AND delivery.log_index > log.log_index AND delivery.log_index < funded.log_index
					AND lower(delivery.arguments->>'operator') = log.emitter_address AND lower(delivery.arguments->>'from') = '0x0000000000000000000000000000000000000000'
					AND lower(delivery.arguments->>'to') = lower(funded.arguments->>'recipient')
					AND delivery.arguments->'ids' = jsonb_build_array((market.universe_id * 256)::text, (market.universe_id * 256 + 1)::text, (market.universe_id * 256 + 2)::text)
					AND delivery.arguments->'values' = jsonb_build_array(funded.arguments->>'shares', funded.arguments->>'shares', funded.arguments->>'shares')
				WHERE funded.chain_id = log.chain_id AND funded.block_hash = log.block_hash AND funded.tx_hash = log.tx_hash
					AND funded.canonical AND funded.event_name = 'CompleteSetsFunded' AND funded.log_index > log.log_index
					AND funded.arguments->>'questionId' = pool.question_id::text AND funded.arguments->>'universeId' = market.universe_id::text
					AND funded.arguments->>'shares' = log.arguments->>'completeSetsMintedAttoShares'
					AND funded.arguments->>'cashAttoEth' = log.arguments->>'settlementCollateralProvidedAttoEth'
					AND NOT EXISTS (
						SELECT 1 FROM logs other WHERE other.chain_id = log.chain_id AND other.block_hash = log.block_hash AND other.tx_hash = log.tx_hash
							AND other.canonical AND other.emitter_address = log.emitter_address AND other.event_name = 'CompleteSetCreated'
							AND other.log_index BETWEEN log.log_index + 1 AND funded.log_index
					)
				ORDER BY funded.log_index LIMIT 1
			) funding ON log.event_name = 'CompleteSetCreated'
			LEFT JOIN transactions tx ON tx.chain_id = log.chain_id AND tx.block_hash = log.block_hash AND tx.hash = log.tx_hash AND tx.canonical
			LEFT JOIN actions action ON action.chain_id = tx.chain_id AND action.block_hash = tx.block_hash AND action.tx_hash = tx.hash
				AND action.contract_address = tx.to_address AND action.decode_status = 'decoded'
			LEFT JOIN contracts router ON router.chain_id = tx.chain_id AND router.address = tx.to_address AND router.kind = 'ammRouter' AND router.canonical
			LEFT JOIN LATERAL (
				SELECT lower(exit.arguments->>'payoutRecipient') AS recipient, lower(exit.arguments->>'pair') AS pair_address, exit.event_name, exit.log_index
				FROM logs exit
				JOIN contracts router ON router.chain_id = exit.chain_id AND router.address = exit.emitter_address
					AND router.canonical AND router.kind = 'ammRouter'
				WHERE exit.chain_id = log.chain_id AND exit.block_hash = log.block_hash AND exit.tx_hash = log.tx_hash
					AND exit.canonical AND exit.log_index > log.log_index AND exit.emitter_address = lower(log.arguments->>'redeemer')
					AND exit.arguments->>'completeSetShares' = log.arguments->>'completeSetsBurnedAttoShares'
					AND ((exit.event_name = 'PositionExitedByTransfer' AND EXISTS (
						SELECT 1 FROM markets pair WHERE pair.pool_address = market.pool_address AND pair.pair_address = lower(exit.arguments->>'pair')
					))
						OR (exit.event_name = 'CompleteSetRedeemedByTransfer' AND lower(exit.arguments->>'questionLedger') = market.pool_address))
					AND NOT EXISTS (
						SELECT 1 FROM logs other WHERE other.chain_id = log.chain_id AND other.block_hash = log.block_hash AND other.tx_hash = log.tx_hash
							AND other.canonical AND other.emitter_address = market.pool_address AND other.event_name = 'CompleteSetRedeemed'
							AND lower(other.arguments->>'redeemer') = exit.emitter_address AND other.log_index BETWEEN log.log_index + 1 AND exit.log_index
					)
				ORDER BY exit.log_index LIMIT 1
			) payout ON log.event_name = 'CompleteSetRedeemed'
			LEFT JOIN LATERAL (
				-- Settlement pays recovery REP after the ledger burns the shares and before the ledger records redemption.
				SELECT paid.arguments->>'amountAttoRep' AS amount
				FROM logs paid
				JOIN contracts settlement ON settlement.chain_id = paid.chain_id AND settlement.address = paid.emitter_address
					AND settlement.canonical AND settlement.kind = 'securityPoolSettlement'
				WHERE paid.chain_id = log.chain_id AND paid.block_hash = log.block_hash AND paid.tx_hash = log.tx_hash
					AND paid.canonical AND paid.event_name = 'RecoveryRepPaid' AND paid.log_index < log.log_index
					AND paid.arguments->>'universeId' = market.universe_id::text AND paid.arguments->>'questionId' = pool.question_id::text
					AND lower(paid.arguments->>'recipient') = lower(log.arguments->>'redeemer')
					AND paid.log_index > (
						SELECT max(burn.log_index) FROM logs burn
						WHERE burn.chain_id = log.chain_id AND burn.block_hash = log.block_hash AND burn.tx_hash = log.tx_hash
							AND burn.emitter_address = market.share_token_address AND burn.canonical AND burn.log_index < log.log_index
							AND burn.event_name IN ('TransferSingle', 'TransferBatch')
							AND lower(burn.arguments->>'from') = lower(log.arguments->>'redeemer')
							AND lower(burn.arguments->>'to') = '0x0000000000000000000000000000000000000000'
					)
				ORDER BY paid.log_index DESC LIMIT 1
			) recovery ON log.event_name IN ('CompleteSetRedeemed', 'SharesRedeemed')
		), pair_events AS (
			SELECT market.pair_address, market.pool_address, event.block_hash, event.tx_hash, event.block_number, event.log_index,
				EXTRACT(EPOCH FROM block.timestamp)::bigint AS timestamp_seconds, event.event_name, event.event_data,
				lower(COALESCE(event.event_data->>'sender', event.event_data->>'provider')) AS caller,
				lower(event.event_data->>'recipient') AS recipient
			FROM markets market
			JOIN amm_trade_events event ON event.chain_id = ${chainId} AND event.market_address = market.pair_address AND event.canonical AND event.block_number <= ${asOfBlock}
				AND event.event_name IN ('Swap', 'LiquidityInitialized', 'LiquidityAdded', 'LiquidityRemoved')
				AND (${account}::text IS NULL OR (event.block_hash, event.tx_hash) IN (SELECT block_hash, tx_hash FROM account_transactions))
			JOIN blocks block ON block.chain_id = event.chain_id AND block.hash = event.block_hash AND block.canonical
		), pool_legs AS (
			SELECT pool_event.*, COALESCE(pool_event.payout_pair_address, companion.pair_address, pool_event.standalone_pair_address) AS pair_address, companion.event_name AS companion_name, companion.event_data AS companion_data, companion.log_index AS companion_log_index, flow.holder, flow.forwarded_to, flow.received_from
			FROM pool_events pool_event
			LEFT JOIN LATERAL (
				SELECT pair_event.pair_address, pair_event.event_name, pair_event.event_data, pair_event.log_index FROM pair_events pair_event
				JOIN contracts router ON router.chain_id = ${chainId} AND router.canonical AND router.address = pair_event.caller AND router.kind = 'ammRouter'
				WHERE pair_event.pool_address = pool_event.pool_address AND pair_event.block_hash = pool_event.block_hash
					AND pair_event.tx_hash = pool_event.tx_hash AND pair_event.caller = pool_event.actor AND (
						(pool_event.event_name = 'CompleteSetCreated'
							AND pair_event.log_index > COALESCE(pool_event.mint_log_index, pool_event.log_index)
							AND (pool_event.next_pool_log_index IS NULL OR pair_event.log_index < pool_event.next_pool_log_index)
							AND (pair_event.event_name IN ('LiquidityInitialized', 'LiquidityAdded')
								OR (pair_event.event_name = 'Swap' AND pair_event.event_data->>'exactOutput' = 'false')))
						OR (pool_event.event_name = 'CompleteSetRedeemed' AND pair_event.log_index < pool_event.log_index
							AND pool_event.payout_event_name IS DISTINCT FROM 'CompleteSetRedeemedByTransfer'
							AND (pool_event.payout_pair_address IS NULL OR pair_event.pair_address = pool_event.payout_pair_address)
							AND (pool_event.previous_pool_log_index IS NULL OR pair_event.log_index > pool_event.previous_pool_log_index)
							AND pair_event.event_name = 'Swap' AND pair_event.event_data->>'exactOutput' = 'true')
					)
				ORDER BY abs(pair_event.log_index - pool_event.log_index), pair_event.log_index LIMIT 1
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
						AND (pool_event.previous_pool_log_index IS NULL OR transfer.log_index > pool_event.previous_pool_log_index)
						AND (pool_event.next_pool_log_index IS NULL OR transfer.log_index < pool_event.next_pool_log_index)
						-- Exits may refund shares after the ledger redemption, before the router records the payout.
						AND CASE WHEN pool_event.event_name = 'CompleteSetCreated' THEN transfer.log_index > pool_event.log_index
							ELSE pool_event.payout_log_index IS NULL OR transfer.log_index <= pool_event.payout_log_index END
				), market_moves AS (
					SELECT * FROM moves WHERE trunc(id / 256) = pool_event.universe_id AND sender <> receiver
				)
				SELECT
					EXISTS (
						SELECT 1 FROM market_moves WHERE sender = pool_event.actor OR receiver = pool_event.actor
						GROUP BY id HAVING sum(CASE WHEN receiver = pool_event.actor THEN amount ELSE -amount END) <> 0
					) AS holder,
					(SELECT CASE WHEN count(DISTINCT receiver) = 1 THEN min(receiver) END FROM market_moves
						WHERE sender = pool_event.actor AND receiver NOT IN (COALESCE(companion.pair_address, pool_event.standalone_pair_address), '0x0000000000000000000000000000000000000000')) AS forwarded_to,
					(SELECT CASE WHEN count(DISTINCT sender) = 1 THEN min(sender) END FROM market_moves
						WHERE receiver = pool_event.actor AND sender NOT IN (COALESCE(companion.pair_address, pool_event.standalone_pair_address), '0x0000000000000000000000000000000000000000')) AS received_from
			) flow ON true
		)
		SELECT pair_address, pool_address, block_hash, tx_hash, block_number, log_index, timestamp_seconds,
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
				WHEN companion_name IN ('LiquidityInitialized', 'LiquidityAdded') THEN lower(companion_data->>'recipient')
				WHEN holder THEN actor
				WHEN event_name = 'CompleteSetCreated' THEN COALESCE(forwarded_to, actor)
				ELSE COALESCE(received_from, actor)
			END AS account, payout_recipient, CASE WHEN event_name = 'CompleteSetCreated' THEN payer ELSE COALESCE(received_from, actor) END AS input_owner, mint_log_index, actor AS pool_actor,
			CASE
				WHEN companion_name IN ('LiquidityInitialized', 'LiquidityAdded') THEN (companion_data->>'liquidity')::numeric
				WHEN companion_name = 'Swap' AND event_name = 'CompleteSetCreated' THEN sets + (companion_data->>'amountOut')::numeric
				WHEN companion_name = 'Swap' THEN sets + (companion_data->>'amountIn')::numeric
				ELSE sets
			END AS shares,
			CASE WHEN event_name = 'CompleteSetCreated' THEN eth ELSE 0 END AS eth_in,
			CASE WHEN event_name = 'CompleteSetCreated' THEN 0 ELSE eth END AS eth_out,
			companion_log_index, recovery_rep, native_collateral
		FROM pool_legs
		WHERE ${markets}::text IS NULL OR pair_address IN (SELECT pair_address FROM requested_pairs)
		UNION ALL
		SELECT pair_event.pair_address, pair_event.pool_address, pair_event.block_hash, pair_event.tx_hash, pair_event.block_number, pair_event.log_index, pair_event.timestamp_seconds,
			CASE pair_event.event_name WHEN 'Swap' THEN 'swap' WHEN 'LiquidityRemoved' THEN 'remove-liquidity' ELSE 'add-liquidity' END AS kind,
			CASE WHEN pair_event.event_name <> 'Swap' THEN NULL WHEN pair_event.event_data->>'yesForNo' = 'true' THEN 'NO' ELSE 'YES' END AS side,
			pair_event.recipient AS account, NULL::text AS payout_recipient, COALESCE(lp_funder.owner, pair_event.caller) AS input_owner, NULL::integer AS mint_log_index, NULL::text AS pool_actor,
			(CASE WHEN pair_event.event_name = 'Swap' THEN pair_event.event_data->>'amountOut' ELSE pair_event.event_data->>'liquidity' END)::numeric AS shares,
			NULL::numeric AS eth_in, NULL::numeric AS eth_out, NULL::integer AS companion_log_index, NULL::text AS recovery_rep, false AS native_collateral
		FROM pair_events pair_event
		LEFT JOIN LATERAL (
			-- The permit router pulls LP and then burns it without another pair Transfer between those two logs.
			SELECT lower(pull.event_data->>'from') AS owner
			FROM contracts router
			CROSS JOIN LATERAL (
				SELECT event.log_index, event.event_data FROM amm_trade_events event
				WHERE event.chain_id = ${chainId} AND event.market_address = pair_event.pair_address
					AND event.block_hash = pair_event.block_hash AND event.tx_hash = pair_event.tx_hash
					AND event.canonical AND event.event_name = 'Transfer' AND event.log_index < pair_event.log_index
				ORDER BY event.log_index DESC LIMIT 1
			) burn
			CROSS JOIN LATERAL (
				SELECT event.event_data FROM amm_trade_events event
				WHERE event.chain_id = ${chainId} AND event.market_address = pair_event.pair_address
					AND event.block_hash = pair_event.block_hash AND event.tx_hash = pair_event.tx_hash
					AND event.canonical AND event.event_name = 'Transfer' AND event.log_index < burn.log_index
				ORDER BY event.log_index DESC LIMIT 1
			) pull
			WHERE pair_event.event_name = 'LiquidityRemoved' AND router.chain_id = ${chainId} AND router.canonical
				AND router.address = pair_event.caller AND router.kind = 'ammRouter'
				AND lower(burn.event_data->>'from') = router.address
				AND lower(burn.event_data->>'to') = '0x0000000000000000000000000000000000000000'
				AND lower(pull.event_data->>'to') = router.address
				AND lower(pull.event_data->>'from') NOT IN (router.address, '0x0000000000000000000000000000000000000000')
				AND burn.event_data->>'value' = pair_event.event_data->>'liquidity'
				AND pull.event_data->>'value' = pair_event.event_data->>'liquidity'
		) lp_funder ON true
		WHERE (${markets}::text IS NULL OR pair_event.pair_address IN (SELECT pair_address FROM requested_pairs))
			AND NOT EXISTS (
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
		SELECT leg.block_hash, leg.tx_hash, leg.block_number::text, leg.log_index, leg.timestamp_seconds::text, leg.kind, leg.side, leg.account, leg.payout_recipient, CASE WHEN leg.eth_in > 0 THEN leg.input_owner END AS payer_address,
			leg.shares::text, leg.eth_in::text AS eth_in_atto_eth, leg.eth_out::text AS eth_out_atto_eth, leg.recovery_rep AS recovery_rep_atto_rep, leg.native_collateral, network.explorer_base_url,
			(SELECT state.read_result->'collateral' FROM entity_state_snapshots state
			 JOIN amm_markets market ON market.chain_id = state.chain_id AND market.pool_address = state.entity_identity AND market.canonical
			 WHERE state.chain_id = ${query.chainId} AND market.pair_address = leg.pair_address AND state.entity_type = 'pool' AND state.canonical AND state.read_status = 'success' AND state.block_number <= ${query.asOfBlock}
			 ORDER BY state.block_number DESC, state.observed_at DESC LIMIT 1) AS collateral
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
			(SELECT state.read_result->'collateral' FROM entity_state_snapshots state
			 JOIN amm_markets market ON market.chain_id = state.chain_id AND market.pool_address = state.entity_identity AND market.canonical
			 WHERE state.chain_id = ${query.chainId} AND market.pair_address = leg.pair_address AND state.entity_type = 'pool' AND state.canonical AND state.read_status = 'success' AND state.block_number <= ${query.asOfBlock}
			 ORDER BY state.block_number DESC, state.observed_at DESC LIMIT 1) AS collateral,
			COALESCE(sum(COALESCE(leg.eth_in, 0) + COALESCE(leg.eth_out, 0)) FILTER (WHERE leg.kind IN ('enter', 'exit')), 0)::text AS eth_volume_atto_eth,
			COALESCE(sum(COALESCE(leg.eth_in, 0) + COALESCE(leg.eth_out, 0)) FILTER (WHERE leg.kind IN ('enter', 'exit') AND leg.timestamp_seconds >= ${query.asOfTimestamp}::bigint - 86400), 0)::text AS eth_volume_24h_atto_eth,
			COALESCE(sum(COALESCE(leg.eth_in, 0) + COALESCE(leg.eth_out, 0)) FILTER (WHERE leg.kind IN ('enter', 'exit') AND leg.timestamp_seconds >= ${query.asOfTimestamp}::bigint - 604800), 0)::text AS eth_volume_7d_atto_eth,
			count(*) FILTER (WHERE leg.kind IN ('enter', 'exit'))::integer AS eth_trade_count,
			count(*) FILTER (WHERE leg.kind IN ('enter', 'exit') AND leg.timestamp_seconds >= ${query.asOfTimestamp}::bigint - 86400)::integer AS eth_trade_count_24h
		FROM (${tradingLegs(sql, query)}) leg
		GROUP BY leg.pair_address
	`

// Per-ledger collateral flows and indexed positions. All pairs on a ledger trade the same outcome shares.
export const accountTradingRows = async (sql: SQL, query: { readonly chainId: number; readonly asOfBlock: string; readonly account: string }) => {
	const { chainId, asOfBlock, account } = query
	// A pair emits its Swap or liquidity event after transferring output. In a batched transaction only
	// the next pair operation can explain this particular receipt, including an LP mint.
	const matchingPairOperation = sql`COALESCE(leg.companion_log_index, leg.log_index) = (
		SELECT event.log_index FROM amm_trade_events event
		WHERE event.chain_id = ${chainId} AND event.market_address = leg.pair_address AND event.canonical
			AND event.block_hash = incoming.block_hash AND event.tx_hash = incoming.tx_hash AND event.log_index > incoming.log_index
			AND event.event_name IN ('Swap', 'LiquidityAdded', 'LiquidityInitialized', 'LiquidityRemoved')
		ORDER BY event.log_index LIMIT 1
	)`

	return await sql`
		WITH account_legs AS (
			${tradingLegs(sql, { chainId, asOfBlock, account })}
		), flows AS (
			SELECT leg.pool_address, sum(CASE WHEN leg.input_owner = ${account} THEN COALESCE(leg.eth_in, 0) ELSE 0 END) AS eth_in, sum(CASE WHEN COALESCE(leg.payout_recipient, leg.account) = ${account} THEN COALESCE(leg.eth_out, 0) ELSE 0 END) AS eth_out, count(*)::integer AS action_count,
				max(leg.block_number) AS last_block
			FROM account_legs leg
			WHERE leg.account = ${account} OR leg.payout_recipient = ${account} OR (leg.eth_in > 0 AND leg.input_owner = ${account})
			GROUP BY leg.pool_address
		), markets AS (
			SELECT market.pair_address, market.pool_address, market.share_token_address, market.universe_id, market.fee_bps, market.block_number, market.log_index
			FROM amm_markets market
			WHERE market.chain_id = ${chainId} AND market.canonical AND market.block_number <= ${asOfBlock}
		), share_moves AS (
			SELECT transfer.block_hash, transfer.tx_hash, transfer.log_index, lower(transfer.arguments->>'from') AS sender, transfer.emitter_address AS token, trunc(item.id::numeric / 256) AS universe_id, mod(item.id::numeric, 256) AS outcome,
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
			SELECT event.market_address, event.block_hash, event.tx_hash, event.log_index, lower(event.event_data->>'from') AS sender, lower(event.event_data->>'to') AS receiver, (event.event_data->>'value')::numeric AS amount
			FROM amm_trade_events event
			WHERE event.chain_id = ${chainId} AND event.canonical AND event.block_number <= ${asOfBlock} AND event.event_name = 'Transfer'
				AND event.event_data ? 'from' AND event.event_data ? 'to' AND event.event_data ? 'value'
		), lp_balances AS (
			SELECT market_address, sum(CASE WHEN receiver = ${account} THEN amount ELSE -amount END) AS balance
			FROM lp_moves WHERE (receiver = ${account}) <> (sender = ${account}) GROUP BY market_address
		), lp_inventory AS (
			SELECT market.pool_address, count(*)::integer AS pair_count, bool_or(lp.balance < 0) AS incomplete,
				jsonb_agg(jsonb_build_object('pair_address', market.pair_address, 'balance', CASE WHEN lp.balance >= 0 THEN lp.balance::text END, 'observed_balance_delta', lp.balance::text) ORDER BY market.pair_address) AS positions
			FROM lp_balances lp JOIN markets market ON market.pair_address = lp.market_address
			WHERE lp.balance <> 0 GROUP BY market.pool_address
		), positions AS (
			-- Prefer the pair whose LP tokens the account holds, or the first registered pair for share-only positions.
			SELECT DISTINCT ON (market.pool_address) market.*, COALESCE(flows.eth_in, 0) AS eth_in, COALESCE(flows.eth_out, 0) AS eth_out, COALESCE(flows.action_count, 0) AS action_count,
				COALESCE(share.invalid, 0) AS invalid, COALESCE(share.yes, 0) AS yes, COALESCE(share.no, 0) AS no, COALESCE(lp.balance, 0) AS lp_balance
			FROM markets market
			LEFT JOIN flows ON flows.pool_address = market.pool_address
			LEFT JOIN share_balances share ON share.token = market.share_token_address AND share.universe_id = market.universe_id
			LEFT JOIN lp_balances lp ON lp.market_address = market.pair_address
			WHERE flows.pool_address IS NOT NULL OR COALESCE(share.invalid, 0) <> 0 OR COALESCE(share.yes, 0) <> 0 OR COALESCE(share.no, 0) <> 0 OR COALESCE(lp.balance, 0) <> 0
			ORDER BY market.pool_address, (COALESCE(lp.balance, 0) <> 0) DESC, market.block_number, market.log_index, market.pair_address
		)
		SELECT position.pair_address, position.pool_address, question.title AS question_title, position.fee_bps::text,
			(EXISTS (
				SELECT 1 FROM share_moves incoming WHERE incoming.token = position.share_token_address AND incoming.universe_id = position.universe_id
					AND incoming.delta > 0
					AND NOT EXISTS (
						SELECT 1 FROM account_legs leg WHERE leg.account = ${account} AND leg.input_owner = ${account} AND leg.pool_address = position.pool_address
							AND leg.block_hash = incoming.block_hash AND leg.tx_hash = incoming.tx_hash AND (
								incoming.log_index = leg.mint_log_index OR (incoming.sender = leg.pair_address AND ${matchingPairOperation}) OR (incoming.sender = leg.pool_actor AND EXISTS (
									SELECT 1 FROM contracts sender WHERE sender.chain_id = ${chainId} AND sender.address = incoming.sender AND sender.canonical
										AND sender.kind = 'ammRouter'
								))
							)
					)
			) OR EXISTS (SELECT 1 FROM lp_moves incoming JOIN markets incoming_market ON incoming_market.pair_address = incoming.market_address
				WHERE incoming_market.pool_address = position.pool_address AND incoming.amount > 0
				AND incoming.receiver = ${account} AND incoming.sender <> ${account} AND (
					incoming.sender <> '0x0000000000000000000000000000000000000000' OR NOT EXISTS (
						SELECT 1 FROM account_legs leg WHERE leg.account = ${account} AND leg.input_owner = ${account} AND leg.kind = 'add-liquidity'
							AND leg.pair_address = incoming.market_address AND leg.tx_hash = incoming.tx_hash AND leg.block_hash = incoming.block_hash AND ${matchingPairOperation}
					)))) AS unknown_transfer_basis,
			lifecycle.read_result->'settlementClaim' AS settlement_claim,
			lifecycle.read_result->>'questionSettlementAttoEth' AS sampled_redemption_atto_eth, lifecycle.read_result->>'shareTokenSupplyAttoShares' AS sampled_share_supply,
			position.eth_in::text AS cost_basis_atto_eth, position.eth_out::text AS proceeds_atto_eth, position.action_count,
			position.invalid::text AS invalid_atto_shares, position.yes::text AS yes_atto_shares, position.no::text AS no_atto_shares,
			position.lp_balance::text AS lp_tokens, inventory.pair_count AS lp_pair_count, inventory.incomplete AS incomplete_lp,
			inventory.positions AS lp_token_positions,
			(SELECT COALESCE(sum(CASE WHEN supply.sender = '0x0000000000000000000000000000000000000000' THEN supply.amount ELSE -supply.amount END), 0)
				FROM lp_moves supply WHERE supply.market_address = position.pair_address
					AND (supply.sender = '0x0000000000000000000000000000000000000000') <> (supply.receiver = '0x0000000000000000000000000000000000000000'))::text AS lp_total_supply,
			(reserve.yes_reserve_atto_shares + COALESCE(reserve_moves.yes_delta, 0))::text AS yes_reserve,
			(reserve.no_reserve_atto_shares + COALESCE(reserve_moves.no_delta, 0))::text AS no_reserve,
			GREATEST(reserve.block_number, reserve_moves.last_block)::text AS reserve_block,
			supply_state.supply::text AS share_supply_atto_shares, supply_state.block_number::text AS share_supply_block,
			collateral_state.collateral::text AS settlement_collateral_atto_eth, collateral_state.block_number::text AS settlement_collateral_block,
			lifecycle.read_result->'collateral' AS collateral, question.end_time::text AS question_end_time, lifecycle.block_number::text AS pool_read_block, lifecycle.read_result->>'systemState' AS pool_system_state,
			lifecycle.read_result->>'awaitingForkContinuation' AS pool_awaiting_fork_continuation, lifecycle.read_result->>'escalationResolved' AS pool_escalation_resolved,
			system_event.state->>'systemState' AS system_state_event, system_event.block_number::text AS system_state_event_block,
			continuation_event.state->>'awaitingForkContinuation' AS awaiting_fork_continuation_event, continuation_event.block_number::text AS awaiting_fork_continuation_event_block,
			escalation.read_result->>'finalQuestionResolution' AS final_question_resolution,
			fork.block_number IS NOT NULL AS universe_forked, fork.block_number::text AS universe_fork_block,
			EXISTS (SELECT 1 FROM pool_state_events settlement WHERE settlement.chain_id = ${chainId} AND settlement.pool_address = position.pool_address
				AND settlement.canonical AND settlement.block_number <= ${asOfBlock} AND settlement.event_name = 'SharesRedeemed') AS settlement_observed,
			count(*) OVER ()::integer AS total
		FROM positions position
		LEFT JOIN lp_inventory inventory ON inventory.pool_address = position.pool_address
		LEFT JOIN pools pool ON pool.chain_id = ${chainId} AND pool.pool_address = position.pool_address AND pool.canonical
		LEFT JOIN questions question ON question.chain_id = pool.chain_id AND question.question_id = pool.question_id AND question.canonical
		LEFT JOIN LATERAL (
			SELECT max(event.block_number) AS block_number FROM universe_events event
			WHERE event.chain_id = ${chainId} AND event.universe_id = position.universe_id AND event.canonical
				AND event.block_number <= ${asOfBlock} AND event.event_name = 'UniverseForked'
		) fork ON true
		LEFT JOIN LATERAL (
			SELECT snapshot.yes_reserve_atto_shares, snapshot.no_reserve_atto_shares, snapshot.block_number, snapshot.log_index FROM amm_price_snapshots snapshot
			WHERE snapshot.chain_id = ${chainId} AND snapshot.pair_address = position.pair_address AND snapshot.canonical AND snapshot.block_number <= ${asOfBlock}
			ORDER BY snapshot.block_number DESC, snapshot.log_index DESC LIMIT 1
		) reserve ON true
		LEFT JOIN LATERAL (
			-- Sync anchors the pair balances. Later share transfers can change them without another pair event.
			SELECT
				sum(move.delta) FILTER (WHERE move.token_id = (position.universe_id * 256 + 1)::text) AS yes_delta,
				sum(move.delta) FILTER (WHERE move.token_id = (position.universe_id * 256 + 2)::text) AS no_delta,
				max(move.block_number) AS last_block
			FROM (
				SELECT item.token_id, transfer.block_number,
					CASE WHEN lower(transfer.arguments->>'to') = position.pair_address THEN item.amount::numeric ELSE -item.amount::numeric END AS delta
				FROM logs transfer
				CROSS JOIN LATERAL (
					SELECT transfer.arguments->>'id' AS token_id, transfer.arguments->>'value' AS amount WHERE transfer.event_name = 'TransferSingle'
					UNION ALL
					SELECT ids.value #>> '{}', amounts.value #>> '{}'
					FROM jsonb_array_elements(CASE WHEN transfer.event_name = 'TransferBatch' THEN transfer.arguments->'ids' ELSE '[]'::jsonb END) WITH ORDINALITY ids(value, n)
					JOIN jsonb_array_elements(CASE WHEN transfer.event_name = 'TransferBatch' THEN transfer.arguments->'values' ELSE '[]'::jsonb END) WITH ORDINALITY amounts(value, n) USING (n)
				) item
				WHERE transfer.chain_id = ${chainId} AND transfer.canonical AND transfer.emitter_address = position.share_token_address
					AND transfer.block_number BETWEEN reserve.block_number AND ${asOfBlock}
					AND (transfer.block_number, transfer.log_index) > (reserve.block_number, reserve.log_index)
					AND transfer.event_name IN ('TransferSingle', 'TransferBatch')
					AND (lower(transfer.arguments->>'to') = position.pair_address) <> (lower(transfer.arguments->>'from') = position.pair_address)
					AND item.token_id IN ((position.universe_id * 256 + 1)::text, (position.universe_id * 256 + 2)::text)
			) move WHERE move.delta <> 0
		) reserve_moves ON reserve.block_number IS NOT NULL
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
			SELECT state.read_result, state.block_number FROM entity_state_snapshots state
			JOIN blocks block ON block.chain_id = state.chain_id AND block.hash = state.block_hash AND block.canonical
			WHERE state.chain_id = ${chainId} AND state.entity_type = 'pool' AND state.entity_identity = position.pool_address
				AND state.canonical AND state.block_number <= ${asOfBlock} AND state.read_status = 'success'
			ORDER BY state.block_number DESC, state.observed_at DESC LIMIT 1
		) lifecycle ON true
		LEFT JOIN LATERAL (
			SELECT state.state, state.block_number FROM pool_state_events state
			WHERE state.chain_id = ${chainId} AND state.pool_address = position.pool_address AND state.canonical AND state.block_number <= ${asOfBlock}
				AND state.state ? 'systemState'
			ORDER BY state.block_number DESC, state.log_index DESC LIMIT 1
		) system_event ON true
		LEFT JOIN LATERAL (
			SELECT state.state, state.block_number FROM pool_state_events state
			WHERE state.chain_id = ${chainId} AND state.pool_address = position.pool_address AND state.canonical AND state.block_number <= ${asOfBlock}
				AND state.state ? 'awaitingForkContinuation'
			ORDER BY state.block_number DESC, state.log_index DESC LIMIT 1
		) continuation_event ON true
		LEFT JOIN LATERAL (
			SELECT snapshot.read_result FROM pool_state_events game
			JOIN entity_state_snapshots snapshot ON snapshot.chain_id = game.chain_id AND snapshot.entity_type = 'escalation'
				AND snapshot.entity_identity = lower(game.state->>'escalationGame') AND snapshot.canonical AND snapshot.read_status = 'success'
				AND snapshot.block_number <= ${asOfBlock}
			WHERE game.chain_id = ${chainId} AND game.pool_address = position.pool_address AND game.canonical AND game.block_number <= ${asOfBlock}
				AND game.event_name = 'EscalationGameSet'
			ORDER BY game.block_number DESC, game.log_index DESC, snapshot.block_number DESC, snapshot.observed_at DESC LIMIT 1
		) escalation ON true
		ORDER BY position.eth_in DESC, position.pair_address
		LIMIT 251
	`
}
