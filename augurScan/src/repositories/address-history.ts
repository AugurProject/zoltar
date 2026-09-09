import type { SQL } from 'bun'

export type AddressHistoryQuery = {
	readonly chainId: number
	readonly address: string
	readonly snapshotBlock: string
	readonly limit: number
	readonly cursorBlock?: string
	readonly cursorIndex?: number
}

export const transactionHistoryAnchor = async (sql: SQL, chainId: number, address: string) =>
	await sql`SELECT transaction.block_number AS snapshot_block, transaction.block_hash AS snapshot_hash
		FROM transactions transaction
		JOIN blocks block ON block.chain_id = transaction.chain_id AND block.hash = transaction.block_hash AND block.canonical
		WHERE transaction.canonical AND transaction.chain_id = ${chainId} AND transaction.from_address = ${address}
		ORDER BY transaction.block_number DESC, transaction.transaction_index DESC LIMIT 1`

export const transactionHistorySnapshot = async (sql: SQL, chainId: number, address: string, snapshotBlock: string, snapshotHash: string) =>
	await sql`
		SELECT
			EXISTS (SELECT 1 FROM blocks WHERE chain_id = ${chainId} AND number = ${snapshotBlock} AND hash = ${snapshotHash} AND canonical) AS snapshot_canonical,
			(SELECT count(*) FROM transactions transaction
				JOIN blocks block ON block.chain_id = transaction.chain_id AND block.hash = transaction.block_hash AND block.canonical
				WHERE transaction.canonical AND transaction.chain_id = ${chainId} AND transaction.from_address = ${address}
					AND transaction.block_number <= ${snapshotBlock}) AS snapshot_total
	`

export const addressTransactionHistory = async (sql: SQL, query: AddressHistoryQuery) => {
	const values: Array<string | number> = [query.chainId, query.address, query.snapshotBlock]
	const cursorClause =
		query.cursorBlock === undefined || query.cursorIndex === undefined
			? ''
			: (() => {
					values.push(query.cursorBlock, query.cursorIndex)
					return `AND (t.block_number, t.transaction_index) < ($${values.length - 1}::bigint, $${values.length}::integer)`
				})()
	values.push(query.limit + 1)
	return await sql.unsafe(
		`WITH snapshot_transactions AS (
			SELECT t.*, count(*) OVER () AS snapshot_total
			FROM transactions t
			JOIN blocks canonical_block ON canonical_block.chain_id = t.chain_id AND canonical_block.hash = t.block_hash AND canonical_block.canonical
			WHERE t.canonical AND t.chain_id = $1 AND t.from_address = $2 AND t.block_number <= $3::bigint
		)
		SELECT t.chain_id, t.hash AS tx_hash, t.block_hash, t.block_number, t.transaction_index,
			t.from_address, t.to_address, t.value, t.status, t.gas_used, t.snapshot_total, b.timestamp AS block_timestamp,
			a.function_name, a.function_signature, a.arguments AS action_arguments,
			a.display_arguments AS action_display_arguments, a.argument_schema AS action_argument_schema,
			a.decode_status AS action_decode_status, a.summary AS action_summary,
			c.label AS to_label, c.kind AS to_kind, n.explorer_base_url
		FROM snapshot_transactions t
		JOIN blocks b ON b.chain_id = t.chain_id AND b.hash = t.block_hash AND b.canonical
		JOIN networks n ON n.chain_id = t.chain_id
		LEFT JOIN actions a ON a.chain_id = t.chain_id AND a.block_hash = t.block_hash AND a.tx_hash = t.hash
		LEFT JOIN contracts c ON c.chain_id = t.chain_id AND c.address = t.to_address AND c.canonical
		WHERE true ${cursorClause}
		ORDER BY t.block_number DESC, t.transaction_index DESC
		LIMIT $${values.length}`,
		values,
	)
}

export const interactionHistoryAnchor = async (sql: SQL, chainId: number, address: string) =>
	await sql`
		SELECT activity.block_number AS snapshot_block, activity.block_hash AS snapshot_hash
		FROM address_activity activity
		JOIN blocks block ON block.chain_id = activity.chain_id AND block.hash = activity.block_hash AND block.canonical
		JOIN transactions transaction ON transaction.chain_id = activity.chain_id AND transaction.block_hash = activity.block_hash
			AND transaction.hash = activity.tx_hash AND transaction.canonical
		WHERE activity.canonical AND activity.role = 'referenced' AND activity.chain_id = ${chainId} AND activity.address = ${address}
		ORDER BY activity.block_number DESC, transaction.transaction_index DESC LIMIT 1`

export const interactionHistorySnapshot = async (sql: SQL, chainId: number, address: string, snapshotBlock: string, snapshotHash: string) =>
	await sql`
		SELECT
			EXISTS (SELECT 1 FROM blocks WHERE chain_id = ${chainId} AND number = ${snapshotBlock} AND hash = ${snapshotHash} AND canonical) AS snapshot_canonical,
			(SELECT count(*) FROM (
				SELECT activity.block_hash, activity.tx_hash
				FROM address_activity activity
				JOIN blocks block ON block.chain_id = activity.chain_id AND block.hash = activity.block_hash AND block.canonical
				JOIN transactions transaction ON transaction.chain_id = activity.chain_id AND transaction.block_hash = activity.block_hash
					AND transaction.hash = activity.tx_hash AND transaction.canonical
				WHERE activity.canonical AND activity.role = 'referenced' AND activity.chain_id = ${chainId}
					AND activity.address = ${address} AND activity.block_number <= ${snapshotBlock}
				GROUP BY activity.block_hash, activity.tx_hash
			) interaction) AS snapshot_total
	`

export const addressInteractionHistory = async (sql: SQL, query: AddressHistoryQuery) => {
	const values: Array<string | number> = [query.chainId, query.address, query.snapshotBlock]
	const cursorClause =
		query.cursorBlock === undefined || query.cursorIndex === undefined
			? ''
			: (() => {
					values.push(query.cursorBlock, query.cursorIndex)
					return `WHERE (interaction.block_number, interaction.transaction_index) < ($${values.length - 1}::bigint, $${values.length}::integer)`
				})()
	values.push(query.limit + 1)
	return await sql.unsafe(
		`WITH interactions AS (
			SELECT activity.chain_id, activity.block_hash, activity.block_number, activity.tx_hash,
				transaction.transaction_index,
				array_agg(DISTINCT activity.role ORDER BY activity.role) AS roles,
				array_agg(DISTINCT activity.pool_address ORDER BY activity.pool_address)
					FILTER (WHERE activity.pool_address <> '0x0000000000000000000000000000000000000000') AS pool_addresses,
				count(*) OVER () AS snapshot_total
			FROM address_activity activity
			JOIN blocks block ON block.chain_id = activity.chain_id AND block.hash = activity.block_hash AND block.canonical
			JOIN transactions transaction ON transaction.chain_id = activity.chain_id AND transaction.block_hash = activity.block_hash
				AND transaction.hash = activity.tx_hash AND transaction.canonical
			WHERE activity.canonical AND activity.role = 'referenced' AND activity.chain_id = $1 AND activity.address = $2
				AND activity.block_number <= $3::bigint
			GROUP BY activity.chain_id, activity.block_hash, activity.block_number, activity.tx_hash, transaction.transaction_index
		)
		SELECT interaction.*, transaction.from_address, transaction.to_address,
			transaction.value, transaction.status, transaction.gas_used, block.timestamp AS block_timestamp,
			action.function_name, action.function_signature, action.arguments AS action_arguments,
			action.display_arguments AS action_display_arguments, action.argument_schema AS action_argument_schema,
			action.decode_status AS action_decode_status, action.summary AS action_summary,
			destination.label AS to_label, destination.kind AS to_kind, network.explorer_base_url
		FROM interactions interaction
		JOIN transactions transaction ON transaction.chain_id = interaction.chain_id
			AND transaction.block_hash = interaction.block_hash AND transaction.hash = interaction.tx_hash AND transaction.canonical
		JOIN blocks block ON block.chain_id = interaction.chain_id AND block.hash = interaction.block_hash AND block.canonical
		JOIN networks network ON network.chain_id = interaction.chain_id
		LEFT JOIN actions action ON action.chain_id = interaction.chain_id AND action.block_hash = interaction.block_hash AND action.tx_hash = interaction.tx_hash
		LEFT JOIN contracts destination ON destination.chain_id = interaction.chain_id AND destination.address = transaction.to_address AND destination.canonical
		${cursorClause}
		ORDER BY interaction.block_number DESC, interaction.transaction_index DESC
		LIMIT $${values.length}`,
		values,
	)
}

export const addressContractIdentity = async (sql: SQL, chainId: number, address: string) => await sql`SELECT label, kind, provenance FROM contracts WHERE canonical AND chain_id = ${chainId} AND address = ${address}`
