import type { SQL } from 'bun'

// Recovery burns are emitted by the coordinator during the child's branch-start transaction.
export function forkBurns(sql: SQL, snapshotBlock: string) {
	return sql`(
		SELECT COALESCE(sum((burn.event_data->>'amountAttoRep')::numeric), 0)::text
		FROM fork_migration_events burn
		WHERE burn.chain_id = root.chain_id AND burn.canonical AND burn.event_name = 'RepBurned'
			AND burn.block_number BETWEEN root.block_number AND ${snapshotBlock}
			AND burn.event_data ? 'amountAttoRep'
			AND (
				(burn.universe_identity = root.universe_identity AND burn.block_hash = root.block_hash AND burn.tx_hash = root.tx_hash)
				OR EXISTS (
					SELECT 1
					FROM universe_events child
					JOIN fork_migration_events started ON started.chain_id = child.chain_id AND started.canonical
						AND started.event_name = 'BranchStarted' AND started.event_data->>'universeId' = child.universe_id::text
						AND started.block_hash = burn.block_hash AND started.tx_hash = burn.tx_hash AND started.log_index > burn.log_index
						AND split_part(started.universe_identity, ':', 1) = lower(burn.event_data->>'burner')
					WHERE child.chain_id = root.chain_id AND child.canonical AND child.block_number <= burn.block_number
						AND child.parent_universe_id::text = root.universe_identity AND child.universe_id::text = burn.universe_identity
						AND child.universe_id <> child.parent_universe_id
				)
			)
	)`
}
