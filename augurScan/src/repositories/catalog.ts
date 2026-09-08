import type { SQL } from 'bun'
import type { JsonValue } from '../ethereum.ts'

export const networkCatalog = async (sql: SQL) =>
	await sql`SELECT chain_id, id, name, explorer_base_url, start_block, indexed_block, indexed_hash, indexed_timestamp, observed_block, finalized_block, phase, last_poll_at, last_success_at, failure_started_at, consecutive_failures, next_retry_at, last_reorg_at, last_reorg_depth, last_error, updated_at FROM networks ORDER BY chain_id`

export const contractCatalog = async (sql: SQL, chainId: number) =>
	await sql`
		SELECT contract.*, network.explorer_base_url
		FROM contracts contract
		JOIN networks network USING (chain_id)
		WHERE contract.chain_id = ${chainId} AND contract.canonical
		ORDER BY (contract.deployment_block IS NOT NULL) DESC, contract.label, contract.address
	`

export const contractDetail = async (sql: SQL, chainId: number, address: string) =>
	await sql`
		SELECT contract.*, network.explorer_base_url
		FROM contracts contract
		JOIN networks network USING (chain_id)
		WHERE contract.chain_id = ${chainId} AND contract.address = ${address} AND contract.canonical
	`

export const actionCatalog = async (sql: SQL, chainId: number, limit: number, cursor?: readonly JsonValue[]) => {
	const values: Array<string | number> = []
	const clauses = ['t.canonical', 'block.canonical']
	const bind = (value: string | number): string => {
		values.push(value)
		return `$${values.length}`
	}
	clauses.push(`a.chain_id = ${bind(chainId)}`)
	if (cursor !== undefined)
		clauses.push(
			`(block.timestamp, t.block_number, t.transaction_index, a.block_hash, a.tx_hash) < (${bind(String(cursor[8]))}::timestamptz, ${bind(String(cursor[9]))}::bigint, ${bind(Number(cursor[10]))}, ${bind(String(cursor[11]))}, ${bind(String(cursor[12]))})`,
		)
	values.push(limit + 1)
	return await sql.unsafe(
		`SELECT a.*, t.block_number, t.transaction_index, t.from_address, t.to_address, t.status, t.value,
			block.timestamp AS block_timestamp, n.id AS network_id
		FROM actions a
		JOIN transactions t ON t.chain_id = a.chain_id AND t.block_hash = a.block_hash AND t.hash = a.tx_hash
		JOIN blocks block ON block.chain_id = a.chain_id AND block.hash = a.block_hash
		JOIN networks n ON n.chain_id = a.chain_id
		WHERE ${clauses.join(' AND ')}
		ORDER BY block.timestamp DESC, a.chain_id DESC, t.block_number DESC, t.transaction_index DESC, a.block_hash DESC, a.tx_hash DESC
		LIMIT $${values.length}`,
		values,
	)
}
