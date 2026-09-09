import type { SQL } from 'bun'

export type TimelineFilters = {
	readonly chainId: number
	readonly entityType?: string
	readonly event?: string
	readonly address?: string
	readonly query?: string
	readonly fromBlock: string
	readonly toBlock: string
	readonly canonical: 'canonical' | 'orphaned' | 'all'
	readonly asOfBlock: string
	readonly cursor: {
		readonly block: string
		readonly log: number
		readonly tx: string
		readonly blockHash: string
		readonly entityType: string
		readonly identity: string
	}
	readonly limit: number
}

export const timelineCatalogRows = async (sql: SQL, filters: TimelineFilters) => {
	const { chainId, entityType, event, address, query, fromBlock, toBlock, canonical, asOfBlock, cursor, limit } = filters
	const [rows, totalRows] = await Promise.all([
		sql`
			SELECT timeline.*, block.timestamp AS block_timestamp,
				CASE WHEN timeline.canonical THEN 'canonical'
					WHEN invalidation.reason = 'chain-reorg' THEN 'chain-orphaned'
					WHEN invalidation.reason = 'manifest-reset' THEN 'manifest-superseded'
					WHEN invalidation.reason = 'start-boundary-advanced' THEN 'coverage-reset'
					WHEN invalidation.reason = 'abi-redecode' THEN 'decode-superseded'
					WHEN invalidation.reason = 'projection-rebuild' THEN 'projection-superseded'
					ELSE 'noncanonical-unknown' END AS evidence_status,
				invalidation.id::text AS invalidation_id, invalidation.reason AS invalidation_reason,
				invalidation.causes AS invalidation_causes, invalidation.detected_at AS invalidated_at
			FROM protocol_timeline_entries timeline
			JOIN blocks block ON block.chain_id = timeline.chain_id AND block.hash = timeline.block_hash
			LEFT JOIN LATERAL (
				SELECT replacement.id, replacement.reason,
					COALESCE((SELECT jsonb_agg(cause.reason ORDER BY cause.reason) FROM history_invalidation_causes cause
						WHERE cause.invalidation_id = replacement.id), jsonb_build_array(replacement.reason)) AS causes,
					replacement.detected_at
				FROM history_invalidation_occurrences occurrence
				JOIN chain_reorganizations replacement ON replacement.id = occurrence.invalidation_id
				WHERE occurrence.occurrence_kind = 'log' AND occurrence.chain_id = timeline.chain_id
					AND occurrence.block_hash = timeline.block_hash AND occurrence.occurrence_id = timeline.tx_hash
					AND occurrence.sub_index = timeline.log_index
				ORDER BY replacement.id DESC LIMIT 1
			) invalidation ON true
			WHERE timeline.chain_id = ${chainId} AND timeline.block_number BETWEEN ${fromBlock} AND ${toBlock}
				AND timeline.block_number <= ${asOfBlock}
				AND (${canonical === 'all'} OR timeline.canonical = ${canonical === 'canonical'})
				AND (${entityType ?? null}::text IS NULL OR timeline.entity_type = ${entityType ?? null})
				AND (${event ?? null}::text IS NULL OR timeline.semantic_event_kind = ${event ?? null})
				AND (${address ?? null}::text IS NULL OR timeline.source_contract = ${address ?? null}
					OR timeline.related_entities ? ${address ?? ''} OR timeline.summary_data::text ILIKE ${address === undefined ? '' : `%${address}%`})
				AND (${query ?? null}::text IS NULL OR timeline.entity_identity ILIKE ${query === undefined ? '' : `%${query}%`}
					OR timeline.semantic_event_kind ILIKE ${query === undefined ? '' : `%${query}%`}
					OR timeline.source_contract ILIKE ${query === undefined ? '' : `%${query}%`}
					OR timeline.summary_data::text ILIKE ${query === undefined ? '' : `%${query}%`})
				AND (timeline.block_number, timeline.log_index, timeline.tx_hash, timeline.block_hash, timeline.entity_type, timeline.entity_identity) <
					(${cursor.block}::bigint, ${cursor.log}::integer, ${cursor.tx}, ${cursor.blockHash}, ${cursor.entityType}, ${cursor.identity})
			ORDER BY timeline.block_number DESC, timeline.log_index DESC, timeline.tx_hash DESC,
				timeline.block_hash DESC, timeline.entity_type DESC, timeline.entity_identity DESC
			LIMIT ${limit + 1}
		`,
		sql`
			SELECT count(*)::text AS total FROM protocol_timeline_entries timeline
			WHERE timeline.chain_id = ${chainId} AND timeline.block_number BETWEEN ${fromBlock} AND ${toBlock}
				AND timeline.block_number <= ${asOfBlock}
				AND (${canonical === 'all'} OR timeline.canonical = ${canonical === 'canonical'})
				AND (${entityType ?? null}::text IS NULL OR timeline.entity_type = ${entityType ?? null})
				AND (${event ?? null}::text IS NULL OR timeline.semantic_event_kind = ${event ?? null})
				AND (${address ?? null}::text IS NULL OR timeline.source_contract = ${address ?? null}
					OR timeline.related_entities ? ${address ?? ''} OR timeline.summary_data::text ILIKE ${address === undefined ? '' : `%${address}%`})
				AND (${query ?? null}::text IS NULL OR timeline.entity_identity ILIKE ${query === undefined ? '' : `%${query}%`}
					OR timeline.semantic_event_kind ILIKE ${query === undefined ? '' : `%${query}%`}
					OR timeline.source_contract ILIKE ${query === undefined ? '' : `%${query}%`}
					OR timeline.summary_data::text ILIKE ${query === undefined ? '' : `%${query}%`})
		`,
	])
	return { rows, totalRows }
}

export const timelineRows = async (
	sql: SQL,
	query: {
		readonly chainId: number
		readonly entityType: string
		readonly entityIdentity: string
		readonly cursorBlock: string
		readonly cursorLog: number
		readonly cursorTx: string
		readonly limit: number
	},
) =>
	await sql`
		SELECT timeline.*, block.timestamp AS block_timestamp FROM protocol_timeline_entries timeline
		JOIN blocks block ON block.chain_id = timeline.chain_id AND block.hash = timeline.block_hash
		WHERE timeline.chain_id = ${query.chainId} AND timeline.entity_type = ${query.entityType}
			AND timeline.entity_identity = ${query.entityIdentity} AND timeline.canonical
			AND (timeline.block_number, timeline.log_index, timeline.tx_hash) < (${query.cursorBlock}::bigint, ${query.cursorLog}::integer, ${query.cursorTx})
		ORDER BY timeline.block_number DESC, timeline.log_index DESC, timeline.tx_hash DESC LIMIT ${query.limit}
	`

export const stateCatalogRows = async (sql: SQL, chainId: number | undefined, queryLimit: number) => {
	const totals =
		chainId === undefined
			? await sql`SELECT
				(SELECT count(DISTINCT (chain_id, pool_address)) FROM pools WHERE canonical)::integer AS pools,
				(SELECT count(DISTINCT (chain_id, question_id)) FROM questions WHERE canonical)::integer AS questions,
				(SELECT count(DISTINCT (chain_id, pool_address, vault_address)) FROM vault_snapshots WHERE canonical)::integer AS vaults,
				(SELECT count(DISTINCT (chain_id, universe_id)) FROM universe_events WHERE canonical)::integer AS universes`
			: await sql`SELECT
				(SELECT count(DISTINCT pool_address) FROM pools WHERE chain_id = ${chainId} AND canonical)::integer AS pools,
				(SELECT count(DISTINCT question_id) FROM questions WHERE chain_id = ${chainId} AND canonical)::integer AS questions,
				(SELECT count(DISTINCT (pool_address, vault_address)) FROM vault_snapshots WHERE chain_id = ${chainId} AND canonical)::integer AS vaults,
				(SELECT count(DISTINCT universe_id) FROM universe_events WHERE chain_id = ${chainId} AND canonical)::integer AS universes`
	const questions =
		chainId === undefined
			? await sql`SELECT q.*, n.id AS network_id,
				(SELECT count(*) FROM pools p WHERE p.chain_id = q.chain_id AND p.question_id = q.question_id AND p.canonical) AS pool_count,
				(SELECT count(*) FROM universe_events u WHERE u.chain_id = q.chain_id AND u.fork_question_id = q.question_id AND u.event_name = 'UniverseForked' AND u.canonical) AS fork_count
				FROM questions q JOIN networks n USING (chain_id) WHERE q.canonical ORDER BY q.created_timestamp DESC LIMIT ${queryLimit}`
			: await sql`SELECT q.*, n.id AS network_id,
				(SELECT count(*) FROM pools p WHERE p.chain_id = q.chain_id AND p.question_id = q.question_id AND p.canonical) AS pool_count,
				(SELECT count(*) FROM universe_events u WHERE u.chain_id = q.chain_id AND u.fork_question_id = q.question_id AND u.event_name = 'UniverseForked' AND u.canonical) AS fork_count
				FROM questions q JOIN networks n USING (chain_id) WHERE q.canonical AND q.chain_id = ${chainId} ORDER BY q.created_timestamp DESC LIMIT ${queryLimit}`
	const pools =
		chainId === undefined
			? await sql`SELECT p.*, n.id AS network_id, q.title AS question_title,
				ps.settlement_collateral_atto_eth, ps.total_capacity_ownership_atto_rep, ps.fee_eligible_capacity_ownership_atto_rep, ps.total_claimable_vault_fees_atto_eth, ps.unallocated_accrued_fees_atto_eth, ps.current_retention_rate, ps.block_number AS snapshot_block,
				(SELECT count(DISTINCT v.vault_address) FROM vault_snapshots v WHERE v.chain_id = p.chain_id AND v.pool_address = p.pool_address AND v.canonical) AS vault_count,
				(SELECT count(*) FROM pools child WHERE child.chain_id = p.chain_id AND child.parent_address = p.pool_address AND child.canonical) AS child_count
				FROM pools p JOIN networks n USING (chain_id)
				LEFT JOIN questions q ON q.chain_id = p.chain_id AND q.question_id = p.question_id AND q.canonical
				LEFT JOIN LATERAL (SELECT * FROM pool_snapshots snapshot WHERE snapshot.chain_id = p.chain_id AND snapshot.pool_address = p.pool_address AND snapshot.canonical ORDER BY snapshot.block_number DESC, snapshot.log_index DESC LIMIT 1) ps ON true
				WHERE p.canonical ORDER BY p.block_number DESC LIMIT ${queryLimit}`
			: await sql`SELECT p.*, n.id AS network_id, q.title AS question_title,
				ps.settlement_collateral_atto_eth, ps.total_capacity_ownership_atto_rep, ps.fee_eligible_capacity_ownership_atto_rep, ps.total_claimable_vault_fees_atto_eth, ps.unallocated_accrued_fees_atto_eth, ps.current_retention_rate, ps.block_number AS snapshot_block,
				(SELECT count(DISTINCT v.vault_address) FROM vault_snapshots v WHERE v.chain_id = p.chain_id AND v.pool_address = p.pool_address AND v.canonical) AS vault_count,
				(SELECT count(*) FROM pools child WHERE child.chain_id = p.chain_id AND child.parent_address = p.pool_address AND child.canonical) AS child_count
				FROM pools p JOIN networks n USING (chain_id)
				LEFT JOIN questions q ON q.chain_id = p.chain_id AND q.question_id = p.question_id AND q.canonical
				LEFT JOIN LATERAL (SELECT * FROM pool_snapshots snapshot WHERE snapshot.chain_id = p.chain_id AND snapshot.pool_address = p.pool_address AND snapshot.canonical ORDER BY snapshot.block_number DESC, snapshot.log_index DESC LIMIT 1) ps ON true
				WHERE p.canonical AND p.chain_id = ${chainId} ORDER BY p.block_number DESC LIMIT ${queryLimit}`
	const vaults =
		chainId === undefined
			? await sql`SELECT DISTINCT ON (v.chain_id, v.pool_address, v.vault_address) v.*, n.id AS network_id, q.title AS question_title
				FROM vault_snapshots v JOIN networks n USING (chain_id) LEFT JOIN pools p ON p.chain_id = v.chain_id AND p.pool_address = v.pool_address AND p.canonical LEFT JOIN questions q ON q.chain_id = p.chain_id AND q.question_id = p.question_id AND q.canonical
				WHERE v.canonical ORDER BY v.chain_id, v.pool_address, v.vault_address, v.block_number DESC, v.log_index DESC LIMIT ${queryLimit}`
			: await sql`SELECT DISTINCT ON (v.chain_id, v.pool_address, v.vault_address) v.*, n.id AS network_id, q.title AS question_title
				FROM vault_snapshots v JOIN networks n USING (chain_id) LEFT JOIN pools p ON p.chain_id = v.chain_id AND p.pool_address = v.pool_address AND p.canonical LEFT JOIN questions q ON q.chain_id = p.chain_id AND q.question_id = p.question_id AND q.canonical
				WHERE v.canonical AND v.chain_id = ${chainId} ORDER BY v.chain_id, v.pool_address, v.vault_address, v.block_number DESC, v.log_index DESC LIMIT ${queryLimit}`
	const universes =
		chainId === undefined
			? await sql`WITH identity AS (
				SELECT DISTINCT ON (chain_id, universe_id) * FROM universe_events WHERE canonical AND event_name IN ('UniverseInitialized', 'DeployChild') ORDER BY chain_id, universe_id, block_number, log_index
			), latest_supply AS (
				SELECT DISTINCT ON (chain_id, universe_id) chain_id, universe_id, theoretical_supply_atto_rep, block_number AS supply_block FROM universe_events WHERE canonical AND theoretical_supply_atto_rep IS NOT NULL ORDER BY chain_id, universe_id, block_number DESC, log_index DESC
			), fork AS (
				SELECT DISTINCT ON (chain_id, universe_id) chain_id, universe_id, fork_question_id, fork_time, forker_address, fork_threshold_atto_rep, migration_rep_balance_atto_rep FROM universe_events WHERE canonical AND event_name = 'UniverseForked' ORDER BY chain_id, universe_id, block_number DESC, log_index DESC
			) SELECT i.*, n.id AS network_id, s.theoretical_supply_atto_rep, s.supply_block, f.fork_question_id AS active_fork_question_id, f.fork_time AS active_fork_time, f.forker_address, f.fork_threshold_atto_rep, f.migration_rep_balance_atto_rep,
				(SELECT count(*) FROM identity child WHERE child.chain_id = i.chain_id AND child.parent_universe_id = i.universe_id AND child.universe_id <> i.universe_id) AS child_count,
				(SELECT count(*) FROM pools p WHERE p.chain_id = i.chain_id AND p.universe_id = i.universe_id AND p.canonical) AS pool_count
				FROM identity i JOIN networks n USING (chain_id) LEFT JOIN latest_supply s USING (chain_id, universe_id) LEFT JOIN fork f USING (chain_id, universe_id) ORDER BY i.chain_id, i.block_number LIMIT ${queryLimit}`
			: await sql`WITH identity AS (
				SELECT DISTINCT ON (chain_id, universe_id) * FROM universe_events WHERE canonical AND event_name IN ('UniverseInitialized', 'DeployChild') AND chain_id = ${chainId} ORDER BY chain_id, universe_id, block_number, log_index
			), latest_supply AS (
				SELECT DISTINCT ON (chain_id, universe_id) chain_id, universe_id, theoretical_supply_atto_rep, block_number AS supply_block FROM universe_events WHERE canonical AND theoretical_supply_atto_rep IS NOT NULL AND chain_id = ${chainId} ORDER BY chain_id, universe_id, block_number DESC, log_index DESC
			), fork AS (
				SELECT DISTINCT ON (chain_id, universe_id) chain_id, universe_id, fork_question_id, fork_time, forker_address, fork_threshold_atto_rep, migration_rep_balance_atto_rep FROM universe_events WHERE canonical AND event_name = 'UniverseForked' AND chain_id = ${chainId} ORDER BY chain_id, universe_id, block_number DESC, log_index DESC
			) SELECT i.*, n.id AS network_id, s.theoretical_supply_atto_rep, s.supply_block, f.fork_question_id AS active_fork_question_id, f.fork_time AS active_fork_time, f.forker_address, f.fork_threshold_atto_rep, f.migration_rep_balance_atto_rep,
				(SELECT count(*) FROM identity child WHERE child.chain_id = i.chain_id AND child.parent_universe_id = i.universe_id AND child.universe_id <> i.universe_id) AS child_count,
				(SELECT count(*) FROM pools p WHERE p.chain_id = i.chain_id AND p.universe_id = i.universe_id AND p.canonical) AS pool_count
				FROM identity i JOIN networks n USING (chain_id) LEFT JOIN latest_supply s USING (chain_id, universe_id) LEFT JOIN fork f USING (chain_id, universe_id) ORDER BY i.chain_id, i.block_number LIMIT ${queryLimit}`
	const poolStates =
		chainId === undefined
			? await sql`SELECT DISTINCT ON (chain_id, pool_address, event_name) chain_id, pool_address, event_name, state, block_number, log_index FROM pool_state_events WHERE canonical ORDER BY chain_id, pool_address, event_name, block_number DESC, log_index DESC LIMIT ${queryLimit}`
			: await sql`SELECT DISTINCT ON (chain_id, pool_address, event_name) chain_id, pool_address, event_name, state, block_number, log_index FROM pool_state_events WHERE canonical AND chain_id = ${chainId} ORDER BY chain_id, pool_address, event_name, block_number DESC, log_index DESC LIMIT ${queryLimit}`
	return { totals, questions, pools, vaults, universes, poolStates }
}
