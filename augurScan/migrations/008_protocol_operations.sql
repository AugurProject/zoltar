CREATE TABLE IF NOT EXISTS protocol_timeline_entries (
	chain_id bigint NOT NULL,
	block_hash text NOT NULL,
	tx_hash text NOT NULL,
	log_index integer NOT NULL,
	block_number bigint NOT NULL,
	entity_type text NOT NULL,
	entity_identity text NOT NULL,
	semantic_event_kind text NOT NULL,
	summary_data jsonb NOT NULL,
	related_entities jsonb NOT NULL DEFAULT '[]'::jsonb,
	source_contract text NOT NULL,
	source_event text NOT NULL,
	canonical boolean NOT NULL DEFAULT true,
	observed_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (chain_id, block_hash, tx_hash, log_index, entity_type, entity_identity),
	FOREIGN KEY (chain_id, block_hash, tx_hash, log_index) REFERENCES logs(chain_id, block_hash, tx_hash, log_index)
);

ALTER TABLE uniswap_rep_eth_price_observations ADD COLUMN IF NOT EXISTS liquidity numeric(78, 0);
CREATE INDEX IF NOT EXISTS protocol_timeline_entity
	ON protocol_timeline_entries(chain_id, entity_type, entity_identity, block_number DESC, log_index DESC) WHERE canonical;
CREATE INDEX IF NOT EXISTS protocol_timeline_recent
	ON protocol_timeline_entries(chain_id, block_number DESC, log_index DESC) WHERE canonical;

-- Bun serializes a JavaScript string once more when PostgreSQL infers a jsonb
-- parameter. Normalize rows written by older scanner builds before projecting
-- their decoded arguments.
UPDATE transactions SET receipt = (receipt #>> '{}')::jsonb WHERE jsonb_typeof(receipt) = 'string';
UPDATE actions SET
	arguments = CASE WHEN jsonb_typeof(arguments) = 'string' THEN (arguments #>> '{}')::jsonb ELSE arguments END,
	display_arguments = CASE WHEN jsonb_typeof(display_arguments) = 'string' THEN (display_arguments #>> '{}')::jsonb ELSE display_arguments END,
	argument_schema = CASE WHEN jsonb_typeof(argument_schema) = 'string' THEN (argument_schema #>> '{}')::jsonb ELSE argument_schema END;
UPDATE logs SET
	topics = CASE WHEN jsonb_typeof(topics) = 'string' THEN (topics #>> '{}')::jsonb ELSE topics END,
	arguments = CASE WHEN jsonb_typeof(arguments) = 'string' THEN (arguments #>> '{}')::jsonb ELSE arguments END,
	display_arguments = CASE WHEN jsonb_typeof(display_arguments) = 'string' THEN (display_arguments #>> '{}')::jsonb ELSE display_arguments END,
	argument_schema = CASE WHEN jsonb_typeof(argument_schema) = 'string' THEN (argument_schema #>> '{}')::jsonb ELSE argument_schema END;

CREATE TABLE IF NOT EXISTS open_oracle_report_events (
	chain_id bigint NOT NULL,
	block_hash text NOT NULL,
	tx_hash text NOT NULL,
	log_index integer NOT NULL,
	block_number bigint NOT NULL,
	open_oracle_address text NOT NULL,
	report_id numeric(78, 0) NOT NULL,
	event_name text NOT NULL CHECK (event_name IN ('ReportSubmitted', 'ReportDisputed', 'ReportSettled')),
	round_number numeric(78, 0),
	report_data jsonb NOT NULL,
	canonical boolean NOT NULL DEFAULT true,
	observed_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (chain_id, block_hash, tx_hash, log_index, open_oracle_address, report_id),
	FOREIGN KEY (chain_id, block_hash, tx_hash, log_index) REFERENCES logs(chain_id, block_hash, tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS open_oracle_reports_current
	ON open_oracle_report_events(chain_id, open_oracle_address, report_id, block_number DESC, log_index DESC) WHERE canonical;

CREATE TABLE IF NOT EXISTS escalation_game_events (
	chain_id bigint NOT NULL,
	block_hash text NOT NULL,
	tx_hash text NOT NULL,
	log_index integer NOT NULL,
	block_number bigint NOT NULL,
	game_address text NOT NULL,
	event_name text NOT NULL,
	event_data jsonb NOT NULL,
	canonical boolean NOT NULL DEFAULT true,
	observed_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (chain_id, block_hash, tx_hash, log_index, game_address),
	FOREIGN KEY (chain_id, block_hash, tx_hash, log_index) REFERENCES logs(chain_id, block_hash, tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS escalation_games_current
	ON escalation_game_events(chain_id, game_address, block_number DESC, log_index DESC) WHERE canonical;

CREATE TABLE IF NOT EXISTS truth_auction_events (
	chain_id bigint NOT NULL,
	block_hash text NOT NULL,
	tx_hash text NOT NULL,
	log_index integer NOT NULL,
	block_number bigint NOT NULL,
	auction_address text NOT NULL,
	event_name text NOT NULL,
	event_data jsonb NOT NULL,
	canonical boolean NOT NULL DEFAULT true,
	observed_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (chain_id, block_hash, tx_hash, log_index, auction_address),
	FOREIGN KEY (chain_id, block_hash, tx_hash, log_index) REFERENCES logs(chain_id, block_hash, tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS truth_auctions_current
	ON truth_auction_events(chain_id, auction_address, block_number DESC, log_index DESC) WHERE canonical;

CREATE TABLE IF NOT EXISTS amm_trade_events (
	chain_id bigint NOT NULL,
	block_hash text NOT NULL,
	tx_hash text NOT NULL,
	log_index integer NOT NULL,
	block_number bigint NOT NULL,
	market_address text NOT NULL,
	event_name text NOT NULL,
	event_data jsonb NOT NULL,
	canonical boolean NOT NULL DEFAULT true,
	observed_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (chain_id, block_hash, tx_hash, log_index, market_address),
	FOREIGN KEY (chain_id, block_hash, tx_hash, log_index) REFERENCES logs(chain_id, block_hash, tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS amm_trade_market
	ON amm_trade_events(chain_id, market_address, block_number DESC, log_index DESC) WHERE canonical;

CREATE TABLE IF NOT EXISTS fork_migration_events (
	chain_id bigint NOT NULL,
	block_hash text NOT NULL,
	tx_hash text NOT NULL,
	log_index integer NOT NULL,
	block_number bigint NOT NULL,
	universe_identity text NOT NULL,
	event_name text NOT NULL,
	event_data jsonb NOT NULL,
	canonical boolean NOT NULL DEFAULT true,
	observed_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (chain_id, block_hash, tx_hash, log_index, universe_identity),
	FOREIGN KEY (chain_id, block_hash, tx_hash, log_index) REFERENCES logs(chain_id, block_hash, tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS fork_migration_universe
	ON fork_migration_events(chain_id, universe_identity, block_number DESC, log_index DESC) WHERE canonical;

CREATE TABLE IF NOT EXISTS entity_state_snapshots (
	chain_id bigint NOT NULL,
	entity_type text NOT NULL,
	entity_identity text NOT NULL,
	block_number bigint NOT NULL,
	block_hash text NOT NULL,
	block_timestamp timestamptz NOT NULL,
	source_method text NOT NULL,
	read_status text NOT NULL CHECK (read_status IN ('success', 'failed', 'pending', 'stale')),
	read_result jsonb,
	read_failure_reason text,
	observed_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (chain_id, entity_type, entity_identity, block_hash, source_method),
	FOREIGN KEY (chain_id, block_hash) REFERENCES blocks(chain_id, hash)
);
CREATE INDEX IF NOT EXISTS entity_state_snapshot_latest
	ON entity_state_snapshots(chain_id, entity_type, entity_identity, block_number DESC);

-- Idempotent retained-log backfill. Future blocks use the equivalent typed
-- TypeScript projection in src/projections.ts.
INSERT INTO open_oracle_report_events (
	chain_id, block_hash, tx_hash, log_index, block_number, open_oracle_address,
	report_id, event_name, round_number, report_data, canonical
)
SELECT chain_id, block_hash, tx_hash, log_index, block_number, emitter_address,
	(arguments->>'reportId')::numeric, event_name,
	CASE WHEN arguments ? 'numReports' THEN (arguments->>'numReports')::numeric END,
	arguments, canonical
FROM logs
WHERE decode_status = 'decoded' AND event_name IN ('ReportSubmitted', 'ReportDisputed', 'ReportSettled')
ON CONFLICT (chain_id, block_hash, tx_hash, log_index, open_oracle_address, report_id) DO NOTHING;

INSERT INTO escalation_game_events (
	chain_id, block_hash, tx_hash, log_index, block_number, game_address, event_name, event_data, canonical
)
SELECT chain_id, block_hash, tx_hash, log_index, block_number, emitter_address, event_name, arguments, canonical
FROM logs
WHERE decode_status = 'decoded' AND event_name IN (
	'DepositOnOutcome', 'LocalDepositAppended', 'ClaimDeposit', 'NonDecisionReached',
	'InheritedThresholdTie', 'GameContinuedFromFork', 'ForkCarryCheckpoint', 'CarryDepositConsumed'
)
ON CONFLICT (chain_id, block_hash, tx_hash, log_index, game_address) DO NOTHING;

INSERT INTO truth_auction_events (
	chain_id, block_hash, tx_hash, log_index, block_number, auction_address, event_name, event_data, canonical
)
SELECT chain_id, block_hash, tx_hash, log_index, block_number, emitter_address, event_name, arguments, canonical
FROM logs
WHERE decode_status = 'decoded' AND event_name IN (
	'AuctionStarted', 'BidSubmitted', 'AuctionFinalized', 'BidSettled', 'EthRefundDeferred', 'PendingEthRefundWithdrawn'
)
ON CONFLICT (chain_id, block_hash, tx_hash, log_index, auction_address) DO NOTHING;

INSERT INTO amm_trade_events (
	chain_id, block_hash, tx_hash, log_index, block_number, market_address, event_name, event_data, canonical
)
SELECT chain_id, block_hash, tx_hash, log_index, block_number, emitter_address, event_name, arguments, canonical
FROM logs
WHERE decode_status = 'decoded' AND event_name IN ('Swap', 'Sync', 'LiquidityAdded', 'LiquidityInitialized', 'LiquidityRemoved')
ON CONFLICT (chain_id, block_hash, tx_hash, log_index, market_address) DO NOTHING;

INSERT INTO fork_migration_events (
	chain_id, block_hash, tx_hash, log_index, block_number, universe_identity, event_name, event_data, canonical
)
SELECT chain_id, block_hash, tx_hash, log_index, block_number,
	COALESCE(arguments->>'childUniverseId', arguments->>'universeId', emitter_address), event_name, arguments, canonical
FROM logs
WHERE decode_status = 'decoded' AND event_name IN (
	'UniverseForked', 'DeployChild', 'MigrationRepAdded', 'MigrationRepSplit', 'RepBurned',
	'ChildPoolLinked', 'VaultMigrationCheckpoint', 'ChildDisputeStakedRepMaterialized'
)
ON CONFLICT (chain_id, block_hash, tx_hash, log_index, universe_identity) DO NOTHING;

INSERT INTO protocol_timeline_entries (
	chain_id, block_hash, tx_hash, log_index, block_number, entity_type, entity_identity,
	semantic_event_kind, summary_data, related_entities, source_contract, source_event, canonical
)
SELECT chain_id, block_hash, tx_hash, log_index, block_number,
	CASE
		WHEN event_name IN ('ReportSubmitted', 'ReportDisputed', 'ReportSettled') THEN 'open-oracle-report'
		WHEN event_name IN ('DepositOnOutcome', 'LocalDepositAppended', 'ClaimDeposit', 'NonDecisionReached', 'InheritedThresholdTie', 'GameContinuedFromFork', 'ForkCarryCheckpoint', 'CarryDepositConsumed') THEN 'escalation'
		WHEN event_name IN ('AuctionStarted', 'BidSubmitted', 'AuctionFinalized', 'BidSettled', 'EthRefundDeferred', 'PendingEthRefundWithdrawn') THEN 'auction'
		WHEN event_name IN ('Swap', 'Sync', 'LiquidityAdded', 'LiquidityInitialized', 'LiquidityRemoved') THEN 'trading'
		WHEN event_name IN ('UniverseForked', 'DeployChild', 'MigrationRepAdded', 'MigrationRepSplit', 'RepBurned', 'ChildPoolLinked', 'VaultMigrationCheckpoint', 'ChildDisputeStakedRepMaterialized') THEN 'fork'
		ELSE 'risk'
	END,
	CASE
		WHEN event_name IN ('ReportSubmitted', 'ReportDisputed', 'ReportSettled') THEN emitter_address || ':' || (arguments->>'reportId')
		WHEN event_name IN ('UniverseForked', 'DeployChild', 'MigrationRepAdded', 'MigrationRepSplit', 'RepBurned', 'ChildPoolLinked', 'VaultMigrationCheckpoint', 'ChildDisputeStakedRepMaterialized') THEN COALESCE(arguments->>'childUniverseId', arguments->>'universeId', emitter_address)
		ELSE emitter_address
	END,
	event_name, arguments, '[]'::jsonb, emitter_address, event_name, canonical
FROM logs
WHERE decode_status = 'decoded' AND event_name IN (
	'ReportSubmitted', 'ReportDisputed', 'ReportSettled',
	'DepositOnOutcome', 'LocalDepositAppended', 'ClaimDeposit', 'NonDecisionReached', 'InheritedThresholdTie', 'GameContinuedFromFork', 'ForkCarryCheckpoint', 'CarryDepositConsumed',
	'AuctionStarted', 'BidSubmitted', 'AuctionFinalized', 'BidSettled', 'EthRefundDeferred', 'PendingEthRefundWithdrawn',
	'VaultLiquidated', 'VaultBadDebtMigrated', 'PoolAccountingCheckpoint', 'VaultAccountingCheckpoint', 'CompleteSetCreated', 'CompleteSetRedeemed', 'SharesRedeemed',
	'Swap', 'Sync', 'LiquidityAdded', 'LiquidityInitialized', 'LiquidityRemoved',
	'UniverseForked', 'DeployChild', 'MigrationRepAdded', 'MigrationRepSplit', 'RepBurned', 'ChildPoolLinked', 'VaultMigrationCheckpoint', 'ChildDisputeStakedRepMaterialized'
)
ON CONFLICT (chain_id, block_hash, tx_hash, log_index, entity_type, entity_identity) DO NOTHING;
