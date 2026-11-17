import type { SQL } from 'bun'

/**
 * SQL text of the `{ address, symbol, decimals }` collateral token of an auction from its latest successful canonical
 * tagged read, or SQL NULL before a read samples it. An auction's collateral token is immutable, so a later failed read,
 * or a later successful read without the token, does not hide it. The arguments are trusted SQL fragments of the enclosing
 * query: `chainId` and `auctionAddress` are its column references or parameter placeholders, and `throughSnapshot` is an
 * `AND …` condition on `auction_snapshot.block_number`, or empty for the latest read. This is the single definition of
 * the rule, for both tagged and string-built queries.
 */
export const latestAuctionCollateralSql = (chainId: string, auctionAddress: string, throughSnapshot: string) => `(
	SELECT auction_snapshot.read_result->'collateral' FROM entity_state_snapshots auction_snapshot
	JOIN blocks auction_block ON auction_block.chain_id = auction_snapshot.chain_id AND auction_block.hash = auction_snapshot.block_hash AND auction_block.canonical
	WHERE auction_snapshot.chain_id = ${chainId} AND auction_snapshot.entity_type = 'auction' AND auction_snapshot.entity_identity = ${auctionAddress}
		AND auction_snapshot.canonical ${throughSnapshot} AND auction_snapshot.read_status = 'success'
		AND auction_snapshot.read_result->'collateral' IS NOT NULL
	ORDER BY auction_snapshot.block_number DESC, auction_snapshot.observed_at DESC LIMIT 1
)`

/**
 * {@link latestAuctionCollateralSql} at or below `snapshotBlock` as a tagged-query fragment. `auctionAddress` is a
 * parameter value or a column fragment of the enclosing query; the one-row scope carries the bound values into the rule.
 */
export const latestAuctionCollateral = (sql: SQL, chainId: number, snapshotBlock: string, auctionAddress: string | SQL.Query<unknown>) => sql`(
	SELECT ${sql.unsafe(latestAuctionCollateralSql('auction_scope.chain_id', 'auction_scope.auction_address', 'AND auction_snapshot.block_number <= auction_scope.snapshot_block'))}
	FROM (SELECT ${chainId}::bigint AS chain_id, ${auctionAddress}::text AS auction_address, ${snapshotBlock}::bigint AS snapshot_block) auction_scope
)`

/** The latest successfully sampled collateral token of one auction, or undefined before a read samples it. */
export const auctionCollateral = async (sql: SQL, chainId: number, snapshotBlock: string, auctionAddress: string): Promise<unknown> => {
	const rows = await sql`SELECT ${latestAuctionCollateral(sql, chainId, snapshotBlock, auctionAddress)} AS collateral`
	return rows[0]?.['collateral'] ?? undefined
}
