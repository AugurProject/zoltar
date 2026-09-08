import type { SQL } from 'bun'

export type RichListSort = 'eth' | 'weth' | 'transactions'

export const richListRows = async (
	sql: SQL,
	query: { readonly chainId?: number; readonly address?: string; readonly limit: number; readonly offset: number; readonly sort: RichListSort },
) => {
	const { chainId, address, limit, offset } = query
	const orderBy = {
		eth: 'native_balance DESC, transaction_count DESC',
		weth: 'weth_balance DESC, transaction_count DESC',
		transactions: 'transaction_count DESC, interaction_count DESC',
	}[query.sort]
	const values: Array<string | number> = []
	const chainClause = chainId === undefined ? '' : `AND activity.chain_id = $${values.push(chainId)}`
	const addressClause = address === undefined ? '' : `AND activity.address = $${values.push(address)}`
	values.push(limit, offset)
	return await sql.unsafe(
		`WITH activity_summary AS (
			SELECT activity.chain_id, activity.address, min(activity.block_number) AS first_seen_block,
				max(activity.block_number) AS last_seen_block,
				count(DISTINCT activity.tx_hash) FILTER (WHERE activity.role = 'sender') AS transaction_count,
				count(DISTINCT activity.tx_hash) AS interaction_count,
				count(DISTINCT NULLIF(activity.pool_address, '0x0000000000000000000000000000000000000000')) AS pool_count
			FROM address_activity activity WHERE activity.canonical ${chainClause} ${addressClause}
			GROUP BY activity.chain_id, activity.address
		), latest_balances AS (
			SELECT DISTINCT ON (snapshot.chain_id, snapshot.address, snapshot.asset_address)
				snapshot.chain_id, snapshot.address, snapshot.asset_address, snapshot.asset_kind, snapshot.balance,
				snapshot.block_number, snapshot.observed_at
			FROM address_balance_snapshots snapshot
			JOIN blocks observed_block ON observed_block.chain_id = snapshot.chain_id
				AND observed_block.hash = snapshot.block_hash AND observed_block.canonical
			JOIN networks observed_network ON observed_network.chain_id = snapshot.chain_id
			WHERE snapshot.canonical AND snapshot.block_number <= observed_network.indexed_block AND (
				snapshot.asset_kind = 'native' OR EXISTS (
					SELECT 1 FROM contracts asset
					WHERE asset.chain_id = snapshot.chain_id AND asset.address = snapshot.asset_address AND asset.canonical
						AND asset.kind IN ('reputationToken', 'weth')
				)
			)
			ORDER BY snapshot.chain_id, snapshot.address, snapshot.asset_address, snapshot.block_number DESC
		), balance_summary AS (
			SELECT chain_id, address,
				COALESCE(sum(balance) FILTER (WHERE asset_kind = 'weth'), 0) AS weth_balance,
				COALESCE(max(balance) FILTER (WHERE asset_kind = 'native'), 0) AS native_balance,
				count(*) FILTER (WHERE asset_kind = 'rep') AS sampled_rep_token_count,
				count(*) FILTER (WHERE asset_kind = 'weth') AS sampled_weth_token_count,
				count(*) FILTER (WHERE asset_kind = 'native') AS sampled_native_count,
				min(block_number) AS oldest_balance_block, max(observed_at) AS last_balance_refresh
			FROM latest_balances GROUP BY chain_id, address
		), asset_summary AS (
			SELECT chain_id,
				count(*) FILTER (WHERE kind = 'reputationToken') AS rep_token_count,
				count(*) FILTER (WHERE kind = 'weth') AS weth_token_count
			FROM contracts WHERE canonical GROUP BY chain_id
		), latest_token_metadata AS (
			SELECT DISTINCT ON (metadata.chain_id, metadata.address)
				metadata.chain_id, metadata.address, metadata.name, metadata.symbol, metadata.decimals
			FROM token_metadata metadata
			JOIN blocks observed_block ON observed_block.chain_id = metadata.chain_id
				AND observed_block.hash = metadata.block_hash AND observed_block.canonical
			JOIN networks observed_network ON observed_network.chain_id = metadata.chain_id
			WHERE metadata.canonical AND metadata.read_block <= observed_network.indexed_block
			ORDER BY metadata.chain_id, metadata.address, metadata.read_block DESC
		), latest_vaults AS (
			SELECT DISTINCT ON (chain_id, pool_address, vault_address) chain_id, pool_address, vault_address,
				rep_backing_units, capacity_ownership_atto_rep, claimable_fees_atto_eth, block_number
			FROM vault_snapshots WHERE canonical
			ORDER BY chain_id, pool_address, vault_address, block_number DESC, log_index DESC
		), vault_summary AS (
			SELECT chain_id, vault_address AS address, count(*) AS vault_count,
				count(*) FILTER (WHERE rep_backing_units > 0 OR capacity_ownership_atto_rep > 0 OR claimable_fees_atto_eth > 0) AS active_vault_count
			FROM latest_vaults GROUP BY chain_id, vault_address
		), ranked AS (
			SELECT activity.*, n.id AS network_id, n.explorer_base_url, c.label, c.kind,
				COALESCE(balance.weth_balance, 0) AS weth_balance,
				COALESCE(balance.native_balance, 0) AS native_balance,
				COALESCE(balance.sampled_rep_token_count, 0) AS sampled_rep_token_count,
				COALESCE(balance.sampled_weth_token_count, 0) AS sampled_weth_token_count,
				COALESCE(balance.sampled_native_count, 0) AS sampled_native_count,
				LEAST(COALESCE(balance.sampled_rep_token_count, 0), 100) AS returned_rep_token_count,
				LEAST(COALESCE(balance.sampled_weth_token_count, 0), 100) AS returned_weth_token_count,
				COALESCE(balance.sampled_rep_token_count, 0) > 100 AS rep_balances_truncated,
				COALESCE(balance.sampled_weth_token_count, 0) > 100 AS weth_balances_truncated,
				COALESCE(assets.rep_token_count, 0) AS rep_token_count,
				COALESCE(assets.weth_token_count, 0) AS weth_token_count,
				balance.oldest_balance_block, balance.last_balance_refresh,
				COALESCE(vault.vault_count, 0) AS vault_count, COALESCE(vault.active_vault_count, 0) AS active_vault_count
			FROM activity_summary activity
			JOIN networks n USING (chain_id)
			LEFT JOIN asset_summary assets USING (chain_id)
			LEFT JOIN balance_summary balance USING (chain_id, address)
			LEFT JOIN vault_summary vault USING (chain_id, address)
			LEFT JOIN contracts c ON c.chain_id = activity.chain_id AND c.address = activity.address AND c.canonical
		), page AS (
			SELECT *, row_number() OVER (ORDER BY ${orderBy}, chain_id, address) AS page_order FROM ranked
			ORDER BY ${orderBy}, chain_id, address
			LIMIT $${values.length - 1} OFFSET $${values.length}
		), totals AS (
			SELECT count(*) AS total FROM ranked
		), enriched AS (
			SELECT page.*,
				COALESCE((SELECT jsonb_agg(jsonb_build_object(
					'address', association.pool_address, 'label', pool_contract.label, 'questionTitle', question.title
				) ORDER BY association.pool_address)
				FROM (SELECT DISTINCT pool_activity.pool_address FROM address_activity pool_activity
					WHERE pool_activity.chain_id = page.chain_id AND pool_activity.address = page.address
						AND pool_activity.canonical AND pool_activity.pool_address <> '0x0000000000000000000000000000000000000000'
					ORDER BY pool_activity.pool_address LIMIT 100) association
				LEFT JOIN contracts pool_contract ON pool_contract.chain_id = page.chain_id
					AND pool_contract.address = association.pool_address AND pool_contract.canonical
				LEFT JOIN LATERAL (SELECT pool.question_id FROM pools pool
					WHERE pool.chain_id = page.chain_id AND pool.pool_address = association.pool_address AND pool.canonical
					ORDER BY pool.block_number DESC LIMIT 1) pool ON true
				LEFT JOIN questions question ON question.chain_id = page.chain_id AND question.question_id = pool.question_id AND question.canonical
			), '[]'::jsonb) AS pool_associations,
				COALESCE((SELECT jsonb_agg(jsonb_build_object(
					'poolAddress', position.pool_address, 'questionTitle', question.title,
					'repBackingUnits', position.rep_backing_units::text,
					'capacityOwnershipAttoRep', position.capacity_ownership_atto_rep::text,
					'claimableFeesAttoEth', position.claimable_fees_atto_eth::text,
					'blockNumber', position.block_number::text
				) ORDER BY position.pool_address)
				FROM (SELECT * FROM latest_vaults latest_position
					WHERE latest_position.chain_id = page.chain_id AND latest_position.vault_address = page.address
					ORDER BY latest_position.pool_address LIMIT 100) position
				LEFT JOIN LATERAL (SELECT pool.question_id FROM pools pool
					WHERE pool.chain_id = page.chain_id AND pool.pool_address = position.pool_address AND pool.canonical
					ORDER BY pool.block_number DESC LIMIT 1) pool ON true
				LEFT JOIN questions question ON question.chain_id = page.chain_id AND question.question_id = pool.question_id AND question.canonical
			), '[]'::jsonb) AS vault_positions,
				COALESCE((SELECT jsonb_agg(jsonb_build_object(
					'address', token.asset_address, 'balance', token.balance::text, 'blockNumber', token.block_number::text,
					'name', metadata.name, 'symbol', metadata.symbol, 'decimals', metadata.decimals,
					'contractLabel', token_contract.label, 'universeId', universe.universe_id::text
				) ORDER BY token.asset_address)
				FROM (SELECT * FROM latest_balances rep_token WHERE rep_token.chain_id = page.chain_id
					AND rep_token.address = page.address AND rep_token.asset_kind = 'rep' ORDER BY rep_token.asset_address LIMIT 100) token
				LEFT JOIN latest_token_metadata metadata ON metadata.chain_id = token.chain_id AND metadata.address = token.asset_address
				LEFT JOIN contracts token_contract ON token_contract.chain_id = token.chain_id
					AND token_contract.address = token.asset_address AND token_contract.canonical
				LEFT JOIN LATERAL (SELECT event.universe_id FROM universe_events event
					WHERE event.chain_id = token.chain_id AND event.reputation_token_address = token.asset_address AND event.canonical
					ORDER BY event.block_number DESC, event.log_index DESC LIMIT 1) universe ON true
			), '[]'::jsonb) AS rep_balances,
				COALESCE((SELECT jsonb_agg(jsonb_build_object(
					'address', token.asset_address, 'balance', token.balance::text, 'blockNumber', token.block_number::text,
					'name', metadata.name, 'symbol', metadata.symbol, 'decimals', metadata.decimals
				) ORDER BY token.balance DESC, token.asset_address)
				FROM (SELECT * FROM latest_balances weth_token WHERE weth_token.chain_id = page.chain_id
					AND weth_token.address = page.address AND weth_token.asset_kind = 'weth'
					ORDER BY weth_token.balance DESC, weth_token.asset_address LIMIT 100) token
				LEFT JOIN latest_token_metadata metadata ON metadata.chain_id = token.chain_id AND metadata.address = token.asset_address
			), '[]'::jsonb) AS weth_balances,
				(SELECT jsonb_build_object('balance', native.balance::text, 'blockNumber', native.block_number::text)
					FROM latest_balances native WHERE native.chain_id = page.chain_id AND native.address = page.address
						AND native.asset_kind = 'native' LIMIT 1) AS native_balance_detail,
				COALESCE((SELECT jsonb_agg(jsonb_build_object(
					'type', event.event_name, 'entity', event.game_address, 'data', event.event_data,
					'blockNumber', event.block_number::text, 'provenance', 'historical interaction'
				) ORDER BY event.block_number DESC, event.log_index DESC)
				FROM (SELECT * FROM escalation_game_events evidence WHERE evidence.chain_id = page.chain_id
					AND evidence.canonical AND lower(evidence.event_data->>'depositor') = page.address
					ORDER BY evidence.block_number DESC, evidence.log_index DESC LIMIT 100) event
			), '[]'::jsonb) AS escalation_claims,
				COALESCE((SELECT jsonb_agg(jsonb_build_object(
					'type', event.event_name, 'entity', event.auction_address, 'data', event.event_data,
					'blockNumber', event.block_number::text, 'provenance', 'historical interaction'
				) ORDER BY event.block_number DESC, event.log_index DESC)
				FROM (SELECT * FROM truth_auction_events evidence WHERE evidence.chain_id = page.chain_id
					AND evidence.canonical AND lower(evidence.event_data->>'bidder') = page.address
					ORDER BY evidence.block_number DESC, evidence.log_index DESC LIMIT 100) event
			), '[]'::jsonb) AS auction_claims
			FROM page
		)
		SELECT enriched.*, totals.total FROM totals LEFT JOIN enriched ON true ORDER BY enriched.page_order`,
		values,
	)
}

export const addressPortfolioRows = async (
	sql: SQL,
	query: {
		readonly chainId: number
		readonly address: string
		readonly snapshotBlock: string
		readonly limit: number
		readonly lpOffset: number
		readonly forkOffset: number
		readonly reportOffset: number
	},
) => {
	const { chainId, address, snapshotBlock, limit, lpOffset, forkOffset, reportOffset } = query
	const [lpRows, forkRows, reportRows] = await Promise.all([
		sql`
			WITH transfers AS (
				SELECT event.market_address, lower(event.event_data->>'from') AS from_address,
					lower(event.event_data->>'to') AS to_address, (event.event_data->>'amount')::numeric AS amount
				FROM amm_trade_events event
				WHERE event.chain_id = ${chainId} AND event.canonical AND event.block_number <= ${snapshotBlock}
					AND event.event_name = 'Transfer' AND event.event_data ? 'from'
					AND event.event_data ? 'to' AND event.event_data ? 'amount'
			), deltas AS (
				SELECT transfer.market_address, transfer.amount AS balance_delta FROM transfers transfer WHERE transfer.to_address = ${address}
				UNION ALL SELECT transfer.market_address, -transfer.amount FROM transfers transfer WHERE transfer.from_address = ${address}
			), balances AS (SELECT delta.market_address, sum(delta.balance_delta) AS balance FROM deltas delta GROUP BY delta.market_address),
			transfer_counts AS (SELECT transfer.market_address, count(*)::integer AS transfer_count FROM transfers transfer
				WHERE transfer.from_address = ${address} OR transfer.to_address = ${address} GROUP BY transfer.market_address),
			positions AS (
				SELECT balance.market_address, balance.balance, transfer_count.transfer_count, market.pool_address, question.title AS question_title
				FROM balances balance JOIN transfer_counts transfer_count USING (market_address)
				LEFT JOIN amm_markets market ON market.chain_id = ${chainId} AND market.pair_address = balance.market_address AND market.canonical
				LEFT JOIN pools pool ON pool.chain_id = market.chain_id AND pool.pool_address = market.pool_address AND pool.canonical
				LEFT JOIN questions question ON question.chain_id = pool.chain_id AND question.question_id = pool.question_id AND question.canonical
				WHERE balance.balance <> 0
			), totals AS (SELECT count(*)::integer AS total FROM positions)
			SELECT page.market_address, page.balance::text, page.transfer_count, page.pool_address, page.question_title, totals.total
			FROM totals LEFT JOIN LATERAL (SELECT * FROM positions ORDER BY balance DESC, market_address LIMIT ${limit} OFFSET ${lpOffset}) page ON true
		`,
		sql`
			WITH participation AS (SELECT universe_identity, event_name, event_data, block_number, block_hash, tx_hash, log_index
				FROM fork_migration_events event WHERE event.chain_id = ${chainId} AND event.canonical AND event.block_number <= ${snapshotBlock} AND (
					lower(event.event_data->>'migrator') = ${address} OR lower(event.event_data->>'vault') = ${address}
					OR lower(event.event_data->>'recipient') = ${address})), totals AS (SELECT count(*)::integer AS total FROM participation)
			SELECT page.universe_identity, page.event_name, page.event_data, page.block_number::text,
				page.block_hash, page.tx_hash, page.log_index, totals.total FROM totals LEFT JOIN LATERAL (
					SELECT * FROM participation ORDER BY block_number DESC, log_index DESC, tx_hash DESC, block_hash DESC, universe_identity
					LIMIT ${limit} OFFSET ${forkOffset}) page ON true
		`,
		sql`
			WITH participation AS (SELECT open_oracle_address, report_id, event_name, round_number, report_data,
				block_number, block_hash, tx_hash, log_index FROM open_oracle_report_events event
				WHERE event.chain_id = ${chainId} AND event.canonical AND event.block_number <= ${snapshotBlock}
					AND lower(event.report_data->>'currentReporter') = ${address}), totals AS (SELECT count(*)::integer AS total FROM participation)
			SELECT page.open_oracle_address, page.report_id::text, page.event_name, page.round_number::text,
				page.report_data, page.block_number::text, page.block_hash, page.tx_hash, page.log_index, totals.total
			FROM totals LEFT JOIN LATERAL (SELECT * FROM participation ORDER BY block_number DESC, log_index DESC, tx_hash DESC, block_hash DESC,
				open_oracle_address, report_id LIMIT ${limit} OFFSET ${reportOffset}) page ON true
		`,
	])
	return { lpRows, forkRows, reportRows }
}
