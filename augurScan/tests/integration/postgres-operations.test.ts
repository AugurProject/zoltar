import { expect } from 'bun:test'
import { handleApi } from '../../src/api.ts'
import { ScannerDatabase } from '../../src/database.ts'
import { getAddress } from '../../src/ethereum.ts'
import { initializeSchema } from '../../src/schema.ts'
import type { NetworkConfig } from '../../src/types.ts'
import { type OperationsContext, seedBulkTradingHistory, seedRiskAndPortfolioEvidence, storeOperationsEvidenceBlock } from '../support/operations-fixtures.ts'
import { expectQuestionHistoryCursors, expectReportCatalogGenerations, expectReportDetailPagination, expectRiskAndForkCatalogs, expectTimelinePagination, expectTradingAndPortfolioPagination, expectUnicodeTradingPagination } from '../support/operations-stages.ts'
import { address, blockHash, chainId, discoveredAddress, postgresTest, requirePostgresUrl } from '../support/postgres-fixtures.ts'

const uniswapOnlyMarket = getAddress('0x9999999999999999999999999999999999999999').toLowerCase()

const expectAwaitingOperations = async ({ database, operationsChainId, network }: OperationsContext): Promise<void> => {
	await initializeSchema(database.sql)
	const schemaState = await database.sql`
				SELECT
					(SELECT count(*)::integer FROM live_event_state WHERE singleton AND pruned_through_id = 0) AS live_state_count,
					current_setting('search_path') AS search_path
			`
	expect(schemaState[0]).toMatchObject({ live_state_count: 1, search_path: '"$user", public' })
	await database.seedNetwork(network)
	const awaitingResponse = await handleApi(new Request(`http://localhost/api/v1/operations?chainId=${operationsChainId}`), database.sql)
	if (awaitingResponse === undefined) throw new Error('awaiting operations endpoint did not return a response')
	expect(awaitingResponse.status).toBe(200)
	expect(await awaitingResponse.json()).toMatchObject({
		asOf: { blockNumber: '0', blockTimestamp: '0', availability: 'Awaiting indexed evidence' },
		data: { reports: [], escalations: [], auctions: [] },
	})
}

// The trading observation window starts seven days before the head, and Uniswap-only markets are not AMM markets.
const expectTradingObservationBoundary = async ({ database, operationsChainId, oracle }: OperationsContext): Promise<void> => {
	await database.sql`DELETE FROM amm_trade_events WHERE chain_id = ${operationsChainId} AND block_number IN (2, 3)`
	await database.sql`
			INSERT INTO blocks (chain_id, number, hash, parent_hash, timestamp, canonical, finalized)
			VALUES (${operationsChainId}, 0, ${`0x${'f'.repeat(64)}`}, ${`0x${'e'.repeat(64)}`},
				timestamptz '2025-12-24 23:59:59+00', true, true)
		`
	await database.sql`
			INSERT INTO transactions (
				chain_id, hash, block_hash, block_number, transaction_index, from_address, to_address,
				value, input, status, gas_used, receipt, canonical
			) VALUES (${operationsChainId}, ${`0x${'d'.repeat(64)}`}, ${`0x${'f'.repeat(64)}`}, 0, 0,
				${address.toLowerCase()}, ${oracle.toLowerCase()}, 0, '0x', 'success', 21000, '{}'::jsonb, true)
		`
	await database.sql`
			INSERT INTO logs (
				chain_id, tx_hash, block_hash, block_number, transaction_index, log_index, emitter_address,
				topics, data, event_name, arguments, argument_schema, decode_status, summary, canonical, finalized
			) VALUES (${operationsChainId}, ${`0x${'d'.repeat(64)}`}, ${`0x${'f'.repeat(64)}`}, 0, 0, 0,
				${oracle.toLowerCase()}, '[]'::jsonb, '0x', 'Swap', '{}'::jsonb, '[]'::jsonb, 'decoded', 'Swap', true, true)
		`
	await database.sql`
			INSERT INTO amm_trade_events (
				chain_id, block_hash, tx_hash, log_index, block_number, market_address, event_name, event_data, canonical
			) VALUES (${operationsChainId}, ${`0x${'f'.repeat(64)}`}, ${`0x${'d'.repeat(64)}`}, 0, 0,
				${oracle.toLowerCase()}, 'Swap',
				jsonb_build_object('yesForNo', true, 'amountIn', '1', 'amountOut', '1', 'feeAmount', '1',
					'resultingYesReserve', '1', 'resultingNoReserve', '2'), true)
		`
	const boundaryResponse = await handleApi(new Request(`http://localhost/api/v1/state/trading/${operationsChainId}/${oracle.toLowerCase()}`), database.sql)
	if (boundaryResponse === undefined) throw new Error('boundary trading endpoint did not return a response')
	const boundary = (await boundaryResponse.json()) as {
		data: { summary: { swaps_7d: number }; observationsTruncated: boolean; observationRange: { firstTimestamp: string; count: number } }
	}
	expect(boundary.data).toMatchObject({
		summary: { swaps_7d: 10000 },
		observationsTruncated: false,
		observationRange: { firstTimestamp: '1767225624', count: 10000 },
	})

	await database.sql`
				INSERT INTO amm_trade_events (
					chain_id, block_hash, tx_hash, log_index, block_number, market_address, event_name, event_data, canonical
				) VALUES (${operationsChainId}, ${`0x${'f'.repeat(64)}`}, ${`0x${'d'.repeat(64)}`}, 0, 0,
					${uniswapOnlyMarket}, 'Swap', jsonb_build_object('sqrtPriceX96', '79228162514264337593543950336', 'liquidity', '100'), true)
			`
	const uniswapOnlyResponse = await handleApi(new Request(`http://localhost/api/v1/state/trading/${operationsChainId}/${uniswapOnlyMarket}`), database.sql)
	expect(uniswapOnlyResponse?.status).toBe(404)

	const uniswapSyncOnlyMarket = getAddress('0x9999999999999999999999999999999999999998').toLowerCase()
	await database.sql`
				INSERT INTO amm_trade_events (
					chain_id, block_hash, tx_hash, log_index, block_number, market_address, event_name, event_data, canonical
				) VALUES (${operationsChainId}, ${`0x${'f'.repeat(64)}`}, ${`0x${'d'.repeat(64)}`}, 0, 0,
					${uniswapSyncOnlyMarket}, 'Sync', jsonb_build_object('reserve0', '300', 'reserve1', '700'), true)
			`
	await database.sql`
				INSERT INTO protocol_timeline_entries (
					chain_id, block_hash, tx_hash, log_index, block_number, entity_type, entity_identity,
					semantic_event_kind, summary_data, related_entities, source_contract, source_event, canonical
				) VALUES
					(${operationsChainId}, ${`0x${'f'.repeat(64)}`}, ${`0x${'d'.repeat(64)}`}, 0, 0, 'trading', ${uniswapSyncOnlyMarket},
						'Sync', jsonb_build_object('reserve0', '300', 'reserve1', '700'), '[]'::jsonb, ${uniswapSyncOnlyMarket}, 'Sync', true),
					(${operationsChainId}, ${`0x${'f'.repeat(64)}`}, ${`0x${'d'.repeat(64)}`}, 0, 0, 'amm', ${uniswapOnlyMarket},
						'Swap', jsonb_build_object('sqrtPriceX96', '79228162514264337593543950336'), '[]'::jsonb, ${uniswapOnlyMarket}, 'Swap', true)
			`
	const uniswapSyncOnlyResponse = await handleApi(new Request(`http://localhost/api/v1/state/trading/${operationsChainId}/${uniswapSyncOnlyMarket}`), database.sql)
	expect(uniswapSyncOnlyResponse?.status).toBe(404)
	await database.sql`
				DELETE FROM protocol_timeline_entries WHERE chain_id = ${operationsChainId}
					AND entity_identity IN (${uniswapOnlyMarket}, ${uniswapSyncOnlyMarket})
			`
	await database.sql`
				DELETE FROM amm_trade_events WHERE chain_id = ${operationsChainId}
					AND market_address IN (${uniswapOnlyMarket}, ${uniswapSyncOnlyMarket})
			`
}

// Approval evidence is bounded to 100 rows and filtered to the vault's own security pool.
const expectBoundedApprovalsAndRisk = async ({ database, operationsChainId, oracle, hash }: OperationsContext): Promise<void> => {
	await database.sql`
				INSERT INTO liquidation_approval_events (
					chain_id, block_hash, tx_hash, transaction_index, log_index, block_number, registry_address,
					approval_identity, receiver_vault, event_name, event_data, canonical
				)
				SELECT ${operationsChainId}, '0x' || lpad(to_hex(item), 64, '0'),
					'0x' || lpad(to_hex(item + 20000), 64, '0'), 0, 0, item, ${oracle.toLowerCase()},
					'0x' || lpad(to_hex(item), 64, '0'), ${address.toLowerCase()}::text, 'LiquidationApprovalSet',
					jsonb_build_object(
						'approvalId', '0x' || lpad(to_hex(item), 64, '0'),
						'receiverVault', ${address.toLowerCase()}::text,
						'securityPool', CASE WHEN item = 102 THEN ${uniswapOnlyMarket}::text ELSE ${oracle.toLowerCase()}::text END,
						'targetVault', ${address.toLowerCase()}::text
					), true
				FROM generate_series(2, 102) item
			`
	const linkedApprovalId = `0x${'b'.repeat(64)}`
	await database.sql`
				INSERT INTO liquidation_approval_events (
					chain_id, block_hash, tx_hash, transaction_index, log_index, block_number, registry_address,
					approval_identity, receiver_vault, event_name, event_data, canonical
				) VALUES
				(
					${operationsChainId}, ${`0x${(10002).toString(16).padStart(64, '0')}`},
					${`0x${(30002).toString(16).padStart(64, '0')}`}, 0, 0, 10002, ${uniswapOnlyMarket},
					${linkedApprovalId}, ${uniswapOnlyMarket}, 'LiquidationApprovalSet',
					jsonb_build_object('approvalId', ${linkedApprovalId}::text, 'receiverVault', ${uniswapOnlyMarket}::text,
						'securityPool', ${oracle.toLowerCase()}::text, 'targetVault', ${address.toLowerCase()}::text), true
				),
				(
					${operationsChainId}, ${`0x${(10003).toString(16).padStart(64, '0')}`},
					${`0x${(30003).toString(16).padStart(64, '0')}`}, 0, 0, 10003, ${uniswapOnlyMarket},
					${linkedApprovalId}, NULL, 'LiquidationApprovalReserved',
					jsonb_build_object('approvalId', ${linkedApprovalId}::text, 'operationId', '42'), true
				),
				(
					${operationsChainId}, ${`0x${(10003).toString(16).padStart(64, '0')}`},
					${`0x${(30003).toString(16).padStart(64, '0')}`}, 0, 0, 10003, ${oracle.toLowerCase()},
					${linkedApprovalId}, ${uniswapOnlyMarket}, 'LiquidationApprovalSet',
					jsonb_build_object('approvalId', ${linkedApprovalId}::text, 'receiverVault', ${uniswapOnlyMarket}::text,
						'securityPool', ${uniswapOnlyMarket}::text, 'targetVault', ${uniswapOnlyMarket}::text), true
				)
			`
	const boundedApprovalsResponse = await handleApi(new Request(`http://localhost/api/v1/operations?chainId=${operationsChainId}`), database.sql)
	if (boundedApprovalsResponse === undefined) throw new Error('bounded operations endpoint did not return a response')
	const boundedApprovals = (await boundedApprovalsResponse.json()) as { data: { risk: { approvalEvents: unknown[] } } }
	expect(boundedApprovals.data.risk.approvalEvents).toHaveLength(100)

	const riskResponse = await handleApi(new Request(`http://localhost/api/v1/state/risk/vaults/${operationsChainId}/${oracle.toLowerCase()}/${address.toLowerCase()}`), database.sql)
	if (riskResponse === undefined) throw new Error('vault risk endpoint did not return a response')
	const risk = (await riskResponse.json()) as {
		data: Record<string, unknown> & { approvalEvents: Array<{ approval_identity: string; event_name: string; event_data: Record<string, unknown> }> }
	}
	expect(risk.data).toMatchObject({
		protocol_state: 'unavailable',
		scanner_severity: 'unavailable',
		snapshot_evidence: {
			vaultSnapshot: { blockNumber: '2', blockHash: `0x${(2).toString(16).padStart(64, '0')}` },
			poolSnapshot: { blockNumber: '1', blockHash: hash },
		},
	})
	expect(risk.data['scanner_reason']).toContain('different evidence blocks')
	expect(risk.data.approvalEvents).toHaveLength(100)
	expect(risk.data.approvalEvents).toContainEqual(expect.objectContaining({ approval_identity: linkedApprovalId, event_name: 'LiquidationApprovalReserved' }))
	expect(risk.data.approvalEvents.some(event => event.event_data['securityPool'] === uniswapOnlyMarket)).toBe(false)
}

// Vault risk history paginates per observation, and price validity and bad debt drive severity.
const expectRiskHistoryAndSeverity = async ({ database, operationsChainId, oracle, hash }: OperationsContext): Promise<void> => {
	await database.sql`
				INSERT INTO entity_state_observations (
					chain_id, entity_type, entity_identity, block_number, block_hash, block_timestamp,
					source_method, read_status, read_result, canonical,
					indexer_run_id, abi_source_hash, application_source_hash, projection_source_hash
				)
				SELECT chain_id, entity_type, entity_identity, block_number, block_hash, block_timestamp,
					'augurscan.vault-risk.cursor-test', read_status, read_result, canonical,
					indexer_run_id, abi_source_hash, application_source_hash, projection_source_hash
				FROM entity_state_observations
				WHERE chain_id = ${operationsChainId} AND entity_type = 'vault'
				LIMIT 1
			`
	const firstRiskHistoryResponse = await handleApi(new Request(`http://localhost/api/v1/state/risk/vaults/${operationsChainId}/${oracle.toLowerCase()}/${address.toLowerCase()}?limit=1`), database.sql)
	if (firstRiskHistoryResponse === undefined) throw new Error('vault risk history did not return a response')
	const firstRiskHistory = (await firstRiskHistoryResponse.json()) as {
		data: { history: { stateSnapshots: Array<{ id: string }>; nextCursor: string } }
	}
	expect(firstRiskHistory.data.history.stateSnapshots).toHaveLength(1)
	expect(firstRiskHistory.data.history.nextCursor).toBeString()
	const secondRiskHistoryResponse = await handleApi(new Request(`http://localhost/api/v1/state/risk/vaults/${operationsChainId}/${oracle.toLowerCase()}/${address.toLowerCase()}?limit=1&cursor=${encodeURIComponent(firstRiskHistory.data.history.nextCursor)}`), database.sql)
	expect(secondRiskHistoryResponse?.status).toBe(200)
	const secondRiskHistory = (await secondRiskHistoryResponse?.json()) as {
		data: { history: { stateSnapshots: Array<{ id: string }> } }
	}
	expect(secondRiskHistory.data.history.stateSnapshots).toHaveLength(1)
	expect(secondRiskHistory.data.history.stateSnapshots[0]?.id).not.toBe(firstRiskHistory.data.history.stateSnapshots[0]?.id)
	const riskHistoryGeneration = await database.sql`
				INSERT INTO chain_reorganizations
					(chain_id, previous_block, previous_hash, ancestor_block, ancestor_hash, depth, reason)
				VALUES (${operationsChainId}, 10003, ${`0x${(10003).toString(16).padStart(64, '0')}`}, 10003,
					${`0x${(10003).toString(16).padStart(64, '0')}`}, 0, 'projection-rebuild')
				RETURNING id::text
			`
	const staleRiskHistoryResponse = await handleApi(new Request(`http://localhost/api/v1/state/risk/vaults/${operationsChainId}/${oracle.toLowerCase()}/${address.toLowerCase()}?limit=1&cursor=${encodeURIComponent(firstRiskHistory.data.history.nextCursor)}`), database.sql)
	expect(staleRiskHistoryResponse?.status).toBe(409)
	await database.sql`DELETE FROM chain_reorganizations WHERE id = ${riskHistoryGeneration[0]?.['id']}`

	await database.sql`
				UPDATE entity_state_snapshots SET
					block_number = 1, block_hash = ${hash}, block_timestamp = timestamptz '2026-01-01 00:00:20+00'
				WHERE chain_id = ${operationsChainId} AND entity_type = 'vault'
			`
	await database.sql`
				UPDATE entity_state_snapshots SET read_result = jsonb_set(read_result, '{price,protocolValid}', 'false'::jsonb, true)
				WHERE chain_id = ${operationsChainId} AND entity_type = 'pool'
			`
	const invalidPriceResponse = await handleApi(new Request(`http://localhost/api/v1/state/risk/vaults/${operationsChainId}/${oracle.toLowerCase()}/${address.toLowerCase()}`), database.sql)
	if (invalidPriceResponse === undefined) throw new Error('invalid-price risk endpoint did not return a response')
	const invalidPrice = (await invalidPriceResponse.json()) as { data: Record<string, unknown> }
	expect(invalidPrice.data).toMatchObject({ protocol_state: 'unavailable', scanner_severity: 'unavailable' })
	expect(invalidPrice.data['scanner_reason']).toContain('invalid accounting price')

	await database.sql`
				UPDATE entity_state_snapshots SET read_result =
					CASE entity_type
						WHEN 'pool' THEN jsonb_set(read_result, '{totalBadDebtAttoEth}', '"7"'::jsonb, true)
						ELSE jsonb_set(read_result, '{badDebtAttoEth}', '"9"'::jsonb, true)
					END
				WHERE chain_id = ${operationsChainId} AND entity_type IN ('pool', 'vault')
			`
	const badDebtPoolResponse = await handleApi(new Request(`http://localhost/api/v1/state/risk/pools/${operationsChainId}/${oracle.toLowerCase()}`), database.sql)
	const badDebtVaultResponse = await handleApi(new Request(`http://localhost/api/v1/state/risk/vaults/${operationsChainId}/${oracle.toLowerCase()}/${address.toLowerCase()}`), database.sql)
	if (badDebtPoolResponse === undefined || badDebtVaultResponse === undefined) throw new Error('bad-debt risk endpoint did not return a response')
	const badDebtPool = (await badDebtPoolResponse.json()) as { data: Record<string, unknown> }
	const badDebtVault = (await badDebtVaultResponse.json()) as { data: Record<string, unknown> }
	expect(badDebtPool.data).toMatchObject({ protocol_state: 'bad-debt', scanner_severity: 'critical' })
	expect(badDebtVault.data).toMatchObject({ protocol_state: 'bad-debt', scanner_severity: 'critical' })
}

const expectSnapshotsAndIndexedPlans = async ({ database, operationsChainId, oracle }: OperationsContext): Promise<void> => {
	const snapshotRows = await database.sql`
			SELECT read_status, read_result, canonical FROM entity_state_snapshots
			WHERE chain_id = ${operationsChainId} AND entity_type = 'auction'
		`
	expect(snapshotRows[0]).toMatchObject({ read_status: 'success', canonical: true, read_result: { finalized: false, activeTickCount: '2' } })

	const explainQueries = [
		database.sql`EXPLAIN (FORMAT JSON) SELECT * FROM open_oracle_report_events WHERE chain_id = ${operationsChainId} AND open_oracle_address = ${oracle.toLowerCase()} AND report_id = 7 AND canonical ORDER BY block_number DESC, log_index DESC, tx_hash DESC LIMIT 100`,
		database.sql`EXPLAIN (FORMAT JSON) SELECT * FROM escalation_game_events WHERE chain_id = ${operationsChainId} AND game_address = ${oracle.toLowerCase()} AND canonical ORDER BY block_number DESC, log_index DESC, tx_hash DESC LIMIT 100`,
		database.sql`EXPLAIN (FORMAT JSON) SELECT * FROM truth_auction_events WHERE chain_id = ${operationsChainId} AND auction_address = ${oracle.toLowerCase()} AND canonical ORDER BY block_number DESC, log_index DESC, tx_hash DESC LIMIT 100`,
		database.sql`EXPLAIN (FORMAT JSON) SELECT * FROM protocol_timeline_entries WHERE chain_id = ${operationsChainId} AND entity_type = 'open-oracle-report' AND entity_identity = ${`${oracle.toLowerCase()}:7`} AND canonical ORDER BY block_number DESC, log_index DESC, tx_hash DESC LIMIT 100`,
		database.sql`EXPLAIN (FORMAT JSON) SELECT * FROM amm_trade_events WHERE chain_id = ${operationsChainId} AND market_address = ${oracle.toLowerCase()} AND canonical ORDER BY block_number, log_index, tx_hash LIMIT 100`,
		database.sql`EXPLAIN (FORMAT JSON) SELECT * FROM fork_migration_events WHERE chain_id = ${operationsChainId} AND universe_identity = '7' AND canonical ORDER BY block_number DESC, log_index DESC, tx_hash DESC LIMIT 100`,
		database.sql`EXPLAIN (FORMAT JSON) SELECT * FROM entity_state_snapshots WHERE chain_id = ${operationsChainId} AND entity_type = 'auction' AND entity_identity = ${oracle.toLowerCase()} AND canonical ORDER BY block_number DESC LIMIT 1`,
	]
	const plans = await Promise.all(explainQueries)
	expect(plans).toHaveLength(7)
	for (const plan of plans) expect(JSON.stringify(plan)).toContain('Plan')
	const paginationPlans = await database.sql.begin(async transaction => {
		await transaction.unsafe('SET LOCAL enable_seqscan = off')
		return {
			balance: await transaction`EXPLAIN (FORMAT JSON) SELECT * FROM address_balance_observations
						WHERE chain_id = ${operationsChainId} ORDER BY observed_at DESC, id DESC LIMIT 100`,
			metadata: await transaction`EXPLAIN (FORMAT JSON) SELECT * FROM token_metadata_observations
						WHERE chain_id = ${operationsChainId} ORDER BY observed_at DESC, id DESC LIMIT 100`,
			pool: await transaction`EXPLAIN (FORMAT JSON) SELECT * FROM pool_snapshots
						WHERE chain_id = ${operationsChainId} AND pool_address = ${oracle.toLowerCase()} AND canonical
						ORDER BY block_number DESC, log_index DESC, tx_hash DESC, block_hash DESC LIMIT 100`,
			vault: await transaction`EXPLAIN (FORMAT JSON) SELECT * FROM vault_snapshots
						WHERE chain_id = ${operationsChainId} AND pool_address = ${oracle.toLowerCase()}
							AND vault_address = ${address.toLowerCase()} AND canonical
						ORDER BY block_number DESC, log_index DESC, tx_hash DESC, block_hash DESC LIMIT 100`,
			timeline: await transaction`EXPLAIN (FORMAT JSON) SELECT * FROM protocol_timeline_entries
						WHERE chain_id = ${operationsChainId} AND entity_type = 'vault'
							AND entity_identity = ${`${oracle.toLowerCase()}:${address.toLowerCase()}`} AND canonical
						ORDER BY block_number DESC, log_index DESC, tx_hash DESC, block_hash DESC LIMIT 100`,
		}
	})
	expect(JSON.stringify(paginationPlans.balance)).toContain('address_balance_observation_page')
	expect(JSON.stringify(paginationPlans.metadata)).toContain('token_metadata_observation_page')
	expect(JSON.stringify(paginationPlans.pool)).toContain('pool_snapshots_detail_page')
	expect(JSON.stringify(paginationPlans.vault)).toContain('vault_snapshots_detail_page')
	expect(JSON.stringify(paginationPlans.timeline)).toMatch(/protocol_timeline_(entity_)?history_page/)
}

// A manifest reset clears derived rows but retains state snapshots and observations without resampling targets.
const expectManifestResetRetention = async ({ database, operationsChainId, network }: OperationsContext): Promise<void> => {
	const resetLease = await database.tryAcquireIndexerLock(operationsChainId)
	if (resetLease === undefined) throw new Error('operations manifest-reset writer did not acquire its lock')
	expect(await database.seedNetwork({ ...network, contracts: [[address, 'Replacement manifest contract', 'openOracle']] }, { lease: resetLease, resetCanonicalHistoryOnManifestChange: true })).toBe(true)
	await resetLease.release()
	const retainedSnapshots = await database.sql`
				SELECT DISTINCT read_status, canonical FROM entity_state_snapshots WHERE chain_id = ${operationsChainId}
			`
	expect(retainedSnapshots).toEqual([{ read_status: 'success', canonical: true }])
	const retainedStateObservations = await database.sql`
				SELECT DISTINCT read_status, canonical FROM entity_state_observations WHERE chain_id = ${operationsChainId}
			`
	expect(retainedStateObservations).toEqual([{ read_status: 'success', canonical: true }])

	const clearedDerivedRows = await database.sql`
					SELECT
						(SELECT count(*) FROM pools WHERE chain_id = ${operationsChainId})::integer AS pools,
						(SELECT count(*) FROM pool_state_events WHERE chain_id = ${operationsChainId})::integer AS pool_events,
						(SELECT count(*) FROM vault_snapshots WHERE chain_id = ${operationsChainId})::integer AS vaults,
						(SELECT count(*) FROM escalation_game_events WHERE chain_id = ${operationsChainId})::integer AS escalations,
						(SELECT count(*) FROM truth_auction_events WHERE chain_id = ${operationsChainId})::integer AS auctions
				`
	expect(clearedDerivedRows[0]).toEqual({ pools: 0, pool_events: 0, vaults: 0, escalations: 0, auctions: 0 })
	const resampleTargets = await database.stateSnapshotTargets(operationsChainId, 1n, 1_000)
	expect(resampleTargets).toEqual([])
}

postgresTest(
	'stores operations snapshots, paginates entity evidence, and explains indexed access paths',
	async () => {
		const database = new ScannerDatabase(requirePostgresUrl())
		const operationsChainId = chainId + 20 + process.pid
		const oracle = discoveredAddress
		const hash = blockHash('operations-completion')
		const network: NetworkConfig = {
			id: `operations-integration-${operationsChainId}`,
			name: 'Operations integration chain',
			chainId: operationsChainId,
			rpcUrls: ['http://127.0.0.1:8545'],
			startBlock: 1n,
			explorerBaseUrl: 'https://example.invalid',
			nativeSymbol: 'ETH',
			confirmationDepth: 0n,
			contracts: [[oracle, 'OpenOracle', 'openOracle']],
		}
		const context: OperationsContext = { database, operationsChainId, oracle, hash, network }
		try {
			await expectAwaitingOperations(context)
			await storeOperationsEvidenceBlock(context)
			await expectTimelinePagination(context)
			await seedBulkTradingHistory(context)
			await seedRiskAndPortfolioEvidence(context)
			await expectUnicodeTradingPagination(context)
			await expectReportDetailPagination(context)
			await expectReportCatalogGenerations(context)
			await expectTradingAndPortfolioPagination(context)
			await expectRiskAndForkCatalogs(context)
			await expectQuestionHistoryCursors(context)
			await expectTradingObservationBoundary(context)
			await expectBoundedApprovalsAndRisk(context)
			await expectRiskHistoryAndSeverity(context)
			await expectSnapshotsAndIndexedPlans(context)
			await expectManifestResetRetention(context)
		} finally {
			await database.close()
		}
	},
	180_000,
)
