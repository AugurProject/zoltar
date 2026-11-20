import type { SQL } from 'bun'

/** Prefix summaries are committed with their source block and invalidated with it on replay/reorg. */
export async function refreshHistoryAggregates(sql: SQL, chainId: number, blockHash: string, blockNumber: string): Promise<void> {
	await sql`INSERT INTO address_catalog (chain_id,address)
  SELECT DISTINCT chain_id,address FROM address_activity WHERE chain_id=${chainId} AND block_hash=${blockHash} AND canonical ON CONFLICT DO NOTHING`
	await sql`
  WITH deltas AS (
   SELECT activity.address,count(DISTINCT activity.tx_hash) FILTER (WHERE activity.role='sender') AS transactions,
    count(DISTINCT activity.tx_hash) AS interactions,
    count(DISTINCT activity.pool_address) FILTER (WHERE activity.pool_address <> '0x0000000000000000000000000000000000000000'
     AND NOT EXISTS (SELECT 1 FROM address_activity prior WHERE prior.chain_id=activity.chain_id AND prior.address=activity.address
      AND prior.pool_address=activity.pool_address AND prior.canonical AND prior.block_number < ${blockNumber})) AS pools
   FROM address_activity activity WHERE activity.chain_id=${chainId} AND activity.block_hash=${blockHash} AND activity.canonical
   GROUP BY activity.address
  )
  INSERT INTO address_activity_summaries (chain_id,address,block_hash,block_number,first_seen_block,transaction_count,interaction_count,pool_count,canonical)
  SELECT ${chainId},delta.address,${blockHash},${blockNumber},COALESCE(prior.first_seen_block,${blockNumber}::bigint),
   COALESCE(prior.transaction_count,0)+delta.transactions,COALESCE(prior.interaction_count,0)+delta.interactions,COALESCE(prior.pool_count,0)+delta.pools,true
  FROM deltas delta LEFT JOIN LATERAL (SELECT summary.* FROM address_activity_summaries summary
   WHERE summary.chain_id=${chainId} AND summary.address=delta.address AND summary.canonical AND summary.block_number < ${blockNumber}
   ORDER BY summary.block_number DESC LIMIT 1) prior ON true
  ON CONFLICT (chain_id,block_hash,address) DO UPDATE SET canonical=true,first_seen_block=EXCLUDED.first_seen_block,
   transaction_count=EXCLUDED.transaction_count,interaction_count=EXCLUDED.interaction_count,pool_count=EXCLUDED.pool_count`
	await sql`
  WITH entities AS (
   SELECT 'reports'::text AS domain,open_oracle_address||':'||report_id::text AS identity FROM open_oracle_report_events WHERE chain_id=${chainId} AND block_hash=${blockHash} AND canonical
   UNION SELECT 'escalations',game_address FROM escalation_game_events WHERE chain_id=${chainId} AND block_hash=${blockHash} AND canonical
   UNION SELECT 'auctions',auction_address FROM collateral_repair_auction_events WHERE chain_id=${chainId} AND block_hash=${blockHash} AND canonical
   UNION SELECT 'pools',pool_address FROM pools WHERE chain_id=${chainId} AND block_hash=${blockHash} AND canonical
   UNION SELECT 'markets',pair_address FROM amm_markets WHERE chain_id=${chainId} AND block_hash=${blockHash} AND canonical
  )
  INSERT INTO protocol_entity_identities (chain_id,domain,identity,block_hash,block_number,canonical)
  SELECT ${chainId},entity.domain,entity.identity,${blockHash},${blockNumber},true FROM entities entity
  WHERE NOT EXISTS (SELECT 1 FROM protocol_entity_identities known WHERE known.chain_id=${chainId} AND known.domain=entity.domain AND known.identity=entity.identity AND known.canonical)
  ON CONFLICT (chain_id,domain,identity,block_hash) DO UPDATE SET canonical=true`
	await sql`
  INSERT INTO protocol_entity_totals (chain_id,domain,block_hash,block_number,total,canonical)
  SELECT ${chainId},identity.domain,${blockHash},${blockNumber},COALESCE(prior.total,0)+count(*),true
  FROM protocol_entity_identities identity LEFT JOIN LATERAL (SELECT totals.total FROM protocol_entity_totals totals
   WHERE totals.chain_id=${chainId} AND totals.domain=identity.domain AND totals.canonical AND totals.block_number < ${blockNumber}
   ORDER BY totals.block_number DESC LIMIT 1) prior ON true
  WHERE identity.chain_id=${chainId} AND identity.block_hash=${blockHash} AND identity.canonical GROUP BY identity.domain,prior.total
  ON CONFLICT (chain_id,domain,block_hash) DO UPDATE SET canonical=true,total=EXCLUDED.total`
}
