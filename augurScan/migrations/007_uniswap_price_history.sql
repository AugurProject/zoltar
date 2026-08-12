CREATE TABLE IF NOT EXISTS uniswap_rep_eth_markets (
	chain_id bigint NOT NULL,
	block_hash text NOT NULL,
	tx_hash text NOT NULL,
	log_index integer NOT NULL,
	block_number bigint NOT NULL,
	venue text NOT NULL CHECK (venue IN ('v2', 'v3', 'v4')),
	market_id text NOT NULL,
	contract_address text NOT NULL,
	token0_address text NOT NULL,
	token1_address text NOT NULL,
	fee_hundredths_bip numeric(78, 0) NOT NULL,
	tick_spacing integer,
	hooks_address text,
	canonical boolean NOT NULL DEFAULT true,
	PRIMARY KEY (chain_id, block_hash, tx_hash, log_index, market_id),
	FOREIGN KEY (chain_id, block_hash, tx_hash, log_index) REFERENCES logs(chain_id, block_hash, tx_hash, log_index),
	CHECK (token0_address <> token1_address),
	CHECK ((venue = 'v2' AND tick_spacing IS NULL AND hooks_address IS NULL) OR venue <> 'v2'),
	CHECK ((venue = 'v4' AND hooks_address IS NOT NULL) OR (venue <> 'v4' AND hooks_address IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uniswap_rep_eth_markets_canonical_id
	ON uniswap_rep_eth_markets(chain_id, venue, market_id) WHERE canonical;
CREATE INDEX IF NOT EXISTS uniswap_rep_eth_markets_tokens
	ON uniswap_rep_eth_markets(chain_id, token0_address, token1_address) WHERE canonical;

CREATE TABLE IF NOT EXISTS uniswap_rep_eth_price_observations (
	chain_id bigint NOT NULL,
	block_hash text NOT NULL,
	tx_hash text NOT NULL,
	log_index integer NOT NULL,
	block_number bigint NOT NULL,
	venue text NOT NULL CHECK (venue IN ('v2', 'v3', 'v4')),
	market_id text NOT NULL,
	event_name text NOT NULL CHECK (event_name IN ('Initialize', 'Swap', 'Sync')),
	reserve0 numeric(78, 0),
	reserve1 numeric(78, 0),
	sqrt_price_x96 numeric(78, 0),
	canonical boolean NOT NULL DEFAULT true,
	PRIMARY KEY (chain_id, block_hash, tx_hash, log_index, market_id),
	FOREIGN KEY (chain_id, block_hash, tx_hash, log_index) REFERENCES logs(chain_id, block_hash, tx_hash, log_index),
	CHECK (
		(venue = 'v2' AND event_name = 'Sync' AND reserve0 IS NOT NULL AND reserve1 IS NOT NULL AND sqrt_price_x96 IS NULL)
		OR
		(venue IN ('v3', 'v4') AND event_name IN ('Initialize', 'Swap') AND reserve0 IS NULL AND reserve1 IS NULL AND sqrt_price_x96 IS NOT NULL)
	)
);
CREATE INDEX IF NOT EXISTS uniswap_rep_eth_price_observations_history
	ON uniswap_rep_eth_price_observations(chain_id, venue, market_id, block_number DESC, log_index DESC) WHERE canonical;

-- Factory and pool ABIs become known in this release. Rebuild an existing database to
-- recover Uniswap events that predate this migration; future observations index normally.
