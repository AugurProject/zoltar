import type { SQL } from 'bun'

// Migration mints emit TransferSingle. Counting Migrate as another credit would
// double count the child balance; the source remains held but becomes locked.
export const sharePositions = async (sql: SQL, chainId: number, snapshotBlock: string, filter: { address?: string; market?: string }) => {
	const rows = await sql`
		WITH transfers AS (
			SELECT log.emitter_address AS token, lower(log.arguments->>'from') AS sender, lower(log.arguments->>'to') AS receiver,
				item.id::numeric AS id, item.amount::numeric AS amount
			FROM logs log
			JOIN blocks block ON block.chain_id = log.chain_id AND block.hash = log.block_hash AND block.canonical
			JOIN contracts contract ON contract.chain_id = log.chain_id AND contract.address = log.emitter_address AND contract.canonical AND contract.kind = 'shareToken'
			CROSS JOIN LATERAL (
				SELECT log.arguments->>'id' AS id, log.arguments->>'value' AS amount WHERE log.event_name = 'TransferSingle'
				UNION ALL
				SELECT ids.value #>> '{}', amounts.value #>> '{}'
				FROM jsonb_array_elements(CASE WHEN log.event_name = 'TransferBatch' THEN log.arguments->'ids' ELSE '[]'::jsonb END) WITH ORDINALITY ids(value, n)
				JOIN jsonb_array_elements(CASE WHEN log.event_name = 'TransferBatch' THEN log.arguments->'values' ELSE '[]'::jsonb END) WITH ORDINALITY amounts(value, n) USING (n)
			) item
			WHERE log.chain_id = ${chainId} AND log.canonical AND log.block_number <= ${snapshotBlock}
				AND log.event_name IN ('TransferSingle', 'TransferBatch')
		), deltas AS (
			SELECT token, receiver AS address, id, amount FROM transfers
			UNION ALL SELECT token, sender AS address, id, -amount FROM transfers
		), balances AS (
			SELECT token, address, trunc(id / 256) AS universe_id, mod(id, 256) AS outcome, sum(amount) AS balance
			FROM deltas WHERE address <> '0x0000000000000000000000000000000000000000'
				AND (${filter.address ?? null}::text IS NULL OR address = ${filter.address ?? null})
			GROUP BY token, address, id HAVING sum(amount) <> 0
		), positions AS (
			SELECT token, address, universe_id,
				COALESCE(sum(balance) FILTER (WHERE outcome = 0), 0) AS invalid,
				COALESCE(sum(balance) FILTER (WHERE outcome = 1), 0) AS yes,
				COALESCE(sum(balance) FILTER (WHERE outcome = 2), 0) AS no
			FROM balances GROUP BY token, address, universe_id
		)
		SELECT token, address, universe_id::text, invalid::text AS invalid_atto_shares, yes::text AS yes_atto_shares, no::text AS no_atto_shares,
			least(invalid, yes, no)::text AS complete_sets_atto_shares,
			EXISTS (SELECT 1 FROM logs migration WHERE migration.chain_id = ${chainId} AND migration.canonical
				AND migration.block_number <= ${snapshotBlock} AND migration.emitter_address = positions.token
				AND migration.event_name = 'Migrate' AND lower(migration.arguments->>'migrator') = positions.address
				AND trunc((migration.arguments->>'fromId')::numeric / 256) = positions.universe_id) AS migration_locked
		FROM positions WHERE ${filter.market ?? null}::text IS NULL OR EXISTS (
			SELECT 1 FROM amm_markets market WHERE market.chain_id = ${chainId} AND market.canonical AND market.block_number <= ${snapshotBlock}
				AND market.pair_address = ${filter.market ?? null} AND market.share_token_address = positions.token AND market.universe_id = positions.universe_id
		)
		ORDER BY token, universe_id, address LIMIT 251
	`
	return { items: rows.slice(0, 250), truncated: rows.length > 250, basis: 'Canonical indexed ERC-1155 transfers; incomplete deployment history can yield partial balances. Migrated source shares are locked, and complete-set inventory is not a redemption quote.' }
}

export const pendingAuctionRefunds = async (sql: SQL, chainId: number, snapshotBlock: string, address: string) =>
	await sql`
		SELECT auction_address, sum(CASE WHEN event_name = 'EthRefundCredited' THEN (event_data->>'amountAttoEth')::numeric ELSE -(event_data->>'amountAttoEth')::numeric END)::text AS pending_atto_eth
		FROM truth_auction_events WHERE chain_id = ${chainId} AND canonical AND block_number <= ${snapshotBlock}
			AND event_name IN ('EthRefundCredited', 'PendingEthRefundWithdrawn') AND lower(event_data->>'bidder') = ${address}
		GROUP BY auction_address ORDER BY auction_address LIMIT 251
	`

export const escalationPositions = async (sql: SQL, chainId: number, snapshotBlock: string, address: string) =>
	await sql`
		SELECT deposit.game_address, deposit.event_data->>'outcome' AS outcome,
			deposit.event_data->>'parentDepositIndex' AS deposit_index, deposit.event_data->>'attoRepAmount' AS principal_atto_rep,
			consumed.event_data->>'reason' AS consumption_reason, consumed.block_number::text AS consumed_block,
			snapshot.read_result->>'finalQuestionResolution' AS final_resolution,
			snapshot.block_number::text AS resolution_block
		FROM escalation_game_events deposit
		LEFT JOIN LATERAL (SELECT event_data, block_number FROM escalation_game_events event
			WHERE event.chain_id = deposit.chain_id AND event.canonical AND event.game_address = deposit.game_address
				AND event.block_number <= ${snapshotBlock} AND event.event_name = 'CarryDepositConsumed'
				AND event.event_data->>'outcome' = deposit.event_data->>'outcome'
				AND event.event_data->>'parentDepositIndex' = deposit.event_data->>'parentDepositIndex'
			ORDER BY event.block_number DESC, event.log_index DESC LIMIT 1) consumed ON true
		LEFT JOIN LATERAL (SELECT state.* FROM entity_state_snapshots state
			WHERE state.chain_id = deposit.chain_id AND state.canonical AND state.entity_type = 'escalation'
				AND state.entity_identity = deposit.game_address AND state.block_number <= ${snapshotBlock}
			ORDER BY state.block_number DESC, state.observed_at DESC LIMIT 1) snapshot ON true
		WHERE deposit.chain_id = ${chainId} AND deposit.canonical AND deposit.block_number <= ${snapshotBlock}
			AND deposit.event_name = 'LocalDepositAppended' AND lower(deposit.event_data->>'depositor') = ${address}
		ORDER BY deposit.game_address, deposit.block_number DESC, deposit.log_index DESC LIMIT 251
	`

export const escalationPayouts = async (sql: SQL, chainId: number, snapshotBlock: string, address: string) => {
	const rows = await sql`
  WITH latest AS (
   SELECT DISTINCT ON (entity_identity) entity_identity, block_number, block_hash, read_result
   FROM entity_state_snapshots WHERE chain_id = ${chainId} AND canonical AND entity_type = 'escalation' AND block_number <= ${snapshotBlock}
   ORDER BY entity_identity, block_number DESC, observed_at DESC
  ), positions AS (
   SELECT latest.entity_identity AS game_address, latest.block_number::text AS snapshot_block, latest.block_hash AS snapshot_block_hash, position
   FROM latest CROSS JOIN LATERAL jsonb_array_elements(COALESCE(read_result->'claimEvidence'->'positions', '[]'::jsonb)) position
   WHERE lower(position->>'depositor') = ${address} AND read_result->'claimEvidence'->>'status' = 'available'
   ORDER BY latest.entity_identity, position->>'outcome', position->>'deposit_index' LIMIT 251
  )
  SELECT COALESCE((SELECT jsonb_agg(to_jsonb(positions)) FROM positions), '[]'::jsonb) AS items,
   count(*) FILTER (WHERE read_result->'claimEvidence'->>'status' IS DISTINCT FROM 'available')::text AS unavailable_games,
   count(*) FILTER (WHERE read_result->'claimEvidence'->>'truncated' = 'true')::text AS truncated_games,
   count(*)::text AS sampled_games FROM latest
 `
	const row = rows[0]
	const items: Record<string, unknown>[] = row?.['items'] ?? []
	return { items: items.slice(0, 250), truncated: items.length > 250, unavailable_games: String(row?.['unavailable_games'] ?? '0'), truncated_games: String(row?.['truncated_games'] ?? '0'), sampled_games: String(row?.['sampled_games'] ?? '0') }
}
