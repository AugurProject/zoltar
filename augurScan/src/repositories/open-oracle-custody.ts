import type { SQL } from 'bun'
import { zeroAddress } from '../ethereum.ts'
import type { AddressHistoryQuery } from './address-history.ts'

export const openOracleNativeCustody = async (sql: SQL, query: AddressHistoryQuery) => {
	const after = query.cursorBlock === undefined || query.cursorIndex === undefined ? sql`` : sql`WHERE (block_number, transaction_index) < (${query.cursorBlock}::bigint, ${query.cursorIndex}::integer)`
	return await sql<Record<string, unknown>[]>`
		WITH custody AS (
			SELECT t.hash AS tx_hash, t.block_number, t.block_hash, t.transaction_index, t.to_address AS oracle_address,
				a.function_name, a.arguments->>'amount' AS requested_wei, t.value::text AS tx_value,
				CASE WHEN a.function_name = 'deposit' THEN lower(a.arguments->>'beneficiary') ELSE t.from_address END AS owner_address,
				CASE WHEN a.function_name = 'withdrawTo' THEN lower(a.arguments->>'to') ELSE t.from_address END AS wallet_address,
				CASE WHEN t.receipt->>'callTraceStatus' = 'available' THEN t.receipt#>>'{callTrace,output}' END AS trace_output
			FROM transactions t
			JOIN blocks b ON b.chain_id = t.chain_id AND b.hash = t.block_hash AND b.canonical
			JOIN contracts c ON c.chain_id = t.chain_id AND c.address = t.to_address AND c.canonical AND c.kind = 'openOracle'
			JOIN actions a ON a.chain_id = t.chain_id AND a.block_hash = t.block_hash AND a.tx_hash = t.hash
			WHERE t.chain_id = ${query.chainId} AND t.canonical AND t.status = 'success' AND t.block_number <= ${query.snapshotBlock} AND a.decode_status = 'decoded'
				AND ((a.function_name = 'deposit' AND a.arguments->>'token' = ${zeroAddress})
					OR (a.function_name IN ('withdraw', 'withdrawTo') AND a.arguments->>'tokenToGet' = ${zeroAddress}))
		), matches AS (
			SELECT custody.*, count(*) OVER () AS snapshot_total FROM custody
			WHERE owner_address = ${query.address} OR wallet_address = ${query.address}
		)
		SELECT * FROM matches ${after}
		ORDER BY block_number DESC, transaction_index DESC LIMIT ${query.limit + 1}
	`
}
