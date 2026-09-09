import type { SQL } from 'bun'

type EventPosition = readonly [string, number, string, string]
type RiskPositions = {
	readonly state?: readonly [string, string, string]
	readonly accounting?: EventPosition
	readonly lifecycle?: EventPosition
	readonly liquidations?: readonly [string, number, string, string, string, string]
}

export const riskHistoryRows = async (
	sql: SQL,
	query: {
		readonly chainId: number
		readonly kind: 'pools' | 'vaults'
		readonly poolAddress: string
		readonly vaultAddress?: string
		readonly entityType: 'pool' | 'vault'
		readonly entityIdentity: string
		readonly asOfBlock: string
		readonly positions: RiskPositions
		readonly limit: number
	},
) => {
	const { chainId, kind, poolAddress, vaultAddress, entityType, entityIdentity, asOfBlock, positions, limit } = query
	const [stateSnapshots, accountingSnapshots, lifecycleEvents, liquidations] = await Promise.all([
		sql`
			SELECT observation.*, observation.id::text AS id, observation.indexer_run_id::text AS indexer_run_id,
				to_char(observation.observed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_observed_at,
				block.timestamp AS block_timestamp, invalidation.id::text AS invalidation_id,
				invalidation.reason AS invalidation_reason, invalidation.causes AS invalidation_causes
			FROM entity_state_observations observation
			JOIN blocks block ON block.chain_id = observation.chain_id AND block.hash = observation.block_hash
			LEFT JOIN LATERAL (
				SELECT replacement.id, replacement.reason,
					COALESCE((SELECT jsonb_agg(cause.reason ORDER BY cause.reason) FROM history_invalidation_causes cause
						WHERE cause.invalidation_id = replacement.id), jsonb_build_array(replacement.reason)) AS causes
				FROM history_invalidation_occurrences occurrence
				JOIN chain_reorganizations replacement ON replacement.id = occurrence.invalidation_id
				WHERE occurrence.occurrence_kind = 'entity-state' AND occurrence.chain_id = observation.chain_id
					AND occurrence.block_hash = observation.block_hash AND occurrence.occurrence_id = observation.id::text
				ORDER BY replacement.id DESC LIMIT 1
			) invalidation ON true
			WHERE observation.chain_id = ${chainId} AND observation.entity_type = ${entityType}
				AND observation.entity_identity = ${entityIdentity} AND observation.canonical
				AND observation.block_number <= ${asOfBlock}
				AND (${positions.state === undefined} OR (observation.block_number, observation.observed_at, observation.id) <
					(${positions.state?.[0] ?? '0'}::bigint, ${positions.state?.[1] ?? '1970-01-01T00:00:00.000Z'}::timestamptz,
						${positions.state?.[2] ?? '0'}::bigint))
			ORDER BY observation.block_number DESC, observation.observed_at DESC, observation.id DESC
			LIMIT ${limit + 1}
		`,
		kind === 'pools'
			? sql`SELECT snapshot.*, block.timestamp AS block_timestamp FROM pool_snapshots snapshot
				JOIN blocks block ON block.chain_id = snapshot.chain_id AND block.hash = snapshot.block_hash
				WHERE snapshot.chain_id = ${chainId} AND snapshot.pool_address = ${poolAddress} AND snapshot.canonical
					AND snapshot.block_number <= ${asOfBlock}
					AND (${positions.accounting === undefined} OR (snapshot.block_number, snapshot.log_index, snapshot.tx_hash, snapshot.block_hash) <
						(${positions.accounting?.[0] ?? '0'}::bigint, ${positions.accounting?.[1] ?? 0}::integer,
							${positions.accounting?.[2] ?? `0x${'0'.repeat(64)}`}, ${positions.accounting?.[3] ?? `0x${'0'.repeat(64)}`}))
				ORDER BY snapshot.block_number DESC, snapshot.log_index DESC, snapshot.tx_hash DESC, snapshot.block_hash DESC
				LIMIT ${limit + 1}`
			: sql`SELECT snapshot.*, block.timestamp AS block_timestamp FROM vault_snapshots snapshot
				JOIN blocks block ON block.chain_id = snapshot.chain_id AND block.hash = snapshot.block_hash
				WHERE snapshot.chain_id = ${chainId} AND snapshot.pool_address = ${poolAddress}
					AND snapshot.vault_address = ${vaultAddress ?? ''} AND snapshot.canonical
					AND snapshot.block_number <= ${asOfBlock}
					AND (${positions.accounting === undefined} OR (snapshot.block_number, snapshot.log_index, snapshot.tx_hash, snapshot.block_hash) <
						(${positions.accounting?.[0] ?? '0'}::bigint, ${positions.accounting?.[1] ?? 0}::integer,
							${positions.accounting?.[2] ?? `0x${'0'.repeat(64)}`}, ${positions.accounting?.[3] ?? `0x${'0'.repeat(64)}`}))
				ORDER BY snapshot.block_number DESC, snapshot.log_index DESC, snapshot.tx_hash DESC, snapshot.block_hash DESC
				LIMIT ${limit + 1}`,
		sql`
			SELECT timeline.*, block.timestamp AS block_timestamp FROM protocol_timeline_entries timeline
			JOIN blocks block ON block.chain_id = timeline.chain_id AND block.hash = timeline.block_hash
			WHERE timeline.chain_id = ${chainId} AND timeline.entity_type = ${entityType}
				AND timeline.entity_identity = ${entityIdentity} AND timeline.canonical
				AND timeline.block_number <= ${asOfBlock}
				AND (${positions.lifecycle === undefined} OR (timeline.block_number, timeline.log_index, timeline.tx_hash, timeline.block_hash) <
					(${positions.lifecycle?.[0] ?? '0'}::bigint, ${positions.lifecycle?.[1] ?? 0}::integer,
						${positions.lifecycle?.[2] ?? `0x${'0'.repeat(64)}`}, ${positions.lifecycle?.[3] ?? `0x${'0'.repeat(64)}`}))
			ORDER BY timeline.block_number DESC, timeline.log_index DESC, timeline.tx_hash DESC, timeline.block_hash DESC
			LIMIT ${limit + 1}
		`,
		sql`
			SELECT timeline.*, block.timestamp AS block_timestamp FROM protocol_timeline_entries timeline
			JOIN blocks block ON block.chain_id = timeline.chain_id AND block.hash = timeline.block_hash
			WHERE timeline.chain_id = ${chainId} AND timeline.semantic_event_kind = 'VaultLiquidated' AND timeline.canonical
				AND timeline.block_number <= ${asOfBlock}
				AND (timeline.summary_data->>'targetVault' = ${vaultAddress ?? ''} OR timeline.summary_data->>'vault' = ${vaultAddress ?? ''}
					OR (timeline.source_contract = ${poolAddress} AND ${kind === 'pools'}))
				AND (${positions.liquidations === undefined} OR (timeline.block_number, timeline.log_index, timeline.tx_hash, timeline.block_hash,
					timeline.entity_type, timeline.entity_identity) < (${positions.liquidations?.[0] ?? '0'}::bigint,
						${positions.liquidations?.[1] ?? 0}::integer, ${positions.liquidations?.[2] ?? `0x${'0'.repeat(64)}`},
						${positions.liquidations?.[3] ?? `0x${'0'.repeat(64)}`}, ${positions.liquidations?.[4] ?? ''}, ${positions.liquidations?.[5] ?? ''}))
			ORDER BY timeline.block_number DESC, timeline.log_index DESC, timeline.tx_hash DESC, timeline.block_hash DESC,
				timeline.entity_type DESC, timeline.entity_identity DESC
			LIMIT ${limit + 1}
		`,
	])
	return { stateSnapshots, accountingSnapshots, lifecycleEvents, liquidations }
}
