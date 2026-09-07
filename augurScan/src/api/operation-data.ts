import type { SQL } from 'bun'
import { auctionLifecycle, ESCALATION_OUTCOME, poolCapacity, reportLifecycle, vaultRisk } from '../operations.ts'
import { snapshotBoundaryMatches } from './entity-details.ts'
import { ApiConflictError, ApiRequestError, jsonRecord, postgresBigint } from './shared.ts'

export const operationsAsOf = async (sql: SQL, chainId: number, atBlock?: string): Promise<Record<string, unknown>> => {
	const rows =
		atBlock === undefined
			? await sql`
				SELECT indexed_block::text AS "blockNumber", indexed_hash AS "blockHash",
					EXTRACT(EPOCH FROM indexed_timestamp)::bigint::text AS "blockTimestamp",
					indexed_block::text AS "indexedHead", '0'::text AS "historyDepthBlocks",
					observed_block::text AS "observedHead",
					GREATEST(COALESCE(observed_block, indexed_block, 0) - COALESCE(indexed_block, observed_block, 0), 0)::text AS "lagBlocks",
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
		blockHash: row['blockHash'] ?? `0x${'0'.repeat(64)}`,
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

export const operationsAsOfFromUrl = async (sql: SQL, chainId: number, url: URL): Promise<Record<string, unknown>> =>
	await operationsAsOf(sql, chainId, postgresBigint(url.searchParams.get('atBlock'), 'atBlock'))

export type SnapshotCursorReference = { readonly parts: readonly unknown[]; readonly offset: number }

export const operationsAsOfForContinuations = async (
	sql: SQL,
	chainId: number,
	cursors: readonly SnapshotCursorReference[],
	requestedAtBlock?: string,
): Promise<Record<string, unknown>> => {
	const first = cursors[0]
	const cursorBlock = first === undefined ? undefined : first.parts[first.offset]
	if (cursorBlock !== undefined && typeof cursorBlock !== 'string') throw new ApiRequestError('cursor snapshot block is invalid')
	if (requestedAtBlock !== undefined && cursorBlock !== undefined && requestedAtBlock !== cursorBlock)
		throw new ApiRequestError('cursor does not match the requested snapshot block')
	let asOf: Record<string, unknown>
	try {
		asOf = await operationsAsOf(sql, chainId, requestedAtBlock ?? cursorBlock)
	} catch (error) {
		if (cursorBlock !== undefined && error instanceof ApiRequestError && error.message === 'atBlock is outside retained canonical coverage')
			throw new ApiConflictError('Indexed state changed; restart pagination')
		throw error
	}
	for (const cursor of cursors)
		if (!snapshotBoundaryMatches(cursor.parts, cursor.offset, asOf)) throw new ApiConflictError('Indexed state changed; restart pagination')
	return asOf
}

export const reportCatalogData = async (
	sql: SQL,
	chainId: number,
	asOf: Record<string, unknown>,
	cursorBlock = String(asOf['blockNumber']),
	cursorTx = `0x${'f'.repeat(64)}`,
	cursorLog = 2_147_483_647,
	queryLimit = 250,
) => {
	const snapshotBlock = String(asOf['blockNumber'])
	const rows = await sql`
		WITH identities AS (
			SELECT DISTINCT open_oracle_address, report_id FROM open_oracle_report_events
			WHERE chain_id = ${chainId} AND canonical AND block_number <= ${snapshotBlock}
		)
		SELECT identity.open_oracle_address, identity.report_id::text AS report_id,
			latest.event_name, latest.block_number::text AS block_number, latest.block_hash, latest.tx_hash, latest.log_index,
			round.report_data, round.round_number::text AS round_number,
			(SELECT count(*) FROM open_oracle_report_events evidence WHERE evidence.chain_id = ${chainId}
				AND evidence.open_oracle_address = identity.open_oracle_address AND evidence.report_id = identity.report_id
				AND evidence.canonical AND evidence.block_number <= ${snapshotBlock}
				AND evidence.event_name IN ('ReportSubmitted', 'ReportDisputed'))::integer AS observed_rounds,
			block.timestamp AS block_timestamp
		FROM identities identity
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
			eventName: eventName === 'ReportSettled' ? 'ReportSettled' : eventName === 'ReportDisputed' ? 'ReportDisputed' : 'ReportSubmitted',
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

export const escalationCatalogData = async (
	sql: SQL,
	chainId: number,
	snapshotBlock: string,
	cursorBlock = snapshotBlock,
	cursorTx = `0x${'f'.repeat(64)}`,
	cursorLog = 2_147_483_647,
	queryLimit = 250,
) =>
	await sql`
		WITH games AS (
			SELECT DISTINCT game_address FROM escalation_game_events
			WHERE chain_id = ${chainId} AND canonical AND block_number <= ${snapshotBlock}
		)
		SELECT game.game_address,
			latest.event_name, latest.event_data, latest.block_number::text AS block_number, latest.block_hash, latest.tx_hash, latest.log_index,
			COALESCE((SELECT sum((event_data->>'attoRepAmount')::numeric)::text FROM escalation_game_events event
				WHERE event.chain_id = ${chainId} AND event.game_address = game.game_address AND event.canonical
				AND event.block_number <= ${snapshotBlock}
				AND event.event_name = 'DepositOnOutcome' AND event.event_data->>'outcome' = ${ESCALATION_OUTCOME.invalid}), '0') AS invalid_stake_atto_rep,
			COALESCE((SELECT sum((event_data->>'attoRepAmount')::numeric)::text FROM escalation_game_events event
				WHERE event.chain_id = ${chainId} AND event.game_address = game.game_address AND event.canonical
				AND event.block_number <= ${snapshotBlock}
				AND event.event_name = 'DepositOnOutcome' AND event.event_data->>'outcome' = ${ESCALATION_OUTCOME.no}), '0') AS no_stake_atto_rep,
			COALESCE((SELECT sum((event_data->>'attoRepAmount')::numeric)::text FROM escalation_game_events event
				WHERE event.chain_id = ${chainId} AND event.game_address = game.game_address AND event.canonical
				AND event.block_number <= ${snapshotBlock}
				AND event.event_name = 'DepositOnOutcome' AND event.event_data->>'outcome' = ${ESCALATION_OUTCOME.yes}), '0') AS yes_stake_atto_rep
		FROM games game JOIN LATERAL (
			SELECT * FROM escalation_game_events event WHERE event.chain_id = ${chainId} AND event.game_address = game.game_address
				AND event.canonical AND event.block_number <= ${snapshotBlock}
			ORDER BY event.block_number DESC, event.log_index DESC, event.tx_hash DESC LIMIT 1
		) latest ON true WHERE (latest.block_number, latest.log_index, latest.tx_hash) < (${cursorBlock}::bigint, ${cursorLog}::integer, ${cursorTx})
		ORDER BY latest.block_number DESC, latest.log_index DESC, latest.tx_hash DESC LIMIT ${queryLimit}
	`

export const auctionCatalogData = async (
	sql: SQL,
	chainId: number,
	asOf: Record<string, unknown>,
	cursorBlock = String(asOf['blockNumber']),
	cursorTx = `0x${'f'.repeat(64)}`,
	cursorLog = 2_147_483_647,
	queryLimit = 250,
) => {
	const snapshotBlock = String(asOf['blockNumber'])
	const rows = await sql`
		WITH auctions AS (
			SELECT DISTINCT auction_address FROM truth_auction_events
			WHERE chain_id = ${chainId} AND canonical AND block_number <= ${snapshotBlock}
		)
		SELECT auction.auction_address,
			started.event_data AS start_data, finalized.event_data AS final_data,
			latest.event_name, latest.block_number::text AS block_number, latest.block_hash, latest.tx_hash, latest.log_index,
			(SELECT count(*) FROM truth_auction_events event WHERE event.chain_id = ${chainId}
				AND event.auction_address = auction.auction_address AND event.canonical AND event.block_number <= ${snapshotBlock}
				AND event.event_name = 'BidSubmitted')::integer AS bid_count,
			(SELECT count(DISTINCT event.event_data->>'bidder') FROM truth_auction_events event WHERE event.chain_id = ${chainId}
				AND event.auction_address = auction.auction_address AND event.canonical AND event.block_number <= ${snapshotBlock}
				AND event.event_name = 'BidSubmitted')::integer AS bidder_count,
			(SELECT count(*) FROM truth_auction_events event WHERE event.chain_id = ${chainId}
				AND event.auction_address = auction.auction_address AND event.canonical AND event.block_number <= ${snapshotBlock}
				AND event.event_name = 'BidSettled')::integer AS settlement_count
		FROM auctions auction
		JOIN LATERAL (SELECT * FROM truth_auction_events event WHERE event.chain_id = ${chainId}
			AND event.auction_address = auction.auction_address AND event.canonical AND event.block_number <= ${snapshotBlock}
			ORDER BY event.block_number DESC, event.log_index DESC, event.tx_hash DESC LIMIT 1) latest ON true
		LEFT JOIN LATERAL (SELECT * FROM truth_auction_events event WHERE event.chain_id = ${chainId}
			AND event.auction_address = auction.auction_address AND event.canonical AND event.block_number <= ${snapshotBlock}
			AND event.event_name = 'AuctionStarted'
			ORDER BY event.block_number DESC, event.log_index DESC, event.tx_hash DESC LIMIT 1) started ON true
		LEFT JOIN LATERAL (SELECT * FROM truth_auction_events event WHERE event.chain_id = ${chainId}
			AND event.auction_address = auction.auction_address AND event.canonical AND event.block_number <= ${snapshotBlock}
			AND event.event_name = 'AuctionFinalized'
			ORDER BY event.block_number DESC, event.log_index DESC, event.tx_hash DESC LIMIT 1) finalized ON true
		WHERE (latest.block_number, latest.log_index, latest.tx_hash) < (${cursorBlock}::bigint, ${cursorLog}::integer, ${cursorTx})
		ORDER BY latest.block_number DESC, latest.log_index DESC, latest.tx_hash DESC LIMIT ${queryLimit}
	`
	return rows.map((row: Record<string, unknown>) => {
		const startData = jsonRecord(row['start_data'])
		return {
			...row,
			status: auctionLifecycle({
				started: row['start_data'] !== null,
				finalized: row['final_data'] !== null,
				startTimestamp: typeof startData['startTimestamp'] === 'string' ? startData['startTimestamp'] : undefined,
				endTimestamp: typeof startData['endTimestamp'] === 'string' ? startData['endTimestamp'] : undefined,
				indexedTimestamp: String(asOf['blockTimestamp'] ?? ''),
				bidCount: Number(row['bid_count'] ?? 0),
				settlementCount: Number(row['settlement_count'] ?? 0),
			}),
		}
	})
}

export const riskCatalogData = async (
	sql: SQL,
	chainId: number,
	options: { poolAddress?: string; vaultAddress?: string; poolAfter?: string; vaultAfter?: string; limit?: number; snapshotBlock?: string } = {},
) => {
	const queryLimit = (options.limit ?? 250) + 1
	const snapshotBlock = options.snapshotBlock ?? '9223372036854775807'
	const [pools, vaults, liquidations, approvalEvents, totals] = await Promise.all([
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
			WITH identities AS (
				SELECT DISTINCT pool_address, vault_address FROM vault_snapshots
				WHERE chain_id = ${chainId} AND canonical AND block_number <= ${snapshotBlock}
			)
			SELECT identity.pool_address, identity.vault_address,
				vault.block_number::text AS block_number, vault.block_hash, vault.block_timestamp,
				vault.read_status, vault.read_result, vault.read_failure_reason, vault.source_method, vault.observed_at,
				vault.indexer_run_id::text AS indexer_run_id, vault.abi_source_hash,
				vault.application_source_hash, vault.projection_source_hash,
				pool.read_result AS pool_read_result, pool.read_status AS pool_read_status,
				pool.block_number::text AS pool_block_number, pool.block_hash AS pool_block_hash,
				pool.block_timestamp AS pool_block_timestamp, pool.indexer_run_id::text AS pool_indexer_run_id,
				pool.abi_source_hash AS pool_abi_source_hash, pool.application_source_hash AS pool_application_source_hash,
				pool.projection_source_hash AS pool_projection_source_hash
			FROM identities identity
			LEFT JOIN LATERAL (
				SELECT state.* FROM entity_state_snapshots state
				JOIN blocks block ON block.chain_id = state.chain_id AND block.hash = state.block_hash AND block.canonical
				WHERE state.chain_id = ${chainId} AND state.entity_type = 'vault'
					AND state.entity_identity = identity.pool_address || ':' || identity.vault_address
					AND state.canonical AND state.block_number <= ${snapshotBlock}
				ORDER BY state.block_number DESC, state.observed_at DESC LIMIT 1
			) vault ON true
			LEFT JOIN LATERAL (
				SELECT state.* FROM entity_state_snapshots state
				JOIN blocks block ON block.chain_id = state.chain_id AND block.hash = state.block_hash AND block.canonical
				WHERE state.chain_id = ${chainId} AND state.entity_type = 'pool'
					AND state.entity_identity = identity.pool_address AND state.canonical AND state.block_number <= ${snapshotBlock}
				ORDER BY state.block_number DESC, state.observed_at DESC LIMIT 1
			) pool ON true
			WHERE (${options.poolAddress ?? null}::text IS NULL OR identity.pool_address = ${options.poolAddress ?? null})
				AND (${options.vaultAddress ?? null}::text IS NULL OR identity.vault_address = ${options.vaultAddress ?? null})
				AND (${options.vaultAfter ?? null}::text IS NULL OR identity.pool_address || ':' || identity.vault_address > ${options.vaultAfter ?? null})
			ORDER BY identity.pool_address, identity.vault_address LIMIT ${queryLimit}
		`,
		sql`SELECT * FROM protocol_timeline_entries WHERE chain_id = ${chainId} AND canonical
			AND semantic_event_kind = 'VaultLiquidated' AND block_number <= ${snapshotBlock}
			ORDER BY block_number DESC, log_index DESC, tx_hash DESC, block_hash DESC LIMIT 25`,
		sql`
			SELECT approval.*, COALESCE(approval.receiver_vault, installed.receiver_vault) AS receiver_vault,
				block.timestamp AS block_timestamp
			FROM liquidation_approval_events approval
			JOIN blocks block ON block.chain_id = approval.chain_id AND block.hash = approval.block_hash AND block.canonical
			LEFT JOIN LATERAL (
				SELECT candidate.receiver_vault, candidate.event_data FROM liquidation_approval_events candidate
				WHERE candidate.chain_id = approval.chain_id AND candidate.approval_identity = approval.approval_identity
					AND candidate.registry_address = approval.registry_address
					AND candidate.event_name = 'LiquidationApprovalSet' AND candidate.canonical
					AND candidate.block_number <= ${snapshotBlock}
				ORDER BY candidate.block_number DESC, candidate.transaction_index DESC, candidate.log_index DESC,
					candidate.tx_hash DESC, candidate.block_hash DESC LIMIT 1
			) installed ON true
			WHERE approval.chain_id = ${chainId} AND approval.canonical AND approval.block_number <= ${snapshotBlock}
				AND (${options.poolAddress ?? null}::text IS NULL OR COALESCE(approval.event_data->>'securityPool', installed.event_data->>'securityPool') = ${options.poolAddress ?? null})
				AND (${options.vaultAddress ?? null}::text IS NULL OR COALESCE(approval.receiver_vault, installed.receiver_vault) = ${options.vaultAddress ?? null}
					OR COALESCE(approval.event_data->>'targetVault', installed.event_data->>'targetVault') = ${options.vaultAddress ?? null})
			ORDER BY approval.block_number DESC, approval.transaction_index DESC, approval.log_index DESC,
				approval.tx_hash DESC, approval.block_hash DESC, approval.registry_address DESC LIMIT 100
		`,
		sql`
			SELECT
				(SELECT count(DISTINCT pool_address) FROM pools
					WHERE chain_id = ${chainId} AND canonical AND block_number <= ${snapshotBlock}
						AND (${options.poolAddress ?? null}::text IS NULL OR pool_address = ${options.poolAddress ?? null}))::integer AS pool_total,
				(SELECT count(*) FROM (
					SELECT DISTINCT pool_address, vault_address FROM vault_snapshots
					WHERE chain_id = ${chainId} AND canonical AND block_number <= ${snapshotBlock}
						AND (${options.poolAddress ?? null}::text IS NULL OR pool_address = ${options.poolAddress ?? null})
						AND (${options.vaultAddress ?? null}::text IS NULL OR vault_address = ${options.vaultAddress ?? null})
				) identities)::integer AS vault_total
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
		const capacity = poolCapacity(String(state['settlementCollateralAttoEth']), String(state['currentMintingCapacityAttoEth']))
		const badDebt = BigInt(String(state['totalBadDebtAttoEth'] ?? '0'))
		const price = jsonRecord(state['price'])
		const priceRequired = BigInt(String(state['settlementCollateralAttoEth'] ?? '0')) > 0n || BigInt(String(state['currentMintingCapacityAttoEth'] ?? '0')) > 0n
		const priceValid = price['protocolValid'] === true
		return {
			...row,
			read_result: state,
			capacity,
			price_provenance: price,
			protocol_state: badDebt > 0n ? 'bad-debt' : priceRequired && !priceValid ? 'unavailable' : String(state['systemState'] ?? '0'),
			scanner_severity: badDebt > 0n ? 'critical' : priceRequired && !priceValid ? 'unavailable' : 'healthy',
			scanner_reason:
				badDebt > 0n
					? 'Pool has recorded bad debt'
					: priceRequired && !priceValid
						? 'Accounting price is invalid at the tagged evidence block; capacity is not usable for risk decisions'
						: 'Tagged pool accounting read completed',
		}
	})
	const vaultData = vaults.slice(0, options.limit ?? 250).map((row: Record<string, unknown>) => {
		const state = jsonRecord(row['read_result'])
		const poolState = jsonRecord(row['pool_read_result'])
		const price = jsonRecord(poolState['price'])
		const snapshotEvidence = {
			vaultSnapshot: { blockNumber: row['block_number'], blockHash: row['block_hash'], blockTimestamp: row['block_timestamp'] },
			poolSnapshot: { blockNumber: row['pool_block_number'], blockHash: row['pool_block_hash'], blockTimestamp: row['pool_block_timestamp'] },
		}
		if (row['read_status'] !== 'success' || row['pool_read_status'] !== 'success' || row['block_hash'] !== row['pool_block_hash'])
			return {
				...row,
				snapshot_evidence: snapshotEvidence,
				protocol_state: 'unavailable',
				scanner_severity: 'unavailable',
				scanner_reason:
					row['read_failure_reason'] ??
					(row['read_status'] === 'success' && row['pool_read_status'] === 'success'
						? 'Vault and pool tagged reads have different evidence blocks; coherent risk state is awaiting completion'
						: 'Coherent tagged vault and pool reads are awaiting completion'),
			}
		const badDebt = BigInt(String(state['badDebtAttoEth'] ?? '0'))
		if (badDebt > 0n)
			return {
				...row,
				read_result: state,
				price_provenance: price,
				snapshot_evidence: snapshotEvidence,
				protocol_state: 'bad-debt',
				scanner_severity: 'critical',
				scanner_reason: 'Vault has recorded bad debt',
			}
		if (BigInt(String(state['openInterestAttoEth'] ?? '0')) > 0n && price['protocolValid'] !== true)
			return {
				...row,
				read_result: state,
				price_provenance: price,
				snapshot_evidence: snapshotEvidence,
				protocol_state: 'unavailable',
				scanner_severity: 'unavailable',
				scanner_reason: 'Vault health is unavailable because its nonzero open interest depends on an invalid accounting price',
			}
		const risk = vaultRisk({
			poolHeldBackingAttoRep: String(state['poolHeldBackingAttoRep']),
			disputeStakedAttoRep: String(state['disputeStakedAttoRep']),
			openInterestAttoEth: String(state['openInterestAttoEth']),
			repPerEth1e18: String(price['repPerEth1e18'] ?? '0'),
			securityMultiplierBps: String(state['securityMultiplierBps']),
			targetHealthFactorBps: String(state['targetHealthFactorBps']),
			badDebtAttoEth: String(state['badDebtAttoEth']),
		})
		return {
			...row,
			read_result: state,
			snapshot_evidence: snapshotEvidence,
			risk,
			protocol_state: risk.protocolState,
			scanner_severity: risk.scannerSeverity,
			scanner_reason: risk.scannerReason,
		}
	})
	const lastPool = poolData.at(-1)
	const lastVault = vaultData.at(-1)
	return {
		pools: poolData,
		vaults: vaultData,
		recentLiquidations: liquidations,
		approvalEvents,
		pagination: {
			poolTotal: Number(totals[0]?.['pool_total'] ?? 0),
			poolHasMore: pools.length > (options.limit ?? 250),
			poolNextCursor: pools.length > (options.limit ?? 250) && lastPool !== undefined ? String(lastPool['pool_address']) : undefined,
			vaultTotal: Number(totals[0]?.['vault_total'] ?? 0),
			vaultHasMore: vaults.length > (options.limit ?? 250),
			vaultNextCursor:
				vaults.length > (options.limit ?? 250) && lastVault !== undefined
					? `${String(lastVault['pool_address'])}:${String(lastVault['vault_address'])}`
					: undefined,
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

export const forkCatalogData = async (
	sql: SQL,
	chainId: number,
	cursorBlock: string,
	cursorTx = `0x${'f'.repeat(64)}`,
	cursorLog = 2_147_483_647,
	queryLimit = 100,
	snapshotBlock = cursorBlock,
) =>
	await sql`
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
			COALESCE(sum((related.event_data->>'amountAttoRep')::numeric) FILTER
				(WHERE related.event_name = 'RepBurned' AND related.event_data ? 'amountAttoRep'), 0)::text AS burned_atto_rep,
			count(*) FILTER (WHERE related.event_name IN ('SecurityPoolForkSnapshot', 'ChildPoolLinked', 'PoolHeldRepSweptToChild', 'VaultMigrationCheckpoint'))::integer AS pool_migration_events,
			count(*) FILTER (WHERE related.event_name IN ('EscalationMigrationEntitlementInitialized', 'EscalationMigrationEntitlementMaterialized'))::integer AS obligation_events
		FROM roots root
		LEFT JOIN fork_migration_events related ON related.chain_id = root.chain_id AND related.canonical
			AND related.block_number <= ${snapshotBlock} AND (
			related.universe_identity = root.universe_identity OR related.event_data->>'universeId' = root.universe_identity
			OR EXISTS (SELECT 1 FROM pools pool WHERE pool.chain_id = root.chain_id AND pool.canonical
				AND pool.block_number <= ${snapshotBlock}
				AND pool.universe_id::text = root.universe_identity
				AND (related.universe_identity = pool.pool_address OR related.event_data->>'parent' = pool.pool_address
					OR related.event_data->>'parentPool' = pool.pool_address OR related.event_data->>'securityPool' = pool.pool_address))
		)
		WHERE (root.block_number, root.log_index, root.tx_hash) < (${cursorBlock}::bigint, ${cursorLog}::integer, ${cursorTx})
		GROUP BY root.chain_id, root.universe_identity, root.event_name, root.event_data, root.block_number,
			root.block_hash, root.tx_hash, root.log_index
		ORDER BY root.block_number DESC, root.log_index DESC, root.tx_hash DESC LIMIT ${queryLimit}
	`
