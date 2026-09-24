import type { SQL } from 'bun'

type Kind = 'pools' | 'questions' | 'vaults' | 'universes'

export const selectedPoolStateRows = async (sql: SQL, chainId: number, poolAddress: string) =>
	await sql`SELECT DISTINCT ON (chain_id, pool_address, event_name) chain_id, pool_address, event_name, state, block_number, log_index FROM pool_state_events WHERE canonical AND chain_id = ${chainId} AND pool_address = ${poolAddress.toLowerCase()} ORDER BY chain_id, pool_address, event_name, block_number DESC, log_index DESC`

export const selectedStateEntity = async (sql: SQL, chainId: number, kind: Kind, identity: string): Promise<Record<string, unknown> | undefined> => {
	if (kind === 'pools') {
		const rows =
			await sql`SELECT p.*, n.id AS network_id, q.title AS question_title, ps.settlement_collateral_atto_eth, ps.total_capacity_ownership_atto_rep, ps.fee_eligible_capacity_ownership_atto_rep, ps.total_claimable_vault_fees_atto_eth, ps.unallocated_accrued_fees_atto_eth, ps.current_retention_rate, ps.block_number AS snapshot_block, (SELECT count(DISTINCT v.vault_address) FROM vault_snapshots v WHERE v.chain_id = p.chain_id AND v.pool_address = p.pool_address AND v.canonical) AS vault_count, (SELECT count(*) FROM pools child WHERE child.chain_id = p.chain_id AND child.parent_address = p.pool_address AND child.canonical) AS child_count FROM pools p JOIN networks n USING (chain_id) LEFT JOIN questions q ON q.chain_id = p.chain_id AND q.question_id = p.question_id AND q.canonical LEFT JOIN LATERAL (SELECT * FROM pool_snapshots snapshot WHERE snapshot.chain_id = p.chain_id AND snapshot.pool_address = p.pool_address AND snapshot.canonical ORDER BY snapshot.block_number DESC, snapshot.log_index DESC LIMIT 1) ps ON true WHERE p.chain_id = ${chainId} AND p.pool_address = ${identity.toLowerCase()} AND p.canonical LIMIT 1`
		return rows[0]
	}
	if (kind === 'questions') {
		const rows =
			await sql`SELECT q.*, n.id AS network_id, (SELECT count(*) FROM pools p WHERE p.chain_id = q.chain_id AND p.question_id = q.question_id AND p.canonical) AS pool_count, (SELECT count(*) FROM universe_events u WHERE u.chain_id = q.chain_id AND u.fork_question_id = q.question_id AND u.event_name = 'UniverseForked' AND u.canonical) AS fork_count FROM questions q JOIN networks n USING (chain_id) WHERE q.chain_id = ${chainId} AND q.question_id = ${identity}::numeric AND q.canonical LIMIT 1`
		return rows[0]
	}
	if (kind === 'vaults') {
		const parts = identity.split(':')
		const rows =
			await sql`SELECT v.*, n.id AS network_id, q.title AS question_title FROM vault_snapshots v JOIN networks n USING (chain_id) LEFT JOIN pools p ON p.chain_id = v.chain_id AND p.pool_address = v.pool_address AND p.canonical LEFT JOIN questions q ON q.chain_id = p.chain_id AND q.question_id = p.question_id AND q.canonical WHERE v.chain_id = ${chainId} AND v.pool_address = ${parts[0]?.toLowerCase()} AND v.vault_address = ${parts[1]?.toLowerCase()} AND v.canonical ORDER BY v.block_number DESC, v.log_index DESC LIMIT 1`
		return rows[0]
	}
	const rows =
		await sql`WITH identity AS (SELECT DISTINCT ON (chain_id, universe_id) * FROM universe_events WHERE canonical AND event_name IN ('UniverseInitialized', 'DeployChild') AND chain_id = ${chainId} AND universe_id = ${identity}::numeric ORDER BY chain_id, universe_id, block_number, log_index), latest_supply AS (SELECT DISTINCT ON (chain_id, universe_id) chain_id, universe_id, theoretical_supply_atto_rep FROM universe_events WHERE canonical AND chain_id = ${chainId} AND universe_id = ${identity}::numeric AND theoretical_supply_atto_rep IS NOT NULL ORDER BY chain_id, universe_id, block_number DESC, log_index DESC), fork AS (SELECT DISTINCT ON (chain_id, universe_id) chain_id, universe_id, fork_question_id, fork_time, forker_address, fork_threshold_atto_rep, migration_rep_balance_atto_rep FROM universe_events WHERE canonical AND chain_id = ${chainId} AND universe_id = ${identity}::numeric AND event_name = 'UniverseForked' ORDER BY chain_id, universe_id, block_number DESC, log_index DESC) SELECT i.*, n.id AS network_id, s.theoretical_supply_atto_rep, f.fork_question_id AS active_fork_question_id, f.fork_time AS active_fork_time, f.forker_address, f.fork_threshold_atto_rep, f.migration_rep_balance_atto_rep, (SELECT count(DISTINCT child.universe_id) FROM universe_events child WHERE child.chain_id = i.chain_id AND child.parent_universe_id = i.universe_id AND child.universe_id <> i.universe_id AND child.canonical) AS child_count, (SELECT count(*) FROM pools p WHERE p.chain_id = i.chain_id AND p.universe_id = i.universe_id AND p.canonical) AS pool_count FROM identity i JOIN networks n USING (chain_id) LEFT JOIN latest_supply s USING (chain_id, universe_id) LEFT JOIN fork f USING (chain_id, universe_id) LIMIT 1`
	return rows[0]
}
