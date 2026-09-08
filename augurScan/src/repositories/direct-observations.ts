import type { SQL } from 'bun'

export type DirectObservationQuery = {
	readonly chainId: number
	readonly snapshot: {
		readonly kind: 'all' | 'address-balance' | 'token-metadata'
		readonly address?: string
		readonly canonical: 'canonical' | 'orphaned' | 'all'
		readonly maxBalanceId: string
		readonly maxMetadataId: string
	}
	readonly cursor?: { readonly observedAt: string; readonly kind: 'address-balance' | 'token-metadata'; readonly id: string }
	readonly limit: number
}

export const directObservationMaxima = async (sql: SQL, chainId: number) =>
	await sql`SELECT
		COALESCE((SELECT max(id) FROM address_balance_observations WHERE chain_id = ${chainId}), 0)::text AS max_balance_id,
		COALESCE((SELECT max(id) FROM token_metadata_observations WHERE chain_id = ${chainId}), 0)::text AS max_metadata_id`

export const directObservationRows = async (sql: SQL, query: DirectObservationQuery) => {
	const { chainId, snapshot, cursor, limit } = query
	return await sql`
		WITH observations AS (
			SELECT 'address-balance'::text AS observation_kind, observation.id,
				observation.chain_id, observation.block_hash, observation.block_number,
				observation.address, observation.asset_address, observation.asset_kind,
				observation.read_status, observation.read_failure_reason,
				jsonb_strip_nulls(jsonb_build_object('balance', observation.balance::text,
					'readFailureReason', observation.read_failure_reason)) AS result,
				observation.canonical, observation.observed_at, observation.indexer_run_id,
				observation.abi_source_hash, observation.application_source_hash, observation.projection_source_hash
			FROM address_balance_observations observation
			WHERE observation.chain_id = ${chainId} AND observation.id <= ${snapshot.maxBalanceId}
				AND ${snapshot.kind === 'token-metadata'} = false
				AND (${snapshot.address ?? null}::text IS NULL OR observation.address = ${snapshot.address ?? null}
					OR observation.asset_address = ${snapshot.address ?? null})
				AND (${snapshot.canonical} = 'all' OR observation.canonical = (${snapshot.canonical} = 'canonical'))
			UNION ALL
			SELECT 'token-metadata'::text AS observation_kind, observation.id,
				observation.chain_id, observation.block_hash, observation.read_block AS block_number,
				observation.address, NULL::text AS asset_address, NULL::text AS asset_kind,
				observation.read_status, observation.read_error AS read_failure_reason,
				jsonb_strip_nulls(jsonb_build_object('name', observation.name, 'symbol', observation.symbol,
					'decimals', observation.decimals, 'readError', observation.read_error)) AS result,
				observation.canonical, observation.observed_at, observation.indexer_run_id,
				observation.abi_source_hash, observation.application_source_hash, observation.projection_source_hash
			FROM token_metadata_observations observation
			WHERE observation.chain_id = ${chainId} AND observation.id <= ${snapshot.maxMetadataId}
				AND ${snapshot.kind === 'address-balance'} = false
				AND (${snapshot.address ?? null}::text IS NULL OR observation.address = ${snapshot.address ?? null})
			AND (${snapshot.canonical} = 'all' OR observation.canonical = (${snapshot.canonical} = 'canonical'))
		)
		SELECT observation.observation_kind, observation.id::text AS observation_id,
			observation.chain_id::text AS chain_id, observation.block_hash,
			observation.block_number::text AS block_number, block.timestamp AS block_timestamp,
			observation.address, observation.asset_address, observation.asset_kind,
			observation.read_status, observation.read_failure_reason, observation.result,
			observation.canonical, observation.observed_at, observation.indexer_run_id::text AS indexer_run_id,
			to_char(observation.observed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_observed_at,
			observation.abi_source_hash, observation.application_source_hash, observation.projection_source_hash,
			CASE WHEN observation.canonical THEN 'canonical'
				WHEN invalidation.reason = 'chain-reorg' THEN 'chain-orphaned'
				WHEN invalidation.reason = 'manifest-reset' THEN 'manifest-superseded'
				WHEN invalidation.reason = 'start-boundary-advanced' THEN 'coverage-reset'
				ELSE 'noncanonical-unknown' END AS evidence_status,
			invalidation.id::text AS invalidation_id, invalidation.reason AS invalidation_reason,
			invalidation.causes AS invalidation_causes, invalidation.detected_at AS invalidated_at,
			count(*) OVER ()::text AS total
		FROM observations observation
		JOIN blocks block ON block.chain_id = observation.chain_id AND block.hash = observation.block_hash
		LEFT JOIN LATERAL (
			SELECT replacement.id, replacement.reason,
				COALESCE((SELECT jsonb_agg(cause.reason ORDER BY cause.reason) FROM history_invalidation_causes cause
					WHERE cause.invalidation_id = replacement.id), jsonb_build_array(replacement.reason)) AS causes,
				replacement.detected_at
			FROM history_invalidation_occurrences occurrence
			JOIN chain_reorganizations replacement ON replacement.id = occurrence.invalidation_id
			WHERE occurrence.occurrence_kind = observation.observation_kind
				AND occurrence.chain_id = observation.chain_id AND occurrence.block_hash = observation.block_hash
				AND occurrence.occurrence_id = observation.id::text
			ORDER BY replacement.id DESC LIMIT 1
		) invalidation ON true
		WHERE (${cursor === undefined} OR (observation.observed_at, observation.observation_kind, observation.id) <
			(${cursor?.observedAt ?? '9999-12-31T23:59:59.999Z'}::timestamptz, ${cursor?.kind ?? 'token-metadata'}, ${cursor?.id ?? '0'}::bigint))
		ORDER BY observation.observed_at DESC, observation.observation_kind DESC, observation.id DESC
		LIMIT ${limit + 1}
	`
}
