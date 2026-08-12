CREATE TABLE IF NOT EXISTS amm_markets (
	chain_id bigint NOT NULL,
	block_hash text NOT NULL,
	tx_hash text NOT NULL,
	log_index integer NOT NULL,
	block_number bigint NOT NULL,
	pair_address text NOT NULL,
	pool_address text NOT NULL,
	share_token_address text NOT NULL,
	universe_id numeric(78, 0) NOT NULL,
	fee_bps numeric(78, 0) NOT NULL,
	canonical boolean NOT NULL DEFAULT true,
	PRIMARY KEY (chain_id, block_hash, tx_hash, log_index, pair_address),
	FOREIGN KEY (chain_id, block_hash, tx_hash, log_index) REFERENCES logs(chain_id, block_hash, tx_hash, log_index)
);
CREATE UNIQUE INDEX IF NOT EXISTS amm_markets_canonical_pair ON amm_markets(chain_id, pair_address) WHERE canonical;
CREATE UNIQUE INDEX IF NOT EXISTS amm_markets_canonical_pool ON amm_markets(chain_id, pool_address) WHERE canonical;

CREATE TABLE IF NOT EXISTS amm_price_snapshots (
	chain_id bigint NOT NULL,
	block_hash text NOT NULL,
	tx_hash text NOT NULL,
	log_index integer NOT NULL,
	block_number bigint NOT NULL,
	pair_address text NOT NULL,
	yes_reserve_atto_shares numeric(78, 0) NOT NULL,
	no_reserve_atto_shares numeric(78, 0) NOT NULL,
	conditional_yes_bps numeric(78, 0) NOT NULL CHECK (conditional_yes_bps BETWEEN 0 AND 10000),
	conditional_no_bps numeric(78, 0) NOT NULL CHECK (conditional_no_bps BETWEEN 0 AND 10000),
	canonical boolean NOT NULL DEFAULT true,
	PRIMARY KEY (chain_id, block_hash, tx_hash, log_index, pair_address),
	FOREIGN KEY (chain_id, block_hash, tx_hash, log_index) REFERENCES logs(chain_id, block_hash, tx_hash, log_index),
	CHECK (yes_reserve_atto_shares + no_reserve_atto_shares > 0),
	CHECK (conditional_yes_bps + conditional_no_bps = 10000)
);
CREATE INDEX IF NOT EXISTS amm_price_snapshots_history ON amm_price_snapshots(chain_id, pair_address, block_number DESC, log_index DESC) WHERE canonical;

CREATE TABLE IF NOT EXISTS rep_eth_price_snapshots (
	chain_id bigint NOT NULL,
	block_hash text NOT NULL,
	tx_hash text NOT NULL,
	log_index integer NOT NULL,
	block_number bigint NOT NULL,
	coordinator_address text NOT NULL,
	event_name text NOT NULL CHECK (event_name IN ('RepEthPriceSet', 'PriceReported')),
	report_id numeric(78, 0),
	rep_per_eth_1e18 numeric(78, 0) NOT NULL CHECK (rep_per_eth_1e18 >= 0),
	settlement_timestamp timestamptz,
	canonical boolean NOT NULL DEFAULT true,
	PRIMARY KEY (chain_id, block_hash, tx_hash, log_index, coordinator_address),
	FOREIGN KEY (chain_id, block_hash, tx_hash, log_index) REFERENCES logs(chain_id, block_hash, tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS rep_eth_price_snapshots_history ON rep_eth_price_snapshots(chain_id, coordinator_address, block_number DESC, log_index DESC) WHERE canonical;

-- Preserve price history already decoded by earlier augurScan versions. AMM logs need
-- the new ABI and factory seed, so operators must rebuild to recover pre-006 AMM history.
INSERT INTO rep_eth_price_snapshots (
	chain_id, block_hash, tx_hash, log_index, block_number, coordinator_address,
	event_name, report_id, rep_per_eth_1e18, settlement_timestamp, canonical
)
SELECT
	chain_id, block_hash, tx_hash, log_index, block_number, emitter_address,
	event_name,
	CASE WHEN event_name = 'PriceReported' THEN (arguments ->> 'reportId')::numeric ELSE NULL END,
	(arguments ->> 'price')::numeric,
	CASE
		WHEN event_name = 'PriceReported' THEN to_timestamp((arguments ->> 'lastSettlementTimestamp')::numeric)
		ELSE NULL
	END,
	canonical
FROM logs
WHERE event_name IN ('RepEthPriceSet', 'PriceReported')
	AND decode_status = 'decoded'
	AND arguments ->> 'price' ~ '^[0-9]+$'
	AND (event_name <> 'PriceReported' OR (
		arguments ->> 'reportId' ~ '^[0-9]+$'
		AND arguments ->> 'lastSettlementTimestamp' ~ '^[0-9]+$'
	))
ON CONFLICT (chain_id, block_hash, tx_hash, log_index, coordinator_address) DO NOTHING;
