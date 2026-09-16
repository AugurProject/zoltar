import type { SQL } from 'bun'

type UnknownCallGroup = {
	readonly chain_id: string
	readonly destination: string
	readonly selector: string | null
	readonly decode_status: 'unknown' | 'failed'
	readonly transaction_count: string
	readonly first_block: string
	readonly last_block: string
	readonly sample_transaction: string
}

// Actions have no canonical flag: join the exact transaction occurrence so
// orphaned or superseded decodes do not appear as current coverage gaps.
export const unknownCallReport = async (sql: SQL, limit = 100) => {
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('Report limit must be an integer from 1 to 1000')
	return await sql<UnknownCallGroup[]>`
		SELECT t.chain_id::text, t.to_address AS destination,
			CASE WHEN length(t.input) >= 10 THEN left(lower(t.input), 10) END AS selector, a.decode_status,
			count(*)::text AS transaction_count,
			min(t.block_number)::text AS first_block,
			max(t.block_number)::text AS last_block,
			min(t.hash) AS sample_transaction
		FROM actions a
		JOIN transactions t ON t.chain_id = a.chain_id AND t.hash = a.tx_hash AND t.block_hash = a.block_hash
		WHERE t.canonical AND t.to_address IS NOT NULL AND t.input <> '0x'
			AND a.decode_status IN ('unknown', 'failed')
		GROUP BY t.chain_id, t.to_address, selector, a.decode_status
		ORDER BY count(*) DESC, t.chain_id, t.to_address, selector, a.decode_status
		LIMIT ${limit}
	`
}
