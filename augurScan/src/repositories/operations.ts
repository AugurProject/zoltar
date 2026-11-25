import { forkBurns } from './fork-burns.ts'
import type { SQL } from 'bun'
import { auctionLifecycle, auctionStartedWindow, reportLifecycle, reportLifecycleEventName } from '../operations.ts'
import { ApiRequestError } from '../query-errors.ts'
import { jsonRecord } from '../record-serialization.ts'

export const unavailableOperationsBlockHash = `0x${'0'.repeat(64)}`

export const operationsAsOf = async (sql: SQL, chainId: number, atBlock?: string): Promise<Record<string, unknown>> => {
	const rows =
		atBlock === undefined
			? await sql`
				SELECT indexed_block::text AS "blockNumber", indexed_hash AS "blockHash",
					EXTRACT(EPOCH FROM indexed_timestamp)::bigint::text AS "blockTimestamp",
					indexed_block::text AS "indexedHead", '0'::text AS "historyDepthBlocks",
					observed_block::text AS "observedHead",
					GREATEST(observed_block - COALESCE(indexed_block, start_block - 1), 0)::text AS "lagBlocks",
					COALESCE((SELECT max(reorganization.id) FROM chain_reorganizations reorganization
						WHERE reorganization.chain_id = network.chain_id), 0)::text AS "invalidationId",
					COALESCE(network.applied_abi_source_hash, 'unavailable') AS "abiSourceHash",
					COALESCE(network.applied_application_source_hash, 'unavailable') AS "applicationSourceHash",
					COALESCE(network.applied_projection_source_hash, 'unavailable') AS "projectionSourceHash",
					phase, last_success_at AS "lastSuccessfulRefresh", false AS historical
				FROM networks network WHERE chain_id = ${chainId}
			`
			: await sql`
				SELECT block.number::text AS "blockNumber", block.hash AS "blockHash",
					EXTRACT(EPOCH FROM block.timestamp)::bigint::text AS "blockTimestamp",
					network.indexed_block::text AS "indexedHead",
					GREATEST(COALESCE(network.indexed_block, block.number, 0) - block.number, 0)::text AS "historyDepthBlocks",
					network.observed_block::text AS "observedHead",
					GREATEST(COALESCE(network.observed_block, block.number, 0) - block.number, 0)::text AS "lagBlocks",
					COALESCE((SELECT max(reorganization.id) FROM chain_reorganizations reorganization
						WHERE reorganization.chain_id = network.chain_id), 0)::text AS "invalidationId",
					COALESCE(network.applied_abi_source_hash, 'unavailable') AS "abiSourceHash",
					COALESCE(network.applied_application_source_hash, 'unavailable') AS "applicationSourceHash",
					COALESCE(network.applied_projection_source_hash, 'unavailable') AS "projectionSourceHash",
					'historical'::text AS phase, network.last_success_at AS "lastSuccessfulRefresh", true AS historical
				FROM networks network JOIN blocks block ON block.chain_id = network.chain_id
				WHERE network.chain_id = ${chainId} AND block.number = ${atBlock} AND block.canonical
			`
	const row = rows[0]
	if (row === undefined) {
		const configured = await sql`SELECT 1 FROM networks WHERE chain_id = ${chainId}`
		if (configured.length === 0) throw new ApiRequestError('chainId is not configured')
		throw new ApiRequestError('atBlock is outside retained canonical coverage')
	}
	return {
		...row,
		blockNumber: row['blockNumber'] ?? '0',
		blockHash: row['blockHash'] ?? unavailableOperationsBlockHash,
		blockTimestamp: row['blockTimestamp'] ?? '0',
		indexedHead: row['indexedHead'] ?? row['blockNumber'] ?? '0',
		historyDepthBlocks: row['historyDepthBlocks'] ?? '0',
		observedHead: row['observedHead'] ?? '0',
		invalidationId: row['invalidationId'] ?? '0',
		abiSourceHash: row['abiSourceHash'] ?? 'unavailable',
		applicationSourceHash: row['applicationSourceHash'] ?? 'unavailable',
		projectionSourceHash: row['projectionSourceHash'] ?? 'unavailable',
		availability: row['blockNumber'] === null || row['blockNumber'] === undefined ? 'Awaiting indexed evidence' : 'available',
	}
}

export const operationsOverviewSupplement = async (sql: SQL, chainId: number, snapshotBlock: string) => {
	const [recentChanges, totals] = await Promise.all([
		sql`SELECT timeline.*, block.timestamp AS block_timestamp FROM protocol_timeline_entries timeline
			JOIN blocks block ON block.chain_id = timeline.chain_id AND block.hash = timeline.block_hash
			WHERE timeline.chain_id = ${chainId} AND timeline.canonical AND timeline.block_number <= ${snapshotBlock}
			ORDER BY timeline.block_number DESC, timeline.log_index DESC, timeline.tx_hash DESC,
				timeline.block_hash DESC, timeline.entity_type DESC, timeline.entity_identity DESC LIMIT 30`,
		sql`SELECT
			COALESCE((SELECT total FROM protocol_entity_totals WHERE chain_id=${chainId} AND domain='reports' AND canonical AND block_number<=${snapshotBlock} ORDER BY block_number DESC LIMIT 1),0)::integer AS reports,
			COALESCE((SELECT total FROM protocol_entity_totals WHERE chain_id=${chainId} AND domain='escalations' AND canonical AND block_number<=${snapshotBlock} ORDER BY block_number DESC LIMIT 1),0)::integer AS escalations,
			COALESCE((SELECT total FROM protocol_entity_totals WHERE chain_id=${chainId} AND domain='auctions' AND canonical AND block_number<=${snapshotBlock} ORDER BY block_number DESC LIMIT 1),0)::integer AS auctions,
			COALESCE((SELECT total FROM protocol_entity_totals WHERE chain_id=${chainId} AND domain='pools' AND canonical AND block_number<=${snapshotBlock} ORDER BY block_number DESC LIMIT 1),0)::integer AS pools,
			COALESCE((SELECT total FROM protocol_entity_totals WHERE chain_id=${chainId} AND domain='markets' AND canonical AND block_number<=${snapshotBlock} ORDER BY block_number DESC LIMIT 1),0)::integer AS markets,
			(SELECT count(*) FROM chain_reorganizations WHERE chain_id=${chainId})::integer AS reorganizations`,
	])
	return { recentChanges, totals: totals[0] }
}

export const reportCatalogData = async (sql: SQL, chainId: number, asOf: Record<string, unknown>, cursorBlock = String(asOf['blockNumber']), cursorTx = `0x${'f'.repeat(64)}`, cursorLog = 2_147_483_647, queryLimit = 250) => {
	const snapshotBlock = String(asOf['blockNumber'])
	const rows = await sql`
		WITH identities AS (
			SELECT split_part(identity, ':', 1) AS open_oracle_address,
			 split_part(identity, ':', 2)::numeric AS report_id
			FROM protocol_entity_identities
			WHERE chain_id=${chainId} AND domain='reports' AND canonical AND block_number<=${snapshotBlock}
		), candidates AS MATERIALIZED (
			SELECT identity.open_oracle_address,identity.report_id,
			 latest.block_number,latest.log_index,latest.tx_hash
			FROM identities identity JOIN LATERAL (
			 SELECT evidence.block_number,evidence.log_index,evidence.tx_hash FROM open_oracle_report_events evidence
			 WHERE evidence.chain_id=${chainId} AND evidence.open_oracle_address=identity.open_oracle_address
			  AND evidence.report_id=identity.report_id AND evidence.canonical AND evidence.block_number<=${snapshotBlock}
			 ORDER BY evidence.block_number DESC,evidence.log_index DESC,evidence.tx_hash DESC LIMIT 1
			) latest ON true
			WHERE (latest.block_number,latest.log_index,latest.tx_hash)<(${cursorBlock}::bigint,${cursorLog}::integer,${cursorTx})
			ORDER BY latest.block_number DESC,latest.log_index DESC,latest.tx_hash DESC LIMIT ${queryLimit}
		)
		SELECT identity.open_oracle_address, identity.report_id::text AS report_id,
			latest.event_name, latest.block_number::text AS block_number, latest.block_hash, latest.tx_hash, latest.log_index,
			round.report_data, round.round_number::text AS round_number,
			(SELECT count(*) FROM open_oracle_report_events evidence WHERE evidence.chain_id = ${chainId}
				AND evidence.open_oracle_address = identity.open_oracle_address AND evidence.report_id = identity.report_id
				AND evidence.canonical AND evidence.block_number <= ${snapshotBlock}
				AND evidence.event_name IN ('ReportSubmitted', 'ReportDisputed'))::integer AS observed_rounds,
			block.timestamp AS block_timestamp
		FROM candidates identity
		JOIN LATERAL (
			SELECT * FROM open_oracle_report_events evidence WHERE evidence.chain_id = ${chainId}
				AND evidence.open_oracle_address = identity.open_oracle_address AND evidence.report_id = identity.report_id
				AND evidence.canonical AND evidence.block_number <= ${snapshotBlock}
			ORDER BY evidence.block_number DESC, evidence.log_index DESC, evidence.tx_hash DESC LIMIT 1
		) latest ON true
		LEFT JOIN LATERAL (
			SELECT * FROM open_oracle_report_events evidence WHERE evidence.chain_id = ${chainId}
				AND evidence.open_oracle_address = identity.open_oracle_address AND evidence.report_id = identity.report_id
				AND evidence.canonical AND evidence.block_number <= ${snapshotBlock}
				AND evidence.event_name IN ('ReportSubmitted', 'ReportDisputed')
			ORDER BY evidence.block_number DESC, evidence.log_index DESC, evidence.tx_hash DESC LIMIT 1
		) round ON true
		JOIN blocks block ON block.chain_id = ${chainId} AND block.hash = latest.block_hash
		WHERE (latest.block_number, latest.log_index, latest.tx_hash) < (${cursorBlock}::bigint, ${cursorLog}::integer, ${cursorTx})
		ORDER BY latest.block_number DESC, latest.log_index DESC, latest.tx_hash DESC LIMIT ${queryLimit}
	`
	const indexedBlock = String(asOf['blockNumber'] ?? '')
	const indexedTimestamp = String(asOf['blockTimestamp'] ?? '')
	return rows.map((row: Record<string, unknown>) => {
		const data = jsonRecord(row['report_data'])
		const eventName = String(row['event_name'])
		const lifecycle = reportLifecycle({
			eventName: reportLifecycleEventName(eventName),
			flags: typeof data['flags'] === 'string' ? data['flags'] : undefined,
			reportTimestamp: typeof data['reportTimestamp'] === 'string' ? data['reportTimestamp'] : undefined,
			disputeDelay: typeof data['disputeDelay'] === 'string' ? data['disputeDelay'] : undefined,
			settlementTime: typeof data['settlementTime'] === 'string' ? data['settlementTime'] : undefined,
			indexedBlock,
			indexedTimestamp,
		})
		return { ...row, report_data: data, lifecycle }
	})
}

// A game's latest own event is its catalog state. The reporter ledger schedules finality after the game's
// concluding event in the same transaction, so its events are the state only of a game with no event of its own.
export const escalationCatalogData = async (sql: SQL, chainId: number, snapshotBlock: string, cursorBlock = snapshotBlock, cursorTx = `0x${'f'.repeat(64)}`, cursorLog = 2_147_483_647, queryLimit = 250) =>
	await sql`
		WITH games AS (
			SELECT DISTINCT game_address FROM escalation_game_events
			WHERE chain_id = ${chainId} AND canonical AND block_number <= ${snapshotBlock}
		)
		SELECT game.game_address,
			EXISTS (SELECT 1 FROM escalation_game_events conclusion
				WHERE conclusion.chain_id = ${chainId} AND conclusion.game_address = game.game_address
					AND conclusion.canonical AND conclusion.block_number <= ${snapshotBlock}
					AND conclusion.event_name IN ('NonDecisionReached', 'InheritedThresholdTie', 'OrdinarySettlementInitialized')) AS concluded,
			latest.event_name, latest.event_data, latest.block_number::text AS block_number, latest.block_hash, latest.tx_hash, latest.log_index,
			snapshot.read_result->'outcomeBalancesAttoRep'->>0 AS invalid_stake_atto_rep,
			snapshot.read_result->'outcomeBalancesAttoRep'->>1 AS yes_stake_atto_rep,
			snapshot.read_result->'outcomeBalancesAttoRep'->>2 AS no_stake_atto_rep,
			snapshot.block_number::text AS balance_block_number, snapshot.read_status AS balance_read_status
		FROM games game LEFT JOIN LATERAL (
			SELECT state.* FROM entity_state_snapshots state
			JOIN blocks block ON block.chain_id = state.chain_id AND block.hash = state.block_hash AND block.canonical
			WHERE state.chain_id = ${chainId} AND state.entity_type = 'escalation' AND state.entity_identity = game.game_address
				AND state.canonical AND state.block_number <= ${snapshotBlock}
			ORDER BY state.block_number DESC, state.observed_at DESC LIMIT 1
		) snapshot ON true JOIN LATERAL (
			SELECT * FROM escalation_game_events event WHERE event.chain_id = ${chainId} AND event.game_address = game.game_address
				AND event.canonical AND event.block_number <= ${snapshotBlock}
			ORDER BY (event.event_name IN ('GameRegistered', 'ReporterFinalityScheduled')), event.block_number DESC, event.log_index DESC, event.tx_hash DESC LIMIT 1
		) latest ON true WHERE (latest.block_number, latest.log_index, latest.tx_hash) < (${cursorBlock}::bigint, ${cursorLog}::integer, ${cursorTx})
		ORDER BY latest.block_number DESC, latest.log_index DESC, latest.tx_hash DESC LIMIT ${queryLimit}
	`

export const auctionCatalogData = async (sql: SQL, chainId: number, asOf: Record<string, unknown>, cursorBlock = String(asOf['blockNumber']), cursorTx = `0x${'f'.repeat(64)}`, cursorLog = 2_147_483_647, queryLimit = 250) => {
	const snapshotBlock = String(asOf['blockNumber'])
	const rows = await sql`
		WITH auctions AS (
			SELECT DISTINCT auction_address FROM collateral_repair_auction_events
			WHERE chain_id = ${chainId} AND canonical AND block_number <= ${snapshotBlock}
		)
		SELECT auction.auction_address,
			started.event_data AS start_data, finalized.event_data AS final_data,
			latest.event_name, latest.block_number::text AS block_number, latest.block_hash, latest.tx_hash, latest.log_index,
			(SELECT count(*) FROM collateral_repair_auction_events event WHERE event.chain_id = ${chainId}
				AND event.auction_address = auction.auction_address AND event.canonical AND event.block_number <= ${snapshotBlock}
				AND event.event_name = 'BidSubmitted')::integer AS bid_count,
			(SELECT count(DISTINCT event.event_data->>'bidder') FROM collateral_repair_auction_events event WHERE event.chain_id = ${chainId}
				AND event.auction_address = auction.auction_address AND event.canonical AND event.block_number <= ${snapshotBlock}
				AND event.event_name = 'BidSubmitted')::integer AS bidder_count,
			(SELECT count(*) FROM collateral_repair_auction_events event WHERE event.chain_id = ${chainId}
				AND event.auction_address = auction.auction_address AND event.canonical AND event.block_number <= ${snapshotBlock}
				AND event.event_name = 'BidSettled')::integer AS settlement_count
		FROM auctions auction
		JOIN LATERAL (SELECT * FROM collateral_repair_auction_events event WHERE event.chain_id = ${chainId}
			AND event.auction_address = auction.auction_address AND event.canonical AND event.block_number <= ${snapshotBlock}
			ORDER BY event.block_number DESC, event.log_index DESC, event.tx_hash DESC LIMIT 1) latest ON true
		LEFT JOIN LATERAL (SELECT * FROM collateral_repair_auction_events event WHERE event.chain_id = ${chainId}
			AND event.auction_address = auction.auction_address AND event.canonical AND event.block_number <= ${snapshotBlock}
			AND event.event_name = 'RepairAuctionStarted'
			ORDER BY event.block_number DESC, event.log_index DESC, event.tx_hash DESC LIMIT 1) started ON true
		LEFT JOIN LATERAL (SELECT * FROM collateral_repair_auction_events event WHERE event.chain_id = ${chainId}
			AND event.auction_address = auction.auction_address AND event.canonical AND event.block_number <= ${snapshotBlock}
			AND event.event_name = 'RepairAuctionFinalized'
			ORDER BY event.block_number DESC, event.log_index DESC, event.tx_hash DESC LIMIT 1) finalized ON true
		WHERE (latest.block_number, latest.log_index, latest.tx_hash) < (${cursorBlock}::bigint, ${cursorLog}::integer, ${cursorTx})
		ORDER BY latest.block_number DESC, latest.log_index DESC, latest.tx_hash DESC LIMIT ${queryLimit}
	`
	return rows.map((row: Record<string, unknown>) => {
		return {
			...row,
			status: auctionLifecycle({
				started: row['start_data'] !== null,
				finalized: row['final_data'] !== null,
				...auctionStartedWindow(jsonRecord(row['start_data'])),
				indexedTimestamp: String(asOf['blockTimestamp'] ?? ''),
				bidCount: Number(row['bid_count'] ?? 0),
				settlementCount: Number(row['settlement_count'] ?? 0),
			}),
		}
	})
}

export const riskCatalogData = async (sql: SQL, chainId: number, options: { poolAddress?: string | undefined; poolAfter?: string | undefined; limit?: number | undefined; snapshotBlock?: string | undefined } = {}) => {
	const queryLimit = (options.limit ?? 250) + 1
	const snapshotBlock = options.snapshotBlock ?? '9223372036854775807'
	const [pools, totals] = await Promise.all([
		sql`
			WITH identities AS (
				SELECT DISTINCT pool_address FROM pools
				WHERE chain_id = ${chainId} AND canonical AND block_number <= ${snapshotBlock}
			)
			SELECT identity.pool_address, snapshot.block_number::text AS block_number, snapshot.block_hash,
				snapshot.block_timestamp, snapshot.read_status, snapshot.read_result, snapshot.read_failure_reason,
				snapshot.source_method, snapshot.observed_at, snapshot.indexer_run_id::text AS indexer_run_id,
				snapshot.abi_source_hash, snapshot.application_source_hash, snapshot.projection_source_hash
			FROM identities identity LEFT JOIN LATERAL (
				SELECT state.* FROM entity_state_snapshots state
				JOIN blocks block ON block.chain_id = state.chain_id AND block.hash = state.block_hash AND block.canonical
				WHERE state.chain_id = ${chainId} AND state.entity_type = 'pool'
					AND state.entity_identity = identity.pool_address AND state.canonical AND state.block_number <= ${snapshotBlock}
				ORDER BY state.block_number DESC, state.observed_at DESC LIMIT 1
			) snapshot ON true
			WHERE (${options.poolAddress ?? null}::text IS NULL OR identity.pool_address = ${options.poolAddress ?? null})
				AND (${options.poolAfter ?? null}::text IS NULL OR identity.pool_address > ${options.poolAfter ?? null})
			ORDER BY identity.pool_address LIMIT ${queryLimit}
		`,
		sql`
			SELECT count(DISTINCT pool_address)::integer AS pool_total FROM pools
			WHERE chain_id = ${chainId} AND canonical AND block_number <= ${snapshotBlock}
				AND (${options.poolAddress ?? null}::text IS NULL OR pool_address = ${options.poolAddress ?? null})
		`,
	])
	const poolData = pools.slice(0, options.limit ?? 250).map((row: Record<string, unknown>) => {
		const state = jsonRecord(row['read_result'])
		if (row['read_status'] !== 'success')
			return {
				...row,
				protocol_state: 'unavailable',
				scanner_severity: 'unavailable',
				scanner_reason: row['read_failure_reason'] ?? 'Current tagged pool read is awaiting completion',
			}
		return {
			...row,
			read_result: state,
			price_provenance: jsonRecord(state['price']),
			protocol_state: String(state['systemState'] ?? 'unavailable'),
			scanner_severity: 'unavailable',
			scanner_reason: 'Question settlement is shown here. Underwriting risk belongs to the shared security pool capital positions.',
		}
	})
	const lastPool = poolData.at(-1)
	return {
		pools: poolData,
		pagination: {
			poolTotal: Number(totals[0]?.['pool_total'] ?? 0),
			poolHasMore: pools.length > (options.limit ?? 250),
			poolNextCursor: pools.length > (options.limit ?? 250) && lastPool !== undefined ? String(lastPool['pool_address']) : undefined,
		},
	}
}

export const forkCatalogTotal = async (sql: SQL, chainId: number, snapshotBlock: string): Promise<number> => {
	const rows = await sql`
		SELECT count(DISTINCT universe_identity)::integer AS total
		FROM fork_migration_events
		WHERE chain_id = ${chainId} AND canonical AND event_name = 'UniverseForked'
			AND event_data ? 'universeId' AND block_number <= ${snapshotBlock}
	`
	return Number(rows[0]?.['total'] ?? 0)
}

// Security pool fork events name the forked universe (ForkFrozen, BranchChosen, NeutralCashRecovered, ReporterForkFrozen,
// and ReporterChildCreated as sourceUniverseId) or one of its child universes (BranchStarted, BranchActivated).
// A child's start and activation belong to its parent's fork, so they join only through the child's universe
// record and never through their own universeId.
export const forkCatalogData = async (sql: SQL, { chainId, snapshotBlock, position, limit = 100 }: { chainId: number; snapshotBlock: string; position?: { block: string; tx: string; log: number } | undefined; limit?: number }) => {
	const { block, tx, log } = position ?? { block: snapshotBlock, tx: `0x${'f'.repeat(64)}`, log: 2_147_483_647 }
	return await sql`
		WITH roots AS (
			SELECT DISTINCT ON (universe_identity) * FROM fork_migration_events
			WHERE chain_id = ${chainId} AND canonical AND event_name = 'UniverseForked'
				AND event_data ? 'universeId' AND block_number <= ${snapshotBlock}
			ORDER BY universe_identity, block_number DESC, log_index DESC
		)
		SELECT root.universe_identity, root.event_name, root.event_data,
			root.block_number::text, root.block_hash, root.tx_hash, root.log_index,
			count(DISTINCT related.event_data->>'childUniverseId') FILTER (WHERE related.event_data ? 'childUniverseId')::integer AS child_count,
			count(DISTINCT related.event_data->>'migrator') FILTER (WHERE related.event_data ? 'migrator')::integer AS migrator_count,
			COALESCE(sum((related.event_data->>'amountAttoRep')::numeric) FILTER
				(WHERE related.event_name = 'MigrationRepSplit' AND related.event_data ? 'amountAttoRep'), 0)::text AS migrated_atto_rep,
			${forkBurns(sql, snapshotBlock)} AS burned_atto_rep,
			count(*) FILTER (WHERE related.event_name IN ('ForkFrozen', 'BranchChosen', 'BranchStarted', 'BranchActivated', 'NeutralCashRecovered', 'ReporterForkFrozen', 'ReporterChildCreated'))::integer AS portfolio_fork_events
		FROM roots root
		LEFT JOIN fork_migration_events related ON related.chain_id = root.chain_id AND related.canonical
			AND related.block_number <= ${snapshotBlock} AND (
			(related.event_name NOT IN ('BranchStarted', 'BranchActivated')
				AND (related.universe_identity = root.universe_identity OR related.event_data->>'universeId' = root.universe_identity
					OR related.event_data->>'sourceUniverseId' = root.universe_identity))
			OR (related.event_name IN ('BranchStarted', 'BranchActivated') AND EXISTS (
				SELECT 1 FROM universe_events child WHERE child.chain_id = root.chain_id AND child.canonical
					AND child.block_number <= ${snapshotBlock} AND child.parent_universe_id::text = root.universe_identity
					AND child.universe_id <> child.parent_universe_id AND child.universe_id::text = related.event_data->>'universeId'))
		)
		WHERE (root.block_number, root.log_index, root.tx_hash) < (${block}::bigint, ${log}::integer, ${tx})
		GROUP BY root.chain_id, root.universe_identity, root.event_name, root.event_data, root.block_number,
			root.block_hash, root.tx_hash, root.log_index
		ORDER BY root.block_number DESC, root.log_index DESC, root.tx_hash DESC LIMIT ${limit}
	`
}
