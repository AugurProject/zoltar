// Evidence seeding for the operations snapshot integration test: one decoded block with report and
// liquidation-approval events, ten thousand blocks of AMM trading history, and bulk risk, portfolio,
// fork, report, question, and vault rows that exercise every paginated catalog.
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

// Stores the decoded report and approval block, then an auction state snapshot at that block.
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
		const approvalId = `0x${'a'.repeat(64)}`
		const approvalEvidence: Array<{ name: string; argumentsValue: Record<string, unknown> }> = [
			{
				name: 'LiquidationApprovalSet',
				argumentsValue: { approvalId, receiverVault: address, operator: discoveredAddress, securityPool: oracle, targetVault: address },
			},
			{ name: 'LiquidationApprovalReserved', argumentsValue: { approvalId, operationId: '1', reservedDebtAttoEth: 10n.toString() } },
			{ name: 'LiquidationApprovalReleased', argumentsValue: { approvalId, operationId: '1', releasedDebtAttoEth: 2n.toString() } },
			{ name: 'LiquidationApprovalConsumed', argumentsValue: { approvalId, operationId: '1', consumedDebtAttoEth: 8n.toString() } },
			{ name: 'LiquidationApprovalRevoked', argumentsValue: { approvalId, receiverVault: address } },
			{ name: 'LiquidationApprovalNonceInvalidated', argumentsValue: { receiverVault: address, previousNonce: '1', newNonce: '2' } },
		]
		const approvalEvents = approvalEvidence.map(({ name, argumentsValue }, index) => ({
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
				logs: [submitted, disputed, ...approvalEvents],
				addressActivity: [],
				contractDeploymentObservations: [],
				logScanCursors: [],
			},
			lease,
		)
		const storedApprovalEvents = await database.sql`
					SELECT event_name FROM liquidation_approval_events
					WHERE chain_id = ${operationsChainId} AND canonical ORDER BY log_index
				`
		expect(storedApprovalEvents.map((row: Record<string, unknown>) => row['event_name'])).toEqual(['LiquidationApprovalSet', 'LiquidationApprovalReserved', 'LiquidationApprovalReleased', 'LiquidationApprovalConsumed', 'LiquidationApprovalRevoked', 'LiquidationApprovalNonceInvalidated'])
		const indexedOperationsResponse = await handleApi(new Request(`http://localhost/api/v1/operations?chainId=${operationsChainId}`), database.sql)
		if (indexedOperationsResponse === undefined) throw new Error('indexed operations endpoint did not return a response')
		const indexedOperations = (await indexedOperationsResponse.json()) as {
			data: { risk: { approvalEvents: Array<{ event_name: string }> } }
		}
		expect(indexedOperations.data.risk.approvalEvents).toHaveLength(6)
		expect(indexedOperations.data.risk.approvalEvents.map(event => event.event_name)).toContain('LiquidationApprovalNonceInvalidated')
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
					readResult: { finalized: false, activeTickCount: '2' },
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

// Adds pool, vault, state, LP, fork, report, coordinator, and question evidence beyond single-page limits.
export const seedRiskAndPortfolioEvidence = async ({ database, operationsChainId, oracle, hash }: OperationsContext): Promise<void> => {
	await database.sql`
			INSERT INTO pools (
				chain_id, block_hash, tx_hash, log_index, block_number, pool_address, parent_address,
				universe_id, question_id, truth_auction_address, coordinator_address, share_token_address,
				security_multiplier_bps, initial_priority_fee_atto_eth_per_gas,
				initial_retention_rate, initial_settlement_collateral_atto_eth, canonical
			) VALUES (
				${operationsChainId}, ${hash}, ${transactionHash}, 0, 1, ${oracle.toLowerCase()}, ${address.toLowerCase()},
				1, 1, ${address.toLowerCase()}, ${oracle.toLowerCase()}, ${address.toLowerCase()},
				15000, 0, 0, 0, true
			)
		`
	await database.sql`
			INSERT INTO vault_snapshots (
				chain_id, block_hash, tx_hash, log_index, block_number, pool_address, vault_address,
				rep_backing_units, capacity_ownership_atto_rep, claimable_fees_atto_eth, fee_index,
				vault_fee_remainder, resulting_total_rep_backing_units,
				resulting_fee_eligible_capacity_ownership_atto_rep, canonical
			) VALUES (
				${operationsChainId}, ${hash}, ${transactionHash}, 1, 1, ${oracle.toLowerCase()}, ${address.toLowerCase()},
				100, 100, 0, 0, 0, 100, 100, true
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
			),
			(
				${operationsChainId}, 'vault', ${`${oracle.toLowerCase()}:${address.toLowerCase()}`}, 2,
				${`0x${(2).toString(16).padStart(64, '0')}`}, timestamptz '2026-01-01 00:00:22+00',
				'augurscan.vault-risk.v1', 'success',
				jsonb_build_object('poolHeldBackingAttoRep', '200', 'disputeStakedAttoRep', '0',
					'openInterestAttoEth', '1000000000000000000', 'securityMultiplierBps', '15000',
					'targetHealthFactorBps', '12000', 'badDebtAttoEth', '0'), true
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
				WHERE chain_id = ${operationsChainId} AND entity_type IN ('pool', 'vault')
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
					universe_id, question_id, truth_auction_address, coordinator_address, share_token_address,
					security_multiplier_bps, initial_priority_fee_atto_eth_per_gas,
					initial_retention_rate, initial_settlement_collateral_atto_eth, canonical
				)
				SELECT ${operationsChainId}, '0x' || lpad(to_hex(item), 64, '0'), '0x' || lpad(to_hex(item + 20000), 64, '0'),
					1, item, '0x' || lpad(to_hex(item + 2000000), 40, '0'), ${address.toLowerCase()}, 1, 1,
					${address.toLowerCase()}, ${oracle.toLowerCase()}, ${address.toLowerCase()}, 15000, 0, 0, 0, true
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
	await database.sql`
				INSERT INTO vault_snapshots (
					chain_id, block_hash, tx_hash, log_index, block_number, pool_address, vault_address,
					rep_backing_units, capacity_ownership_atto_rep, claimable_fees_atto_eth, fee_index,
					vault_fee_remainder, resulting_total_rep_backing_units,
					resulting_fee_eligible_capacity_ownership_atto_rep, canonical
				)
				SELECT ${operationsChainId}, '0x' || lpad(to_hex(item), 64, '0'), '0x' || lpad(to_hex(item + 20000), 64, '0'),
					2, item, '0x' || lpad(to_hex(item + 2000000), 40, '0'), '0x' || lpad(to_hex(item + 3000000), 40, '0'),
					100, 100, 0, 0, 0, 100, 100, true
				FROM generate_series(2, 261) item
			`
}
