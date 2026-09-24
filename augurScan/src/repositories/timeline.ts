import type { SQL } from 'bun'
import { literalContainsPattern } from './like-pattern.ts'

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

export const stateCatalogRows = async (sql: SQL, chainId: number | undefined, queryLimit: number, offset = 0, query?: string) => {
	const search = query === undefined ? undefined : literalContainsPattern(query)
	const versionRows = await sql`
		WITH catalog_identity AS (
			SELECT 'question'::text AS kind, q.chain_id::text AS chain_id, q.question_id::text AS identity, q.created_timestamp::text AS position, q.title::text AS detail
			FROM questions q WHERE q.canonical AND (${chainId ?? null}::bigint IS NULL OR q.chain_id = ${chainId ?? null}::bigint)
			UNION ALL
			SELECT 'pool', p.chain_id::text, p.pool_address::text, p.block_number::text, p.question_id::text
			FROM pools p WHERE p.canonical AND (${chainId ?? null}::bigint IS NULL OR p.chain_id = ${chainId ?? null}::bigint)
			UNION ALL
			SELECT 'vault', v.chain_id::text, v.pool_address::text || ':' || v.vault_address::text, ''::text, ''::text
			FROM (SELECT DISTINCT chain_id, pool_address, vault_address FROM vault_snapshots WHERE canonical AND (${chainId ?? null}::bigint IS NULL OR chain_id = ${chainId ?? null}::bigint)) v
			UNION ALL
			SELECT 'universe', u.chain_id::text, u.universe_id::text, u.block_number::text, u.parent_universe_id::text
			FROM (
				SELECT DISTINCT ON (chain_id, universe_id) chain_id, universe_id, block_number, parent_universe_id
				FROM universe_events WHERE canonical AND event_name IN ('UniverseInitialized', 'DeployChild') AND (${chainId ?? null}::bigint IS NULL OR chain_id = ${chainId ?? null}::bigint)
				ORDER BY chain_id, universe_id, block_number, log_index
			) u
		)
		SELECT md5(COALESCE(string_agg(jsonb_build_array(kind, chain_id, identity, position, detail)::text, ',' ORDER BY kind, chain_id, identity, position, detail), '')) AS catalog_version
		FROM catalog_identity
	`
	const catalogVersion = versionRows[0]?.['catalog_version']
	if (typeof catalogVersion !== 'string') throw new Error('State catalog version is unavailable')
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
			? await sql`SELECT q.*, q.start_time::text AS start_time, q.end_time::text AS end_time, n.id AS network_id,
				(SELECT count(*) FROM pools p WHERE p.chain_id = q.chain_id AND p.question_id = q.question_id AND p.canonical) AS pool_count,
				(SELECT count(*) FROM universe_events u WHERE u.chain_id = q.chain_id AND u.fork_question_id = q.question_id AND u.event_name = 'UniverseForked' AND u.canonical) AS fork_count
				FROM questions q JOIN networks n USING (chain_id) WHERE q.canonical AND (${search ?? null}::text IS NULL OR q.title ILIKE ${search ?? ''} OR q.question_id::text ILIKE ${search ?? ''}) ORDER BY q.created_timestamp DESC, q.chain_id, q.question_id LIMIT ${queryLimit} OFFSET ${offset}`
			: await sql`SELECT q.*, q.start_time::text AS start_time, q.end_time::text AS end_time, n.id AS network_id,
				(SELECT count(*) FROM pools p WHERE p.chain_id = q.chain_id AND p.question_id = q.question_id AND p.canonical) AS pool_count,
				(SELECT count(*) FROM universe_events u WHERE u.chain_id = q.chain_id AND u.fork_question_id = q.question_id AND u.event_name = 'UniverseForked' AND u.canonical) AS fork_count
				FROM questions q JOIN networks n USING (chain_id) WHERE q.canonical AND q.chain_id = ${chainId} AND (${search ?? null}::text IS NULL OR q.title ILIKE ${search ?? ''} OR q.question_id::text ILIKE ${search ?? ''}) ORDER BY q.created_timestamp DESC, q.chain_id, q.question_id LIMIT ${queryLimit} OFFSET ${offset}`
	const pools =
		chainId === undefined
			? await sql`SELECT p.*, n.id AS network_id, q.title AS question_title,
				ps.settlement_collateral_atto_eth, ps.total_capacity_ownership_atto_rep, ps.fee_eligible_capacity_ownership_atto_rep, ps.total_claimable_vault_fees_atto_eth, ps.unallocated_accrued_fees_atto_eth, ps.current_retention_rate, ps.block_number AS snapshot_block,
				(SELECT count(DISTINCT v.vault_address) FROM vault_snapshots v WHERE v.chain_id = p.chain_id AND v.pool_address = p.pool_address AND v.canonical) AS vault_count,
				(SELECT count(*) FROM pools child WHERE child.chain_id = p.chain_id AND child.parent_address = p.pool_address AND child.canonical) AS child_count
				FROM pools p JOIN networks n USING (chain_id)
				LEFT JOIN questions q ON q.chain_id = p.chain_id AND q.question_id = p.question_id AND q.canonical
				LEFT JOIN LATERAL (SELECT * FROM pool_snapshots snapshot WHERE snapshot.chain_id = p.chain_id AND snapshot.pool_address = p.pool_address AND snapshot.canonical ORDER BY snapshot.block_number DESC, snapshot.log_index DESC LIMIT 1) ps ON true
				WHERE p.canonical AND (${search ?? null}::text IS NULL OR p.pool_address ILIKE ${search ?? ''} OR q.title ILIKE ${search ?? ''}) ORDER BY p.block_number DESC, p.chain_id, p.pool_address LIMIT ${queryLimit} OFFSET ${offset}`
			: await sql`SELECT p.*, n.id AS network_id, q.title AS question_title,
				ps.settlement_collateral_atto_eth, ps.total_capacity_ownership_atto_rep, ps.fee_eligible_capacity_ownership_atto_rep, ps.total_claimable_vault_fees_atto_eth, ps.unallocated_accrued_fees_atto_eth, ps.current_retention_rate, ps.block_number AS snapshot_block,
				(SELECT count(DISTINCT v.vault_address) FROM vault_snapshots v WHERE v.chain_id = p.chain_id AND v.pool_address = p.pool_address AND v.canonical) AS vault_count,
				(SELECT count(*) FROM pools child WHERE child.chain_id = p.chain_id AND child.parent_address = p.pool_address AND child.canonical) AS child_count
				FROM pools p JOIN networks n USING (chain_id)
				LEFT JOIN questions q ON q.chain_id = p.chain_id AND q.question_id = p.question_id AND q.canonical
				LEFT JOIN LATERAL (SELECT * FROM pool_snapshots snapshot WHERE snapshot.chain_id = p.chain_id AND snapshot.pool_address = p.pool_address AND snapshot.canonical ORDER BY snapshot.block_number DESC, snapshot.log_index DESC LIMIT 1) ps ON true
				WHERE p.canonical AND p.chain_id = ${chainId} AND (${search ?? null}::text IS NULL OR p.pool_address ILIKE ${search ?? ''} OR q.title ILIKE ${search ?? ''}) ORDER BY p.block_number DESC, p.chain_id, p.pool_address LIMIT ${queryLimit} OFFSET ${offset}`
	const vaults =
		chainId === undefined
			? await sql`SELECT DISTINCT ON (v.chain_id, v.pool_address, v.vault_address) v.*, n.id AS network_id, q.title AS question_title
				FROM vault_snapshots v JOIN networks n USING (chain_id) LEFT JOIN pools p ON p.chain_id = v.chain_id AND p.pool_address = v.pool_address AND p.canonical LEFT JOIN questions q ON q.chain_id = p.chain_id AND q.question_id = p.question_id AND q.canonical
				WHERE v.canonical AND (${search ?? null}::text IS NULL OR v.vault_address ILIKE ${search ?? ''} OR v.pool_address ILIKE ${search ?? ''}) ORDER BY v.chain_id, v.pool_address, v.vault_address, v.block_number DESC, v.log_index DESC LIMIT ${queryLimit} OFFSET ${offset}`
			: await sql`SELECT DISTINCT ON (v.chain_id, v.pool_address, v.vault_address) v.*, n.id AS network_id, q.title AS question_title
				FROM vault_snapshots v JOIN networks n USING (chain_id) LEFT JOIN pools p ON p.chain_id = v.chain_id AND p.pool_address = v.pool_address AND p.canonical LEFT JOIN questions q ON q.chain_id = p.chain_id AND q.question_id = p.question_id AND q.canonical
				WHERE v.canonical AND v.chain_id = ${chainId} AND (${search ?? null}::text IS NULL OR v.vault_address ILIKE ${search ?? ''} OR v.pool_address ILIKE ${search ?? ''}) ORDER BY v.chain_id, v.pool_address, v.vault_address, v.block_number DESC, v.log_index DESC LIMIT ${queryLimit} OFFSET ${offset}`
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
				FROM identity i JOIN networks n USING (chain_id) LEFT JOIN latest_supply s USING (chain_id, universe_id) LEFT JOIN fork f USING (chain_id, universe_id) WHERE (${search ?? null}::text IS NULL OR i.universe_id::text ILIKE ${search ?? ''}) ORDER BY i.chain_id, i.block_number, i.universe_id LIMIT ${queryLimit} OFFSET ${offset}`
			: await sql`WITH identity AS (
				SELECT DISTINCT ON (chain_id, universe_id) * FROM universe_events WHERE canonical AND event_name IN ('UniverseInitialized', 'DeployChild') AND chain_id = ${chainId} ORDER BY chain_id, universe_id, block_number, log_index
			), latest_supply AS (
				SELECT DISTINCT ON (chain_id, universe_id) chain_id, universe_id, theoretical_supply_atto_rep, block_number AS supply_block FROM universe_events WHERE canonical AND theoretical_supply_atto_rep IS NOT NULL AND chain_id = ${chainId} ORDER BY chain_id, universe_id, block_number DESC, log_index DESC
			), fork AS (
				SELECT DISTINCT ON (chain_id, universe_id) chain_id, universe_id, fork_question_id, fork_time, forker_address, fork_threshold_atto_rep, migration_rep_balance_atto_rep FROM universe_events WHERE canonical AND event_name = 'UniverseForked' AND chain_id = ${chainId} ORDER BY chain_id, universe_id, block_number DESC, log_index DESC
			) SELECT i.*, n.id AS network_id, s.theoretical_supply_atto_rep, s.supply_block, f.fork_question_id AS active_fork_question_id, f.fork_time AS active_fork_time, f.forker_address, f.fork_threshold_atto_rep, f.migration_rep_balance_atto_rep,
				(SELECT count(*) FROM identity child WHERE child.chain_id = i.chain_id AND child.parent_universe_id = i.universe_id AND child.universe_id <> i.universe_id) AS child_count,
				(SELECT count(*) FROM pools p WHERE p.chain_id = i.chain_id AND p.universe_id = i.universe_id AND p.canonical) AS pool_count
				FROM identity i JOIN networks n USING (chain_id) LEFT JOIN latest_supply s USING (chain_id, universe_id) LEFT JOIN fork f USING (chain_id, universe_id) WHERE (${search ?? null}::text IS NULL OR i.universe_id::text ILIKE ${search ?? ''}) ORDER BY i.chain_id, i.block_number, i.universe_id LIMIT ${queryLimit} OFFSET ${offset}`
	const returnedPools: Array<Record<string, unknown>> = pools.slice(0, queryLimit - 1)
	const poolAddresses = returnedPools.map(pool => String(pool['pool_address']))
	const pagePoolKeys = new Set(returnedPools.map(pool => `${pool['chain_id']}:${pool['pool_address']}`))
	const poolAddressArray = sql.array(poolAddresses, 'TEXT')
	let stateRows: Array<Record<string, unknown>> = []
	if (poolAddresses.length > 0) {
		stateRows =
			chainId === undefined
				? await sql`SELECT DISTINCT ON (chain_id, pool_address, event_name) chain_id, pool_address, event_name, state, block_number, log_index FROM pool_state_events WHERE canonical AND pool_address = ANY(${poolAddressArray}) ORDER BY chain_id, pool_address, event_name, block_number DESC, log_index DESC`
				: await sql`SELECT DISTINCT ON (chain_id, pool_address, event_name) chain_id, pool_address, event_name, state, block_number, log_index FROM pool_state_events WHERE canonical AND chain_id = ${chainId} AND pool_address = ANY(${poolAddressArray}) ORDER BY chain_id, pool_address, event_name, block_number DESC, log_index DESC`
	}
	const poolStates = stateRows.filter(state => pagePoolKeys.has(`${state['chain_id']}:${state['pool_address']}`))
	return { catalogVersion, totals, questions, pools, vaults, universes, poolStates }
}
