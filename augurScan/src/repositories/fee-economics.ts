import type { SQL } from 'bun'

// Accrual checkpoints increase the unallocated reserve by credited fees. Other
// reasons redistribute or pay that reserve and must not be counted as revenue.
export const protocolFeeEconomics = async (sql: SQL, chainId: number, snapshotBlock: string) => {
	const rows = await sql`
		WITH checkpoints AS (
			SELECT pool_address, reason, unallocated_accrued_fees_atto_eth,
				lag(unallocated_accrued_fees_atto_eth) OVER (PARTITION BY pool_address ORDER BY block_number, log_index) AS previous
			FROM pool_snapshots WHERE chain_id = ${chainId} AND canonical AND block_number <= ${snapshotBlock}
		)
		SELECT sum(unallocated_accrued_fees_atto_eth - previous) FILTER (WHERE reason = 0 AND previous IS NOT NULL)::text AS accrued_atto_eth,
			count(*) FILTER (WHERE reason = 0 AND previous IS NULL)::text AS missing_baselines,
			count(DISTINCT pool_address)::text AS pools FROM checkpoints
	`
	return rows[0]
}
