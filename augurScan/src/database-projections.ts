import type { SQL } from 'bun'
import { databaseJsonText } from './database-json.ts'
import { zeroAddress } from './ethereum.ts'
import { type Projection, projectionsFrom } from './projections.ts'
import type { StoredLog } from './types.ts'
import { isSupportedUniswapV4Market } from './uniswap.ts'

const unsupportedProjection = (projection: never): never => {
	throw new Error(`Unsupported database projection: ${String(projection)}`)
}

const storeDomainEvent = async (transaction: SQL, chainId: number, item: StoredLog, projection: Extract<Projection, { type: 'domainEvent' }>) => {
	const position = [chainId, item.blockHash, item.transactionHash, item.logIndex, item.blockNumber.toString()] as const
	await transaction`
		INSERT INTO protocol_timeline_entries (chain_id, block_hash, tx_hash, log_index, block_number, entity_type, entity_identity, semantic_event_kind, summary_data, related_entities, source_contract, source_event, canonical)
		VALUES (${position[0]}, ${position[1]}, ${position[2]}, ${position[3]}, ${position[4]}, ${projection.entityType}, ${projection.entityIdentity}, ${projection.semanticEventKind}, (${databaseJsonText(projection.data)}::text)::jsonb, (${databaseJsonText(projection.relatedEntities)}::text)::jsonb, ${item.address.toLowerCase()}, ${projection.semanticEventKind}, true)
		ON CONFLICT (chain_id, block_hash, tx_hash, log_index, entity_type, entity_identity) DO UPDATE SET canonical = true, summary_data = EXCLUDED.summary_data, related_entities = EXCLUDED.related_entities
	`
	if (projection.domain === 'report') {
		const reportId = projection.data['reportId']
		const roundNumber = projection.data['numReports']
		if (typeof reportId !== 'string') throw new Error(`${projection.semanticEventKind} is missing reportId`)
		await transaction`
			INSERT INTO open_oracle_report_events (chain_id, block_hash, tx_hash, log_index, block_number, open_oracle_address, report_id, event_name, round_number, report_data, canonical)
			VALUES (${position[0]}, ${position[1]}, ${position[2]}, ${position[3]}, ${position[4]}, ${item.address.toLowerCase()}, ${reportId}, ${projection.semanticEventKind}, ${typeof roundNumber === 'string' ? roundNumber : null}, (${databaseJsonText(projection.data)}::text)::jsonb, true)
			ON CONFLICT (chain_id, block_hash, tx_hash, log_index, open_oracle_address, report_id) DO UPDATE SET canonical = true, report_data = EXCLUDED.report_data
		`
		return
	}
	if (projection.domain === 'escalation') {
		await transaction`
			INSERT INTO escalation_game_events (chain_id, block_hash, tx_hash, log_index, block_number, game_address, event_name, event_data, canonical)
			VALUES (${position[0]}, ${position[1]}, ${position[2]}, ${position[3]}, ${position[4]}, ${item.address.toLowerCase()}, ${projection.semanticEventKind}, (${databaseJsonText(projection.data)}::text)::jsonb, true)
			ON CONFLICT (chain_id, block_hash, tx_hash, log_index, game_address) DO UPDATE SET canonical = true, event_data = EXCLUDED.event_data
		`
		return
	}
	if (projection.domain === 'auction') {
		await transaction`
			INSERT INTO truth_auction_events (chain_id, block_hash, tx_hash, log_index, block_number, auction_address, event_name, event_data, canonical)
			VALUES (${position[0]}, ${position[1]}, ${position[2]}, ${position[3]}, ${position[4]}, ${item.address.toLowerCase()}, ${projection.semanticEventKind}, (${databaseJsonText(projection.data)}::text)::jsonb, true)
			ON CONFLICT (chain_id, block_hash, tx_hash, log_index, auction_address) DO UPDATE SET canonical = true, event_data = EXCLUDED.event_data
		`
		return
	}
	if (projection.domain === 'trading') {
		await transaction`
			INSERT INTO amm_trade_events (chain_id, block_hash, tx_hash, log_index, block_number, market_address, event_name, event_data, canonical)
			VALUES (${position[0]}, ${position[1]}, ${position[2]}, ${position[3]}, ${position[4]}, ${item.address.toLowerCase()}, ${projection.semanticEventKind}, (${databaseJsonText(projection.data)}::text)::jsonb, true)
			ON CONFLICT (chain_id, block_hash, tx_hash, log_index, market_address) DO UPDATE SET canonical = true, event_data = EXCLUDED.event_data
		`
		return
	}
	if (projection.domain === 'fork') {
		await transaction`
			INSERT INTO fork_migration_events (chain_id, block_hash, tx_hash, log_index, block_number, universe_identity, event_name, event_data, canonical)
			VALUES (${position[0]}, ${position[1]}, ${position[2]}, ${position[3]}, ${position[4]}, ${projection.entityIdentity}, ${projection.semanticEventKind}, (${databaseJsonText(projection.data)}::text)::jsonb, true)
			ON CONFLICT (chain_id, block_hash, tx_hash, log_index, universe_identity) DO UPDATE SET canonical = true, event_data = EXCLUDED.event_data
		`
		return
	}
	if (projection.domain === 'approval') {
		const approvalId = projection.data['approvalId']
		const receiverVault = projection.data['receiverVault']
		await transaction`
			INSERT INTO liquidation_approval_events (chain_id, block_hash, tx_hash, transaction_index, log_index, block_number, registry_address, approval_identity, receiver_vault, event_name, event_data, canonical)
			VALUES (${position[0]}, ${position[1]}, ${position[2]}, ${item.transactionIndex}, ${position[3]}, ${position[4]}, ${item.address.toLowerCase()}, ${typeof approvalId === 'string' ? approvalId.toLowerCase() : `nonce:${String(receiverVault ?? 'unknown').toLowerCase()}`}, ${typeof receiverVault === 'string' ? receiverVault.toLowerCase() : null}, ${projection.semanticEventKind}, (${databaseJsonText(projection.data)}::text)::jsonb, true)
			ON CONFLICT (chain_id, block_hash, tx_hash, log_index, registry_address) DO UPDATE SET canonical = true, event_data = EXCLUDED.event_data
		`
		return
	}
	if (projection.domain === 'oracle' || projection.domain === 'risk') return
	return unsupportedProjection(projection.domain)
}

const storeProjection = async (transaction: SQL, chainId: number, item: StoredLog, projection: Projection): Promise<void> => {
	const position = [chainId, item.blockHash, item.transactionHash, item.logIndex, item.blockNumber.toString()] as const
	if (projection.type === 'domainEvent') return await storeDomainEvent(transaction, chainId, item, projection)
	if (projection.type === 'question') {
		await transaction`
			INSERT INTO questions (chain_id, block_hash, tx_hash, log_index, block_number, question_id, created_timestamp, title, description, start_time, end_time, num_ticks, display_value_min, display_value_max, answer_unit, outcome_options, canonical)
			VALUES (${position[0]}, ${position[1]}, ${position[2]}, ${position[3]}, ${position[4]}, ${projection.questionId}, ${projection.createdTimestamp}, ${projection.title}, ${projection.description}, ${projection.startTime}, ${projection.endTime}, ${projection.numTicks}, ${projection.displayValueMin}, ${projection.displayValueMax}, ${projection.answerUnit}, (${databaseJsonText(projection.outcomeOptions)}::text)::jsonb, true)
			ON CONFLICT (chain_id, block_hash, tx_hash, log_index, question_id) DO UPDATE SET canonical = true
		`
		return
	}
	if (projection.type === 'pool') {
		await transaction`
			INSERT INTO pools (chain_id, block_hash, tx_hash, log_index, block_number, pool_address, parent_address, universe_id, question_id, truth_auction_address, coordinator_address, share_token_address, security_multiplier_bps, initial_priority_fee_atto_eth_per_gas, initial_retention_rate, initial_settlement_collateral_atto_eth, canonical)
			VALUES (${position[0]}, ${position[1]}, ${position[2]}, ${position[3]}, ${position[4]}, ${projection.poolAddress}, ${projection.parentAddress}, ${projection.universeId}, ${projection.questionId}, ${projection.truthAuctionAddress}, ${projection.coordinatorAddress}, ${projection.shareTokenAddress}, ${projection.securityMultiplierBps}, ${projection.initialPriorityFeeAttoEthPerGas}, ${projection.initialRetentionRate}, ${projection.initialSettlementCollateralAttoEth}, true)
			ON CONFLICT (chain_id, block_hash, tx_hash, log_index, pool_address) DO UPDATE SET canonical = true
		`
		return
	}
	if (projection.type === 'poolSnapshot') {
		await transaction`
			INSERT INTO pool_snapshots (chain_id, block_hash, tx_hash, log_index, block_number, pool_address, reason, vault_address, settlement_collateral_atto_eth, total_capacity_ownership_atto_rep, fee_eligible_capacity_ownership_atto_rep, total_claimable_vault_fees_atto_eth, unallocated_accrued_fees_atto_eth, fee_index, fee_index_remainder, total_fees_owed_remainder, uncheckpointed_fee_eligible_capacity_ownership_atto_rep, last_updated_fee_accumulator, current_retention_rate, canonical)
			VALUES (${position[0]}, ${position[1]}, ${position[2]}, ${position[3]}, ${position[4]}, ${projection.poolAddress}, ${projection.reason}, ${projection.vaultAddress}, ${projection.settlementCollateralAttoEth}, ${projection.totalCapacityOwnershipAttoRep}, ${projection.feeEligibleCapacityOwnershipAttoRep}, ${projection.totalClaimableVaultFeesAttoEth}, ${projection.unallocatedAccruedFeesAttoEth}, ${projection.feeIndex}, ${projection.feeIndexRemainder}, ${projection.totalFeesOwedRemainder}, ${projection.uncheckpointedFeeEligibleCapacityOwnershipAttoRep}, ${projection.lastUpdatedFeeAccumulator}, ${projection.currentRetentionRate}, true)
			ON CONFLICT (chain_id, block_hash, tx_hash, log_index, pool_address) DO UPDATE SET canonical = true
		`
		return
	}
	if (projection.type === 'vaultSnapshot') {
		await transaction`
			INSERT INTO vault_snapshots (chain_id, block_hash, tx_hash, log_index, block_number, pool_address, vault_address, rep_backing_units, capacity_ownership_atto_rep, claimable_fees_atto_eth, fee_index, vault_fee_remainder, resulting_total_rep_backing_units, resulting_fee_eligible_capacity_ownership_atto_rep, canonical)
			VALUES (${position[0]}, ${position[1]}, ${position[2]}, ${position[3]}, ${position[4]}, ${projection.poolAddress}, ${projection.vaultAddress}, ${projection.repBackingUnits}, ${projection.capacityOwnershipAttoRep}, ${projection.claimableFeesAttoEth}, ${projection.feeIndex}, ${projection.vaultFeeRemainder}, ${projection.resultingTotalRepBackingUnits}, ${projection.resultingFeeEligibleCapacityOwnershipAttoRep}, true)
			ON CONFLICT (chain_id, block_hash, tx_hash, log_index, pool_address, vault_address) DO UPDATE SET canonical = true
		`
		return
	}
	if (projection.type === 'poolState') {
		await transaction`
			INSERT INTO pool_state_events (chain_id, block_hash, tx_hash, log_index, block_number, pool_address, event_name, state, canonical)
			VALUES (${position[0]}, ${position[1]}, ${position[2]}, ${position[3]}, ${position[4]}, ${projection.poolAddress}, ${projection.eventName}, (${databaseJsonText(projection.state)}::text)::jsonb, true)
			ON CONFLICT (chain_id, block_hash, tx_hash, log_index, pool_address) DO UPDATE SET canonical = true, state = EXCLUDED.state
		`
		return
	}
	if (projection.type === 'ammMarket') {
		await transaction`
			INSERT INTO amm_markets (chain_id, block_hash, tx_hash, log_index, block_number, pair_address, pool_address, share_token_address, universe_id, fee_bps, canonical)
			VALUES (${position[0]}, ${position[1]}, ${position[2]}, ${position[3]}, ${position[4]}, ${projection.pairAddress}, ${projection.poolAddress}, ${projection.shareTokenAddress}, ${projection.universeId}, ${projection.feeBps}, true)
			ON CONFLICT (chain_id, block_hash, tx_hash, log_index, pair_address) DO UPDATE SET canonical = true
		`
		return
	}
	if (projection.type === 'ammPrice') {
		await transaction`
			INSERT INTO amm_price_snapshots (chain_id, block_hash, tx_hash, log_index, block_number, pair_address, yes_reserve_atto_shares, no_reserve_atto_shares, conditional_yes_bps, conditional_no_bps, canonical)
			VALUES (${position[0]}, ${position[1]}, ${position[2]}, ${position[3]}, ${position[4]}, ${projection.pairAddress}, ${projection.yesReserveAttoShares}, ${projection.noReserveAttoShares}, ${projection.conditionalYesBps}, ${projection.conditionalNoBps}, true)
			ON CONFLICT (chain_id, block_hash, tx_hash, log_index, pair_address) DO UPDATE SET canonical = true
		`
		return
	}
	if (projection.type === 'repEthPrice') {
		await transaction`
			INSERT INTO rep_eth_price_snapshots (chain_id, block_hash, tx_hash, log_index, block_number, coordinator_address, event_name, report_id, rep_per_eth_1e18, settlement_timestamp, canonical)
			VALUES (${position[0]}, ${position[1]}, ${position[2]}, ${position[3]}, ${position[4]}, ${projection.coordinatorAddress}, ${projection.eventName}, ${projection.reportId ?? null}, ${projection.repPerEth1e18}, ${projection.settlementTimestamp ?? null}, true)
			ON CONFLICT (chain_id, block_hash, tx_hash, log_index, coordinator_address) DO UPDATE SET canonical = true
		`
		return
	}
	if (projection.type === 'uniswapMarket') {
		const supportedV4Market = projection.venue === 'v4' && isSupportedUniswapV4Market(projection)
		await transaction`
			INSERT INTO uniswap_rep_eth_markets (chain_id, block_hash, tx_hash, log_index, block_number, venue, market_id, contract_address, token0_address, token1_address, fee_hundredths_bip, tick_spacing, hooks_address, canonical)
			SELECT ${position[0]}, ${position[1]}, ${position[2]}, ${position[3]}, ${position[4]}, ${projection.venue}, ${projection.marketId}, ${projection.contractAddress}, ${projection.token0Address}, ${projection.token1Address}, ${projection.feeHundredthsBip}, ${projection.tickSpacing ?? null}, ${projection.hooksAddress ?? null}, true
			WHERE (
				${projection.venue} IN ('v2', 'v3') AND (
					EXISTS (SELECT 1 FROM contracts WHERE chain_id = ${chainId} AND address = ${projection.token0Address} AND kind = 'reputationToken' AND canonical)
					AND EXISTS (SELECT 1 FROM contracts WHERE chain_id = ${chainId} AND address = ${projection.token1Address} AND kind IN ('weth', 'usdc') AND canonical)
					OR EXISTS (SELECT 1 FROM contracts WHERE chain_id = ${chainId} AND address = ${projection.token1Address} AND kind = 'reputationToken' AND canonical)
					AND EXISTS (SELECT 1 FROM contracts WHERE chain_id = ${chainId} AND address = ${projection.token0Address} AND kind IN ('weth', 'usdc') AND canonical)
				)
				) OR (
					${projection.venue} = 'v4'
					AND ${supportedV4Market}
					AND EXISTS (SELECT 1 FROM contracts WHERE chain_id = ${chainId} AND address = ${projection.contractAddress} AND kind = 'uniswapV4PoolManager' AND canonical)
					AND (
						${projection.token0Address} = ${zeroAddress}
						AND EXISTS (SELECT 1 FROM contracts WHERE chain_id = ${chainId} AND address = ${projection.token1Address} AND kind = 'reputationToken' AND canonical)
						OR EXISTS (SELECT 1 FROM contracts WHERE chain_id = ${chainId} AND address = ${projection.token0Address} AND kind = 'reputationToken' AND canonical)
						AND EXISTS (SELECT 1 FROM contracts WHERE chain_id = ${chainId} AND address = ${projection.token1Address} AND kind = 'usdc' AND canonical)
						OR EXISTS (SELECT 1 FROM contracts WHERE chain_id = ${chainId} AND address = ${projection.token1Address} AND kind = 'reputationToken' AND canonical)
						AND EXISTS (SELECT 1 FROM contracts WHERE chain_id = ${chainId} AND address = ${projection.token0Address} AND kind = 'usdc' AND canonical)
					)
				)
			ON CONFLICT (chain_id, block_hash, tx_hash, log_index, market_id) DO UPDATE SET canonical = true
		`
		return
	}
	if (projection.type === 'uniswapPrice') {
		await transaction`
			INSERT INTO uniswap_rep_eth_price_observations (chain_id, block_hash, tx_hash, log_index, block_number, venue, market_id, event_name, reserve0, reserve1, sqrt_price_x96, liquidity, canonical)
			SELECT ${position[0]}, ${position[1]}, ${position[2]}, ${position[3]}, ${position[4]}, ${projection.venue}, ${projection.marketId}, ${projection.eventName}, ${projection.reserve0 ?? null}, ${projection.reserve1 ?? null}, ${projection.sqrtPriceX96 ?? null}, ${projection.liquidity ?? null}, true
			WHERE EXISTS (
				SELECT 1 FROM uniswap_rep_eth_markets
				WHERE chain_id = ${chainId} AND venue = ${projection.venue} AND market_id = ${projection.marketId} AND canonical
			)
			ON CONFLICT (chain_id, block_hash, tx_hash, log_index, market_id) DO UPDATE SET canonical = true
		`
		return
	}
	if (projection.type === 'universe') {
		await transaction`
			INSERT INTO universe_events (chain_id, block_hash, tx_hash, log_index, block_number, universe_id, event_name, parent_universe_id, forking_outcome_index, reputation_token_address, fork_question_id, fork_time, forker_address, fork_threshold_atto_rep, migration_rep_balance_atto_rep, theoretical_supply_atto_rep, canonical)
			VALUES (${position[0]}, ${position[1]}, ${position[2]}, ${position[3]}, ${position[4]}, ${projection.universeId}, ${projection.eventName}, ${projection.parentUniverseId ?? null}, ${projection.forkingOutcomeIndex ?? null}, ${projection.reputationTokenAddress ?? null}, ${projection.forkQuestionId ?? null}, ${projection.forkTime ?? null}, ${projection.forkerAddress ?? null}, ${projection.forkThresholdAttoRep ?? null}, ${projection.migrationRepBalanceAttoRep ?? null}, ${projection.theoreticalSupplyAttoRep ?? null}, true)
			ON CONFLICT (chain_id, block_hash, tx_hash, log_index, universe_id) DO UPDATE SET canonical = true
		`
		return
	}
	return unsupportedProjection(projection)
}

export const storeLogProjections = async (transaction: SQL, chainId: number, item: StoredLog): Promise<void> => {
	for (const projection of projectionsFrom(item)) await storeProjection(transaction, chainId, item, projection)
}
