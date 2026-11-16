import type { SQL } from 'bun'

// Capital is held per owner in one ledger per portfolio universe. Current state comes from tagged
// `capital-owner` and `capital-ledger` reads; history comes from the ledger's events and from every retained read.

type PageBoundary = { readonly block: string; readonly log: number; readonly tx: string; readonly limit: number }

/**
 * `LEFT JOIN LATERAL` body resolving the owner of one position id of a ledger from its one-time
 * `capital-position` read. A position keeps its owner for life, so a read taken after the snapshot block still
 * identifies an earlier event's position. `alias` names the joined row; the lookup is one seek on the
 * snapshot identity index. `idColumn` is a trusted column expression of the calling query, never request input.
 */
const positionOwnerJoin = (sql: SQL, chainId: number, alias: 'source' | 'receiver', idColumn: string) =>
	sql.unsafe(`LEFT JOIN LATERAL (
		SELECT resolved.read_result->>'owner' AS owner_address FROM entity_state_snapshots resolved
		JOIN blocks resolved_block ON resolved_block.chain_id = resolved.chain_id AND resolved_block.hash = resolved.block_hash AND resolved_block.canonical
		WHERE resolved.chain_id = ${chainId} AND resolved.entity_type = 'capital-position' AND resolved.canonical AND resolved.read_status = 'success'
			AND resolved.entity_identity = entry.source_contract || ':' || (${idColumn})
		ORDER BY resolved.block_number DESC LIMIT 1
	) ${alias} ON true`)

/** `ledgers`: the latest successful read of every capital ledger at the snapshot block. */
export const latestLedgers = (sql: SQL, chainId: number, snapshotBlock: string) => sql`
	ledgers AS (
		SELECT contract.address AS ledger_address, latest.read_result, latest.block_number, latest.block_hash, latest.block_timestamp
		FROM contracts contract
		-- One seek per registered ledger on the latest-read index; the retained history is never scanned.
		JOIN LATERAL (
			SELECT state.read_result, state.block_number, state.block_hash, state.block_timestamp FROM entity_state_snapshots state
			JOIN blocks block ON block.chain_id = state.chain_id AND block.hash = state.block_hash AND block.canonical
			WHERE state.chain_id = ${chainId} AND state.entity_type = 'capital-ledger' AND state.entity_identity = contract.address
				AND state.canonical AND state.read_status = 'success' AND state.block_number <= ${snapshotBlock}
			ORDER BY state.block_number DESC, state.observed_at DESC LIMIT 1
		) latest ON true
		WHERE contract.chain_id = ${chainId} AND contract.canonical AND contract.kind = 'securityPoolCapitalLedger'
	)`

/**
 * `owners(ledger_address, owner_address)`: every owner known to hold capital in a ledger, from the two sources that
 * also select the sampling targets: ledger events that name an owner, and the one-time reads of position owners.
 * Both grow with capital activity, not with the number of retained reads.
 */
const knownOwners = (sql: SQL, chainId: number, snapshotBlock: string) => sql`
	owners AS (
		SELECT split_part(entity_identity, ':', 1) AS ledger_address, split_part(entity_identity, ':', 2) AS owner_address
		FROM protocol_timeline_entries
		WHERE chain_id = ${chainId} AND canonical AND entity_type = 'vault' AND block_number <= ${snapshotBlock}
		UNION
		SELECT resolved.read_result->>'ledger', resolved.read_result->>'owner' FROM entity_state_snapshots resolved
		WHERE resolved.chain_id = ${chainId} AND resolved.entity_type = 'capital-position' AND resolved.canonical AND resolved.read_status = 'success'
	)`

export type CapitalPositionFilter = {
	readonly chainId: number
	readonly snapshotBlock: string
	readonly ledger?: string | undefined
	readonly owner?: string | undefined
	readonly limit: number
	readonly offset: number
}

/**
 * Owner positions, most at risk first: ascending health factor, then identity. Positions without a health
 * factor (no commitment, no accepted price, or a failed read) follow every position that has one.
 */
export const capitalPositionRows = async (sql: SQL, filter: CapitalPositionFilter) => {
	const { chainId, snapshotBlock, ledger, owner, limit, offset } = filter
	return await sql`
		WITH ${knownOwners(sql, chainId, snapshotBlock)}, identities AS (
			-- One position is named exactly; the latest-read seek below decides whether it exists.
			SELECT ${`${ledger ?? ''}:${owner ?? ''}`}::text AS entity_identity WHERE ${ledger !== undefined && owner !== undefined}
			UNION ALL
			SELECT known.ledger_address || ':' || known.owner_address FROM owners known
			WHERE NOT ${ledger !== undefined && owner !== undefined}
				AND (${ledger ?? null}::text IS NULL OR known.ledger_address = ${ledger ?? null})
				AND (${owner ?? null}::text IS NULL OR known.owner_address = ${owner ?? null})
		), positions AS (
			SELECT split_part(identity.entity_identity, ':', 1) AS ledger_address, split_part(identity.entity_identity, ':', 2) AS owner_address,
				snapshot.block_number::text AS block_number, snapshot.block_hash, snapshot.block_timestamp, snapshot.read_status,
				snapshot.read_result, snapshot.read_failure_reason, snapshot.source_method, snapshot.observed_at,
				snapshot.indexer_run_id::text AS indexer_run_id, snapshot.abi_source_hash, snapshot.application_source_hash, snapshot.projection_source_hash,
				CASE WHEN snapshot.read_status = 'success' AND snapshot.read_result->>'healthFactorBps' ~ '^[0-9]+$' THEN (snapshot.read_result->>'healthFactorBps')::numeric END AS health_factor_bps
			FROM identities identity JOIN LATERAL (
				SELECT state.* FROM entity_state_snapshots state
				JOIN blocks block ON block.chain_id = state.chain_id AND block.hash = state.block_hash AND block.canonical
				WHERE state.chain_id = ${chainId} AND state.entity_type = 'capital-owner' AND state.entity_identity = identity.entity_identity
					AND state.canonical AND state.block_number <= ${snapshotBlock}
				ORDER BY state.block_number DESC, state.observed_at DESC LIMIT 1
			) snapshot ON true
		)
		SELECT position.*, count(*) OVER ()::integer AS total FROM positions position
		ORDER BY position.health_factor_bps ASC NULLS LAST, position.ledger_address, position.owner_address
		LIMIT ${limit} OFFSET ${offset}
	`
}

/** Every capital ledger with its latest read (accepted price, aggregate principal and commitment, universe) and the number of its known owners. */
export const capitalLedgerRows = async (sql: SQL, chainId: number, snapshotBlock: string, ledger?: string) =>
	await sql`
		WITH ${latestLedgers(sql, chainId, snapshotBlock)}, ${knownOwners(sql, chainId, snapshotBlock)},
			owner_counts AS (SELECT ledger_address, count(*)::integer AS owner_count FROM owners GROUP BY ledger_address)
		SELECT contract.address AS ledger_address, ledger.read_result, ledger.block_number::text AS block_number, ledger.block_hash, ledger.block_timestamp,
			COALESCE(counted.owner_count, 0) AS owner_count
		FROM contracts contract LEFT JOIN ledgers ledger ON ledger.ledger_address = contract.address
		LEFT JOIN owner_counts counted ON counted.ledger_address = contract.address
		WHERE contract.chain_id = ${chainId} AND contract.canonical AND contract.kind = 'securityPoolCapitalLedger'
			AND (${ledger ?? null}::text IS NULL OR contract.address = ${ledger ?? null})
		ORDER BY contract.address LIMIT 250
	`

/** Retained reads of one owner position, newest first. Each row carries the full read result. */
export const capitalPositionHistoryRows = async (sql: SQL, query: { readonly chainId: number; readonly ledger: string; readonly owner: string; readonly snapshotBlock: string; readonly limit: number }) =>
	await sql`
		SELECT state.block_number::text AS block_number, state.block_hash, state.block_timestamp, state.read_status, state.read_result,
			state.read_failure_reason, state.source_method, state.observed_at
		FROM entity_state_snapshots state
		JOIN blocks block ON block.chain_id = state.chain_id AND block.hash = state.block_hash AND block.canonical
		WHERE state.chain_id = ${query.chainId} AND state.entity_type = 'capital-owner' AND state.entity_identity = ${`${query.ledger}:${query.owner}`}
			AND state.canonical AND state.block_number <= ${query.snapshotBlock}
		ORDER BY state.block_number DESC, state.observed_at DESC LIMIT ${query.limit}
	`

export type LiquidationFilter = {
	readonly chainId: number
	readonly snapshotBlock: string
	readonly ledger?: string | undefined
	readonly owner?: string | undefined
	readonly page: PageBoundary
}

/**
 * Take-overs, cures and report operations, newest first. A take-over or cure is attributed to its ledger
 * (portfolio and universe) and to the owners of the positions it names; a report operation to the ledger of
 * the feed that emitted it and to its sponsor. The chain does not tie any of them to a question pool.
 */
export const liquidationRows = async (sql: SQL, filter: LiquidationFilter) => {
	const { chainId, snapshotBlock, ledger, owner, page } = filter
	return await sql`
		WITH ${latestLedgers(sql, chainId, snapshotBlock)}
		SELECT entry.block_number::text AS block_number, entry.block_hash, entry.tx_hash, entry.log_index,
			entry.semantic_event_kind AS event_name, entry.source_contract, entry.summary_data AS event_data, block.timestamp AS block_timestamp,
			ledger.ledger_address, ledger.read_result->>'portfolio' AS portfolio, ledger.read_result->>'universeId' AS universe_id,
			ledger.read_result->'collateral' AS collateral,
			source.owner_address AS source_owner, receiver.owner_address AS receiver_owner
		FROM protocol_timeline_entries entry
		JOIN blocks block ON block.chain_id = entry.chain_id AND block.hash = entry.block_hash AND block.canonical
		LEFT JOIN ledgers ledger ON ledger.ledger_address = entry.source_contract
			OR (entry.semantic_event_kind = 'ReportOperationAttempted' AND ledger.read_result->>'priceFeed' = entry.source_contract)
		${positionOwnerJoin(sql, chainId, 'source', "COALESCE(entry.summary_data->>'sourceId', entry.summary_data->>'positionId')")}
		${positionOwnerJoin(sql, chainId, 'receiver', "entry.summary_data->>'receiverId'")}
		-- Take-overs and cures are timeline entries of a capital position; report operations of a price feed.
		WHERE entry.chain_id = ${chainId} AND entry.canonical AND entry.block_number <= ${snapshotBlock}
			AND entry.entity_type IN ('capital-position', 'price-feed')
			AND entry.semantic_event_kind IN ('CommitmentTakenOver', 'CommitmentCured', 'ReportOperationAttempted')
			AND (${ledger ?? null}::text IS NULL OR entry.source_contract = ${ledger ?? null} OR ledger.ledger_address = ${ledger ?? null})
			AND (${owner ?? null}::text IS NULL OR source.owner_address = ${owner ?? null} OR receiver.owner_address = ${owner ?? null}
				OR lower(entry.summary_data->>'sponsor') = ${owner ?? null})
			AND (entry.block_number, entry.log_index, entry.tx_hash) < (${page.block}::bigint, ${page.log}::integer, ${page.tx})
		ORDER BY entry.block_number DESC, entry.log_index DESC, entry.tx_hash DESC LIMIT ${page.limit}
	`
}

/**
 * One owner's capital history in a ledger, newest first: the ledger events that name the owner, and the
 * take-overs, cures and report operations attributed to it.
 */
export const capitalOwnerEventRows = async (sql: SQL, query: { readonly chainId: number; readonly ledger: string; readonly owner: string; readonly snapshotBlock: string; readonly page: PageBoundary }) => {
	const { chainId, ledger, owner, snapshotBlock, page } = query
	return await sql`
		WITH ${latestLedgers(sql, chainId, snapshotBlock)}
		SELECT entry.block_number::text AS block_number, entry.block_hash, entry.tx_hash, entry.log_index,
			entry.semantic_event_kind AS event_name, entry.source_contract, entry.summary_data AS event_data, block.timestamp AS block_timestamp,
			source.owner_address AS source_owner, receiver.owner_address AS receiver_owner,
			own_ledger.read_result->>'universeId' AS universe_id, own_ledger.read_result->'collateral' AS collateral
		FROM protocol_timeline_entries entry
		JOIN blocks block ON block.chain_id = entry.chain_id AND block.hash = entry.block_hash AND block.canonical
		LEFT JOIN ledgers own_ledger ON own_ledger.ledger_address = ${ledger}
		${positionOwnerJoin(sql, chainId, 'source', "COALESCE(entry.summary_data->>'sourceId', entry.summary_data->>'positionId')")}
		${positionOwnerJoin(sql, chainId, 'receiver', "entry.summary_data->>'receiverId'")}
		-- Each branch seeks the timeline's entity index: the owner's own entries, the ledger's position entries, the ledger's feed.
		WHERE entry.chain_id = ${chainId} AND entry.canonical AND entry.block_number <= ${snapshotBlock} AND (
			(entry.entity_type = 'vault' AND entry.entity_identity = ${`${ledger}:${owner}`})
			OR (entry.entity_type = 'capital-position' AND entry.entity_identity LIKE ${`${ledger}:%`}
				AND entry.semantic_event_kind IN ('CommitmentTakenOver', 'CommitmentCured')
				AND (source.owner_address = ${owner} OR receiver.owner_address = ${owner}))
			OR (entry.entity_type = 'price-feed' AND entry.entity_identity = own_ledger.read_result->>'priceFeed'
				AND entry.semantic_event_kind = 'ReportOperationAttempted' AND lower(entry.summary_data->>'sponsor') = ${owner}))
			AND (entry.block_number, entry.log_index, entry.tx_hash) < (${page.block}::bigint, ${page.log}::integer, ${page.tx})
		ORDER BY entry.block_number DESC, entry.log_index DESC, entry.tx_hash DESC LIMIT ${page.limit}
	`
}
