ALTER TABLE entity_state_snapshots ADD COLUMN IF NOT EXISTS canonical boolean NOT NULL DEFAULT true;

UPDATE protocol_timeline_entries SET
	summary_data = CASE WHEN jsonb_typeof(summary_data) = 'string' THEN (summary_data #>> '{}')::jsonb ELSE summary_data END,
	related_entities = CASE WHEN jsonb_typeof(related_entities) = 'string' THEN (related_entities #>> '{}')::jsonb ELSE related_entities END;
UPDATE open_oracle_report_events SET report_data = (report_data #>> '{}')::jsonb WHERE jsonb_typeof(report_data) = 'string';
UPDATE escalation_game_events SET event_data = (event_data #>> '{}')::jsonb WHERE jsonb_typeof(event_data) = 'string';
UPDATE truth_auction_events SET event_data = (event_data #>> '{}')::jsonb WHERE jsonb_typeof(event_data) = 'string';
UPDATE amm_trade_events SET event_data = (event_data #>> '{}')::jsonb WHERE jsonb_typeof(event_data) = 'string';
UPDATE fork_migration_events SET event_data = (event_data #>> '{}')::jsonb WHERE jsonb_typeof(event_data) = 'string';
UPDATE entity_state_snapshots SET read_result = (read_result #>> '{}')::jsonb WHERE jsonb_typeof(read_result) = 'string';
UPDATE live_events SET payload = (payload #>> '{}')::jsonb WHERE jsonb_typeof(payload) = 'string';

CREATE INDEX IF NOT EXISTS entity_state_snapshot_canonical_latest
	ON entity_state_snapshots(chain_id, entity_type, entity_identity, block_number DESC, observed_at DESC)
	WHERE canonical;

CREATE INDEX IF NOT EXISTS open_oracle_report_round_page
	ON open_oracle_report_events(chain_id, open_oracle_address, report_id, block_number DESC, log_index DESC, tx_hash DESC)
	WHERE canonical;

CREATE INDEX IF NOT EXISTS escalation_game_event_page
	ON escalation_game_events(chain_id, game_address, block_number DESC, log_index DESC, tx_hash DESC)
	WHERE canonical;

CREATE INDEX IF NOT EXISTS truth_auction_event_page
	ON truth_auction_events(chain_id, auction_address, block_number DESC, log_index DESC, tx_hash DESC)
	WHERE canonical;

CREATE INDEX IF NOT EXISTS amm_trade_interval
	ON amm_trade_events(chain_id, market_address, block_number, log_index, tx_hash)
	WHERE canonical;

CREATE INDEX IF NOT EXISTS fork_migration_page
	ON fork_migration_events(chain_id, universe_identity, block_number DESC, log_index DESC, tx_hash DESC)
	WHERE canonical;

CREATE INDEX IF NOT EXISTS protocol_timeline_page
	ON protocol_timeline_entries(chain_id, entity_type, entity_identity, block_number DESC, log_index DESC, tx_hash DESC)
	WHERE canonical;

-- Older rows predate the explicit snapshot canonicality column. Their block is
-- still the source of truth, so synchronize them before enforcing it directly.
UPDATE entity_state_snapshots snapshot
SET canonical = block.canonical
FROM blocks block
WHERE block.chain_id = snapshot.chain_id AND block.hash = snapshot.block_hash
	AND snapshot.canonical IS DISTINCT FROM block.canonical;

INSERT INTO escalation_game_events (
	chain_id, block_hash, tx_hash, log_index, block_number, game_address, event_name, event_data, canonical
)
SELECT chain_id, block_hash, tx_hash, log_index, block_number, emitter_address, event_name, arguments, canonical
FROM logs
WHERE decode_status = 'decoded' AND event_name IN (
	'CarryDepositConsumed', 'ClaimDeposit', 'DepositOnOutcome', 'ForkCarryCheckpoint',
	'ForkContinuationResumed', 'ForkedEscrowClaimed', 'ForkedEscrowExported', 'ForkedEscrowRecorded',
	'GameContinuedFromFork', 'GameStarted', 'InheritedThresholdTie', 'LocalDepositAppended',
	'NonDecisionReached', 'ResidualRepSweptToSecurityPool', 'TruthAuctionHaircutApplied',
	'VaultEscrowUpdated', 'VaultUnresolvedTotalsExported'
)
ON CONFLICT (chain_id, block_hash, tx_hash, log_index, game_address) DO NOTHING;

INSERT INTO fork_migration_events (
	chain_id, block_hash, tx_hash, log_index, block_number, universe_identity, event_name, event_data, canonical
)
SELECT chain_id, block_hash, tx_hash, log_index, block_number,
	COALESCE(arguments->>'childUniverseId', arguments->>'universeId', arguments->>'childPool',
		arguments->>'parentPool', arguments->>'securityPool', emitter_address),
	event_name, arguments, canonical
FROM logs
WHERE decode_status = 'decoded' AND event_name IN (
	'UniverseForked', 'DeployChild', 'MigrationRepAdded', 'MigrationRepSplit', 'RepBurned',
	'ChildDisputeStakedRepMaterialized', 'ChildPoolLinked', 'ChildRepSplit', 'ClaimAuctionProceeds',
	'ClaimForkedEscalationDepositsToWallet', 'DisputeStakedRepDrainedAtFork', 'ParentRepLocked',
	'PoolHeldRepSweptToChild', 'SecurityPoolForkSnapshot', 'TruthAuctionFinalized', 'TruthAuctionStarted',
	'VaultBadDebtMigrated', 'VaultMigrationCheckpoint', 'Migrate'
)
ON CONFLICT (chain_id, block_hash, tx_hash, log_index, universe_identity) DO NOTHING;

INSERT INTO protocol_timeline_entries (
	chain_id, block_hash, tx_hash, log_index, block_number, entity_type, entity_identity,
	semantic_event_kind, summary_data, related_entities, source_contract, source_event, canonical
)
SELECT chain_id, block_hash, tx_hash, log_index, block_number,
	CASE
		WHEN event_name IN ('ReportSubmitted', 'ReportDisputed', 'ReportSettled') THEN 'open-oracle-report'
		WHEN event_name IN ('CoordinatorStateCheckpoint', 'ExecutedStagedOperation', 'LiquidationRouteStaged', 'PendingReportRecovered', 'PriceReportRejected', 'PriceReported', 'PriceRequested', 'RepEthPriceSet', 'SecurityPoolSet', 'StagedOperationQueued') THEN 'price-coordinator'
		WHEN event_name IN ('CarryDepositConsumed', 'ClaimDeposit', 'DepositOnOutcome', 'ForkCarryCheckpoint', 'ForkContinuationResumed', 'ForkedEscrowClaimed', 'ForkedEscrowExported', 'ForkedEscrowRecorded', 'GameContinuedFromFork', 'GameStarted', 'InheritedThresholdTie', 'LocalDepositAppended', 'NonDecisionReached', 'ResidualRepSweptToSecurityPool', 'TruthAuctionHaircutApplied', 'VaultEscrowUpdated', 'VaultUnresolvedTotalsExported') THEN 'escalation'
		WHEN event_name IN ('AuctionStarted', 'BidSubmitted', 'AuctionFinalized', 'BidSettled', 'EthRefundDeferred', 'PendingEthRefundWithdrawn') THEN 'auction'
		WHEN event_name IN ('DepositToEscalationGame', 'RepDepositedToVault', 'RepRedeemedFromVault', 'RepWithdrawnFromVault', 'VaultAccountingCheckpoint', 'VaultBadDebtRecorded', 'VaultLiquidated', 'VaultTargetHealthFactorSet') THEN 'vault'
		WHEN event_name IN ('LiquidityAdded', 'LiquidityInitialized', 'LiquidityRemoved', 'PredeploymentSharesQuarantined', 'Swap', 'Sync') THEN 'amm'
		WHEN event_name IN ('UniverseForked', 'DeployChild', 'MigrationRepAdded', 'MigrationRepSplit', 'RepBurned', 'ChildDisputeStakedRepMaterialized', 'ChildPoolLinked', 'ChildRepSplit', 'ClaimAuctionProceeds', 'ClaimForkedEscalationDepositsToWallet', 'DisputeStakedRepDrainedAtFork', 'ParentRepLocked', 'PoolHeldRepSweptToChild', 'SecurityPoolForkSnapshot', 'TruthAuctionFinalized', 'TruthAuctionStarted', 'VaultBadDebtMigrated', 'VaultMigrationCheckpoint', 'Migrate') THEN 'fork'
		ELSE 'pool'
	END,
	CASE
		WHEN event_name IN ('ReportSubmitted', 'ReportDisputed', 'ReportSettled') THEN emitter_address || ':' || (arguments->>'reportId')
		WHEN event_name IN ('DepositToEscalationGame', 'RepDepositedToVault', 'RepRedeemedFromVault', 'RepWithdrawnFromVault', 'VaultAccountingCheckpoint', 'VaultBadDebtRecorded', 'VaultLiquidated', 'VaultTargetHealthFactorSet') THEN emitter_address || ':' || COALESCE(arguments->>'vault', arguments->>'targetVault')
		WHEN event_name IN ('UniverseForked', 'DeployChild', 'MigrationRepAdded', 'MigrationRepSplit', 'RepBurned', 'ChildDisputeStakedRepMaterialized', 'ChildPoolLinked', 'ChildRepSplit', 'ClaimAuctionProceeds', 'ClaimForkedEscalationDepositsToWallet', 'DisputeStakedRepDrainedAtFork', 'ParentRepLocked', 'PoolHeldRepSweptToChild', 'SecurityPoolForkSnapshot', 'TruthAuctionFinalized', 'TruthAuctionStarted', 'VaultBadDebtMigrated', 'VaultMigrationCheckpoint', 'Migrate') THEN COALESCE(arguments->>'childUniverseId', arguments->>'universeId', arguments->>'childPool', arguments->>'parentPool', arguments->>'securityPool', emitter_address)
		ELSE emitter_address
	END,
	event_name, arguments, '[]'::jsonb, emitter_address, event_name, canonical
FROM logs
WHERE decode_status = 'decoded' AND event_name IN (
	'ReportSubmitted', 'ReportDisputed', 'ReportSettled',
	'CoordinatorStateCheckpoint', 'ExecutedStagedOperation', 'LiquidationRouteStaged', 'PendingReportRecovered', 'PriceReportRejected', 'PriceReported', 'PriceRequested', 'RepEthPriceSet', 'SecurityPoolSet', 'StagedOperationQueued',
	'CarryDepositConsumed', 'ClaimDeposit', 'DepositOnOutcome', 'ForkCarryCheckpoint', 'ForkContinuationResumed', 'ForkedEscrowClaimed', 'ForkedEscrowExported', 'ForkedEscrowRecorded', 'GameContinuedFromFork', 'GameStarted', 'InheritedThresholdTie', 'LocalDepositAppended', 'NonDecisionReached', 'ResidualRepSweptToSecurityPool', 'TruthAuctionHaircutApplied', 'VaultEscrowUpdated', 'VaultUnresolvedTotalsExported',
	'AuctionStarted', 'BidSubmitted', 'AuctionFinalized', 'BidSettled', 'EthRefundDeferred', 'PendingEthRefundWithdrawn',
	'AwaitingForkContinuationSet', 'CompleteSetCreated', 'CompleteSetRedeemed', 'EscalationGameSet', 'PoolAccountingCheckpoint', 'PoolForkModeActivated', 'ShareTokenSupplySet', 'SharesRedeemed', 'SystemStateSet', 'TotalRepBackingUnitsSet',
	'DepositToEscalationGame', 'RepDepositedToVault', 'RepRedeemedFromVault', 'RepWithdrawnFromVault', 'VaultAccountingCheckpoint', 'VaultBadDebtRecorded', 'VaultLiquidated', 'VaultTargetHealthFactorSet',
	'LiquidityAdded', 'LiquidityInitialized', 'LiquidityRemoved', 'PredeploymentSharesQuarantined', 'Swap', 'Sync',
	'UniverseForked', 'DeployChild', 'MigrationRepAdded', 'MigrationRepSplit', 'RepBurned', 'ChildDisputeStakedRepMaterialized', 'ChildPoolLinked', 'ChildRepSplit', 'ClaimAuctionProceeds', 'ClaimForkedEscalationDepositsToWallet', 'DisputeStakedRepDrainedAtFork', 'ParentRepLocked', 'PoolHeldRepSweptToChild', 'SecurityPoolForkSnapshot', 'TruthAuctionFinalized', 'TruthAuctionStarted', 'VaultBadDebtMigrated', 'VaultMigrationCheckpoint', 'Migrate'
)
ON CONFLICT (chain_id, block_hash, tx_hash, log_index, entity_type, entity_identity) DO NOTHING;
