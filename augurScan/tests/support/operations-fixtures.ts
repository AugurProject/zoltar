// Evidence seeding for the operations snapshot integration test: one decoded block with report and
// capital commitment events, ten thousand blocks of AMM trading history, and bulk risk, portfolio,
// fork, report, and question rows that exercise every paginated catalog.
import { expect } from 'bun:test'
import { handleApi } from '../../src/api.ts'
import type { ScannerDatabase } from '../../src/database.ts'
import type { NetworkConfig } from '../../src/types.ts'
import { address, type BlockHash, blockHash, decodedLog, discoveredAddress, promotedAddress, transaction, transactionHash } from './postgres-fixtures.ts'

export type OperationsContext = {
	readonly database: ScannerDatabase
	readonly operationsChainId: number
	readonly oracle: typeof discoveredAddress
	readonly hash: BlockHash
	readonly network: NetworkConfig
}

// Stores the decoded report and capital commitment block, then an auction state snapshot at that block.
export const storeOperationsEvidenceBlock = async ({ database, operationsChainId, oracle, hash }: OperationsContext): Promise<void> => {
	const lease = await database.tryAcquireIndexerLock(operationsChainId)
	if (lease === undefined) throw new Error('operations integration writer did not acquire its lock')
	try {
		const storedTransaction = { ...transaction(), hash: transactionHash, to: oracle }
		const reportData = {
			reportId: '7',
			numReports: '1',
			flags: '1',
			reportTimestamp: '1767225600',
			disputeDelay: '10',
			settlementTime: '30',
			currentAmount1: '100',
			currentAmount2: '5',
		}
		const submitted = { ...decodedLog(hash, 0, oracle, 'ReportSubmitted', reportData), blockNumber: 1n }
		const disputed = { ...decodedLog(hash, 1, oracle, 'ReportDisputed', { ...reportData, numReports: '2' }), blockNumber: 1n, transactionHash }
		const capitalEvidence = [
			{ name: 'PrincipalDeposited', argumentsValue: { payer: address, owner: address, amountAttoRep: 120n.toString() } },
			{ name: 'CommitmentAuthorized', argumentsValue: { owner: address, positionId: '1', rep: '120', commitment: '100', targetHealthFactorBps: '12000' } },
			{ name: 'CommitmentCured', argumentsValue: { positionId: '1', removedCommitment: '10' } },
			{ name: 'CommitmentTakenOver', argumentsValue: { sourceId: '1', receiverId: '2', commitment: '90', awardAttoRep: 5n.toString() } },
			// The decoder keeps the uint8 reason as a number.
			{ name: 'QuestionAccountingCheckpoint', argumentsValue: { reason: 5, settlementCollateralAttoEth: '40', shareTokenSupplyAttoShares: '40', lastSettlementPortfolioTime: '1767225620' } },
		]
		const capitalEvents = capitalEvidence.map(({ name, argumentsValue }, index) => ({
			...decodedLog(hash, index + 2, oracle, name, argumentsValue),
			blockNumber: 1n,
		}))
		await database.storeBlock(
			operationsChainId,
			{
				number: 1n,
				hash,
				parentHash: blockHash('operations-parent'),
				timestamp: new Date('2026-01-01T00:00:20Z'),
				observedHead: 1n,
				finalizedThrough: 1n,
				contracts: [],
				tokenMetadata: [],
				transactions: [storedTransaction],
				logs: [submitted, disputed, ...capitalEvents],
				addressActivity: [],
				contractDeploymentObservations: [],
				logScanCursors: [],
			},
			lease,
		)
		const storedCapitalEvents = await database.sql`
			SELECT semantic_event_kind, entity_type, entity_identity FROM protocol_timeline_entries
			WHERE chain_id = ${operationsChainId} AND canonical AND log_index >= 2 ORDER BY log_index
		`
		expect(storedCapitalEvents).toEqual([
			{ semantic_event_kind: 'PrincipalDeposited', entity_type: 'vault', entity_identity: `${oracle.toLowerCase()}:${address.toLowerCase()}` },
			{ semantic_event_kind: 'CommitmentAuthorized', entity_type: 'vault', entity_identity: `${oracle.toLowerCase()}:${address.toLowerCase()}` },
			{ semantic_event_kind: 'CommitmentCured', entity_type: 'capital-position', entity_identity: `${oracle.toLowerCase()}:1` },
			{ semantic_event_kind: 'CommitmentTakenOver', entity_type: 'capital-position', entity_identity: `${oracle.toLowerCase()}:1` },
			{ semantic_event_kind: 'QuestionAccountingCheckpoint', entity_type: 'pool', entity_identity: oracle.toLowerCase() },
		])
		// The same checkpoint is the pool's accounting snapshot.
		expect(await database.sql`SELECT reason, settlement_collateral_atto_eth::text, share_token_supply_atto_shares::text, EXTRACT(EPOCH FROM last_settlement_portfolio_time)::bigint::text AS last_settlement FROM pool_snapshots WHERE chain_id = ${operationsChainId}`).toEqual([
			{ reason: 5, settlement_collateral_atto_eth: '40', share_token_supply_atto_shares: '40', last_settlement: '1767225620' },
		])
		const indexedResponse = await handleApi(new Request(`http://localhost/api/v1/state/timeline?chainId=${operationsChainId}&event=CommitmentTakenOver`), database.sql)
		if (indexedResponse === undefined) throw new Error('indexed timeline endpoint did not return a response')
		expect(indexedResponse.status).toBe(200)
		expect(await indexedResponse.json()).toMatchObject({
			data: { items: [{ semantic_event_kind: 'CommitmentTakenOver', entity_identity: `${oracle.toLowerCase()}:1`, summary_data: capitalEvidence[3]?.argumentsValue }], total: '1' },
		})
		await database.storeEntityStateSnapshots(
			operationsChainId,
			1n,
			hash,
			new Date('2026-01-01T00:00:20Z'),
			[
				{
					entityType: 'auction',
					entityIdentity: oracle.toLowerCase(),
					sourceMethod: 'augurscan.auction-state.v1',
					readStatus: 'success',
					readResult: { finalized: false, bidCount: '2' },
				},
			],
			lease,
		)
	} finally {
		await lease.release()
	}
}

// Adds finalized Swap and Sync history for blocks 2 through 10003 and advances the checkpoint to its head.
export const seedBulkTradingHistory = async ({ database, operationsChainId, oracle }: OperationsContext): Promise<void> => {
	await database.sql`
			INSERT INTO blocks (chain_id, number, hash, parent_hash, timestamp, canonical, finalized)
			SELECT ${operationsChainId}, item,
				'0x' || lpad(to_hex(item), 64, '0'),
				'0x' || lpad(to_hex(item - 1), 64, '0'),
				timestamptz '2026-01-01 00:00:20+00' + make_interval(secs => item), true, true
			FROM generate_series(2, 10003) item
		`
	await database.sql`
			INSERT INTO transactions (
				chain_id, hash, block_hash, block_number, transaction_index,
				from_address, to_address, value, input, status, gas_used, receipt, canonical
			)
			SELECT ${operationsChainId}, '0x' || lpad(to_hex(item + 20000), 64, '0'),
				'0x' || lpad(to_hex(item), 64, '0'), item, 0,
				${address.toLowerCase()}, ${oracle.toLowerCase()}, 0, '0x', 'success', 21000, '{}'::jsonb, true
			FROM generate_series(2, 10003) item
		`
	await database.sql`
			INSERT INTO logs (
				chain_id, tx_hash, block_hash, block_number, transaction_index, log_index,
				emitter_address, topics, data, event_name, arguments, argument_schema,
				decode_status, summary, canonical, finalized
			)
			SELECT ${operationsChainId}, '0x' || lpad(to_hex(item + 20000), 64, '0'),
				'0x' || lpad(to_hex(item), 64, '0'), item, 0, 0,
				${oracle.toLowerCase()}, '[]'::jsonb, '0x', 'Swap',
				jsonb_build_object('yesForNo', true, 'amountIn', '1', 'amountOut', '1', 'feeAmount', '1',
					'resultingYesReserve', item::text, 'resultingNoReserve', (item * 2)::text),
				'[]'::jsonb, 'decoded', 'Swap', true, true
			FROM generate_series(2, 10003) item
		`
	await database.sql`
			INSERT INTO amm_trade_events (
				chain_id, block_hash, tx_hash, log_index, block_number, market_address, event_name, event_data, canonical
			)
			SELECT ${operationsChainId}, '0x' || lpad(to_hex(item), 64, '0'),
				'0x' || lpad(to_hex(item + 20000), 64, '0'), 0, item, ${oracle.toLowerCase()}, 'Swap',
				jsonb_build_object('yesForNo', true, 'amountIn', '1', 'amountOut', '1', 'feeAmount', '1',
					'resultingYesReserve', item::text, 'resultingNoReserve', (item * 2)::text), true
				FROM generate_series(2, 10003) item
			`
	await database.sql`
				INSERT INTO logs (
					chain_id, tx_hash, block_hash, block_number, transaction_index, log_index,
					emitter_address, topics, data, event_name, arguments, argument_schema,
					decode_status, summary, canonical, finalized
				)
				SELECT ${operationsChainId}, '0x' || lpad(to_hex(item + 20000), 64, '0'),
					'0x' || lpad(to_hex(item), 64, '0'), item, 0, 10,
					${oracle.toLowerCase()}, '[]'::jsonb, '0x', 'Sync',
					jsonb_build_object('yesReserve', item::text, 'noReserve', (item * 2)::text),
					'[]'::jsonb, 'decoded', 'Sync', true, true
				FROM generate_series(2, 10003) item
			`
	await database.sql`
				INSERT INTO amm_trade_events (
					chain_id, block_hash, tx_hash, log_index, block_number, market_address, event_name, event_data, canonical
				)
				SELECT ${operationsChainId}, '0x' || lpad(to_hex(item), 64, '0'),
					'0x' || lpad(to_hex(item + 20000), 64, '0'), 10, item, ${oracle.toLowerCase()}, 'Sync',
					jsonb_build_object('yesReserve', item::text, 'noReserve', (item * 2)::text), true
				FROM generate_series(2, 10003) item
			`
	await database.sql`
				UPDATE networks SET indexed_block = 10003,
				indexed_hash = ${`0x${(10003).toString(16).padStart(64, '0')}`},
				indexed_timestamp = timestamptz '2026-01-01 00:00:20+00' + make_interval(secs => 10003),
				observed_block = 10003, finalized_block = 10003
			WHERE chain_id = ${operationsChainId}
		`
}

// Adds pool, state, LP, fork, report, coordinator, and question evidence beyond single-page limits.
export const seedRiskAndPortfolioEvidence = async ({ database, operationsChainId, oracle, hash }: OperationsContext): Promise<void> => {
	await database.sql`
			INSERT INTO pools (
				chain_id, block_hash, tx_hash, log_index, block_number, pool_address, parent_address,
				universe_id, question_id, coordinator_address, share_token_address,
				security_multiplier_bps, initial_priority_fee_atto_eth_per_gas, canonical
			) VALUES (
				${operationsChainId}, ${hash}, ${transactionHash}, 0, 1, ${oracle.toLowerCase()}, ${address.toLowerCase()},
				1, 1, ${oracle.toLowerCase()}, ${address.toLowerCase()},
				15000, 0, true
			)
		`
	await database.sql`
			INSERT INTO entity_state_snapshots (
				chain_id, entity_type, entity_identity, block_number, block_hash, block_timestamp,
				source_method, read_status, read_result, canonical
			) VALUES
			(
				${operationsChainId}, 'pool', ${oracle.toLowerCase()}, 1, ${hash}, timestamptz '2026-01-01 00:00:20+00',
				'augurscan.pool-risk.v1', 'success',
				jsonb_build_object('settlementCollateralAttoEth', '1', 'currentMintingCapacityAttoEth', '2',
					'totalBadDebtAttoEth', '0', 'systemState', '1',
					'price', jsonb_build_object('repPerEth1e18', '100')), true
			)
		`
	await database.sql`
				INSERT INTO entity_state_observations (
					chain_id, entity_type, entity_identity, block_number, block_hash, block_timestamp,
					source_method, read_status, read_result, read_failure_reason, observed_at, canonical,
					indexer_run_id, abi_source_hash, application_source_hash, projection_source_hash
				)
				SELECT chain_id, entity_type, entity_identity, block_number, block_hash, block_timestamp,
					source_method, read_status, read_result, read_failure_reason, observed_at, canonical,
					indexer_run_id, abi_source_hash, application_source_hash, projection_source_hash
				FROM entity_state_snapshots
				WHERE chain_id = ${operationsChainId} AND entity_type = 'pool'
			`
	await database.sql`
				INSERT INTO logs (
					chain_id, tx_hash, block_hash, block_number, transaction_index, log_index, emitter_address,
					topics, data, event_name, arguments, argument_schema, decode_status, summary, canonical, finalized
				)
				SELECT ${operationsChainId}, '0x' || lpad(to_hex(item + 20000), 64, '0'), '0x' || lpad(to_hex(item), 64, '0'),
					item, 0, evidence.log_index, ${oracle.toLowerCase()}, '[]'::jsonb, '0x', evidence.event_name,
					CASE evidence.log_index
						WHEN 1 THEN jsonb_build_object('pair', '0x' || lpad(to_hex(item + 1000000), 40, '0'))
						WHEN 2 THEN jsonb_build_object('from', '0x0000000000000000000000000000000000000000', 'to', ${address.toLowerCase()}::text, 'amount', item::text)
						WHEN 4 THEN jsonb_build_object('universeId', item::text, 'migrator', ${address.toLowerCase()}::text)
						WHEN 5 THEN jsonb_build_object('reportId', item::text, 'currentReporter', ${address.toLowerCase()}::text)
						ELSE jsonb_build_object('universeId', (item + 1000)::text)
					END,
					'[]'::jsonb, 'decoded', evidence.event_name, true, true
				FROM generate_series(2, 261) item
				CROSS JOIN (VALUES (1, 'PairCreated'), (2, 'Transfer'), (6, 'UniverseForked')) evidence(log_index, event_name)
				UNION ALL
				SELECT ${operationsChainId}, '0x' || lpad(to_hex(item + 20000), 64, '0'), '0x' || lpad(to_hex(item), 64, '0'),
					item, 0, evidence.log_index, ${oracle.toLowerCase()}, '[]'::jsonb, '0x', evidence.event_name,
					CASE evidence.log_index
						WHEN 4 THEN jsonb_build_object('universeId', item::text, 'migrator', ${address.toLowerCase()}::text)
						ELSE jsonb_build_object('reportId', item::text, 'currentReporter', ${address.toLowerCase()}::text)
					END,
					'[]'::jsonb, 'decoded', evidence.event_name, true, true
				FROM generate_series(2, 103) item
				CROSS JOIN (VALUES (4, 'MigrationRepAdded'), (5, 'ReportSubmitted')) evidence(log_index, event_name)
			`
	await database.sql`
				INSERT INTO amm_markets (
					chain_id, block_hash, tx_hash, log_index, block_number, pair_address, pool_address,
					share_token_address, universe_id, fee_bps, canonical
				)
				SELECT ${operationsChainId}, '0x' || lpad(to_hex(item), 64, '0'), '0x' || lpad(to_hex(item + 20000), 64, '0'),
					1, item, '0x' || lpad(to_hex(item + 1000000), 40, '0'),
					'0x' || lpad(to_hex(item + 2000000), 40, '0'), ${address.toLowerCase()}, 1, 30, true
				FROM generate_series(2, 103) item
			`
	await database.sql`
				INSERT INTO amm_trade_events (
					chain_id, block_hash, tx_hash, log_index, block_number, market_address, event_name, event_data, canonical
				)
				SELECT ${operationsChainId}, '0x' || lpad(to_hex(item), 64, '0'), '0x' || lpad(to_hex(item + 20000), 64, '0'),
					2, item, '0x' || lpad(to_hex(item + 1000000), 40, '0'), 'Transfer',
					jsonb_build_object('from', '0x0000000000000000000000000000000000000000', 'to', ${address.toLowerCase()}::text, 'amount', item::text), true
				FROM generate_series(2, 103) item
			`
	await database.sql`
				INSERT INTO logs (
					chain_id, tx_hash, block_hash, block_number, transaction_index, log_index, emitter_address,
					topics, data, event_name, arguments, argument_schema, decode_status, summary, canonical, finalized
				) VALUES (
					${operationsChainId}, ${`0x${(20002).toString(16).padStart(64, '0')}`}, ${`0x${(2).toString(16).padStart(64, '0')}`},
					2, 0, 3, ${`0x${(1000002).toString(16).padStart(40, '0')}`}, '[]'::jsonb, '0x', 'Transfer',
					jsonb_build_object('from', ${address.toLowerCase()}::text, 'to', ${address.toLowerCase()}::text, 'amount', '999'),
					'[]'::jsonb, 'decoded', 'Transfer', true, true
				)
			`
	await database.sql`
				INSERT INTO amm_trade_events (
					chain_id, block_hash, tx_hash, log_index, block_number, market_address, event_name, event_data, canonical
				) VALUES (
					${operationsChainId}, ${`0x${(2).toString(16).padStart(64, '0')}`}, ${`0x${(20002).toString(16).padStart(64, '0')}`},
					3, 2, ${`0x${(1000002).toString(16).padStart(40, '0')}`}, 'Transfer',
					jsonb_build_object('from', ${address.toLowerCase()}::text, 'to', ${address.toLowerCase()}::text, 'amount', '999'), true
				)
			`
	await database.sql`
				INSERT INTO fork_migration_events (
					chain_id, block_hash, tx_hash, log_index, block_number, universe_identity, event_name, event_data, canonical
				)
				SELECT ${operationsChainId}, '0x' || lpad(to_hex(item), 64, '0'), '0x' || lpad(to_hex(item + 20000), 64, '0'),
					4, item, item::text, 'MigrationRepAdded', jsonb_build_object('universeId', item::text, 'migrator', ${address.toLowerCase()}::text), true
				FROM generate_series(2, 103) item
				UNION ALL
				SELECT ${operationsChainId}, '0x' || lpad(to_hex(item), 64, '0'), '0x' || lpad(to_hex(item + 20000), 64, '0'),
					6, item, (item + 1000)::text, 'UniverseForked', jsonb_build_object('universeId', (item + 1000)::text), true
				FROM generate_series(2, 261) item
			`
	await database.sql`
				INSERT INTO open_oracle_report_events (
					chain_id, block_hash, tx_hash, log_index, block_number, open_oracle_address,
					report_id, event_name, round_number, report_data, canonical
				)
				SELECT ${operationsChainId}, '0x' || lpad(to_hex(item), 64, '0'), '0x' || lpad(to_hex(item + 20000), 64, '0'),
					5, item, ${oracle.toLowerCase()}, item, 'ReportSubmitted', 1,
					jsonb_build_object('reportId', item::text, 'currentReporter', ${address.toLowerCase()}::text), true
				FROM generate_series(2, 103) item
			`
	await database.sql`
				INSERT INTO logs (
					chain_id, tx_hash, block_hash, block_number, transaction_index, log_index, emitter_address,
					topics, data, event_name, arguments, argument_schema, decode_status, summary, canonical, finalized
				) VALUES
					(${operationsChainId}, ${transactionHash}, ${hash}, 1, 0, 20, ${promotedAddress.toLowerCase()},
						'[]'::jsonb, '0x', 'PriceRequested', jsonb_build_object('reportId', '7'), '[]'::jsonb,
						'decoded', 'Price requested', true, true),
					(${operationsChainId}, ${transactionHash}, ${hash}, 1, 0, 21, ${promotedAddress.toLowerCase()},
						'[]'::jsonb, '0x', 'PriceReportRejected', jsonb_build_object('reportId', '7', 'reason', 'first rejection'),
						'[]'::jsonb, 'decoded', 'Price report rejected', true, true),
					(${operationsChainId}, ${transactionHash}, ${hash}, 1, 0, 22, ${promotedAddress.toLowerCase()},
						'[]'::jsonb, '0x', 'PendingReportRecovered', jsonb_build_object('reportId', '7'), '[]'::jsonb,
						'decoded', 'Pending report recovered', true, true)
			`
	await database.sql`
				INSERT INTO pools (
					chain_id, block_hash, tx_hash, log_index, block_number, pool_address, parent_address,
					universe_id, question_id, coordinator_address, share_token_address,
					security_multiplier_bps, initial_priority_fee_atto_eth_per_gas, canonical
				)
				SELECT ${operationsChainId}, '0x' || lpad(to_hex(item), 64, '0'), '0x' || lpad(to_hex(item + 20000), 64, '0'),
					1, item, '0x' || lpad(to_hex(item + 2000000), 40, '0'), ${address.toLowerCase()}, 1, 1,
					${oracle.toLowerCase()}, ${address.toLowerCase()}, 15000, 0, true
				FROM generate_series(2, 261) item
			`
	await database.sql`
				INSERT INTO questions (
					chain_id, block_hash, tx_hash, log_index, block_number, question_id, created_timestamp,
					title, description, start_time, end_time, num_ticks, display_value_min,
					display_value_max, answer_unit, outcome_options, canonical
				) VALUES (
					${operationsChainId}, ${hash}, ${transactionHash}, 0, 1, 1,
					timestamptz '2026-01-01 00:00:20+00', 'Will the 🔮 forecast resolve?', 'Unicode cursor fixture',
					1767225620, 1767312020,
					1000, 0, 1, 'probability', '["No","Yes"]'::jsonb, true
				)
			`
}
