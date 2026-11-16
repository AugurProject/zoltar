import type { SQL } from 'bun'

/**
 * The `{ address, symbol, decimals }` collateral token of an auction from its latest successful canonical tagged read at
 * or below `snapshotBlock`, or SQL NULL before a read samples it. An auction's collateral token is immutable, so a later
 * failed read does not hide it. `auctionAddress` is a parameter value or a column fragment of the enclosing query.
 */
export const latestAuctionCollateral = (sql: SQL, chainId: number, snapshotBlock: string, auctionAddress: string | SQL.Query<unknown>) => sql`(
	SELECT auction_snapshot.read_result->'collateral' FROM entity_state_snapshots auction_snapshot
	JOIN blocks auction_block ON auction_block.chain_id = auction_snapshot.chain_id AND auction_block.hash = auction_snapshot.block_hash AND auction_block.canonical
	WHERE auction_snapshot.chain_id = ${chainId} AND auction_snapshot.entity_type = 'auction' AND auction_snapshot.entity_identity = ${auctionAddress}
		AND auction_snapshot.canonical AND auction_snapshot.block_number <= ${snapshotBlock} AND auction_snapshot.read_status = 'success'
		AND auction_snapshot.read_result->'collateral' IS NOT NULL
	ORDER BY auction_snapshot.block_number DESC, auction_snapshot.observed_at DESC LIMIT 1
)`

/** The latest successfully sampled collateral token of one auction, or undefined before a read samples it. */
export const auctionCollateral = async (sql: SQL, chainId: number, snapshotBlock: string, auctionAddress: string): Promise<unknown> => {
	const rows = await sql`SELECT ${latestAuctionCollateral(sql, chainId, snapshotBlock, auctionAddress)} AS collateral`
	return rows[0]?.['collateral'] ?? undefined
}
