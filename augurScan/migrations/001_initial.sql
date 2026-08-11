CREATE TABLE IF NOT EXISTS networks (
	chain_id bigint PRIMARY KEY,
	id text NOT NULL UNIQUE,
	name text NOT NULL,
	explorer_base_url text NOT NULL,
	start_block bigint NOT NULL,
	indexed_block bigint,
	indexed_hash text,
	indexed_timestamp timestamptz,
	observed_block bigint,
	finalized_block bigint,
	phase text NOT NULL DEFAULT 'backfilling',
	last_poll_at timestamptz,
	last_error text,
	updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS blocks (
	chain_id bigint NOT NULL REFERENCES networks(chain_id),
	number bigint NOT NULL,
	hash text NOT NULL,
	parent_hash text NOT NULL,
	timestamp timestamptz NOT NULL,
	canonical boolean NOT NULL DEFAULT true,
	finalized boolean NOT NULL DEFAULT false,
	ingested_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (chain_id, hash)
);
CREATE UNIQUE INDEX IF NOT EXISTS blocks_canonical_number ON blocks(chain_id, number) WHERE canonical;

CREATE TABLE IF NOT EXISTS contracts (
	chain_id bigint NOT NULL REFERENCES networks(chain_id),
	address text NOT NULL,
	label text NOT NULL,
	kind text NOT NULL,
	provenance text NOT NULL,
	discovery_block bigint,
	discovery_tx_hash text,
	canonical boolean NOT NULL DEFAULT true,
	created_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (chain_id, address)
);

CREATE TABLE IF NOT EXISTS transactions (
	chain_id bigint NOT NULL REFERENCES networks(chain_id),
	hash text NOT NULL,
	block_hash text NOT NULL,
	block_number bigint NOT NULL,
	transaction_index integer NOT NULL,
	from_address text NOT NULL,
	to_address text,
	value numeric(78, 0) NOT NULL,
	input text NOT NULL,
	status text,
	gas_used numeric(78, 0),
	receipt jsonb NOT NULL,
	canonical boolean NOT NULL DEFAULT true,
	PRIMARY KEY (chain_id, block_hash, hash)
);
CREATE INDEX IF NOT EXISTS transactions_block_order ON transactions(chain_id, block_number DESC, transaction_index DESC) WHERE canonical;
CREATE UNIQUE INDEX IF NOT EXISTS transactions_canonical_hash ON transactions(chain_id, hash) WHERE canonical;

CREATE TABLE IF NOT EXISTS actions (
	chain_id bigint NOT NULL,
	block_hash text NOT NULL,
	tx_hash text NOT NULL,
	contract_address text,
	function_name text,
	function_signature text,
	arguments jsonb,
	display_arguments jsonb,
	argument_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
	decode_status text NOT NULL,
	decode_error text,
	summary text NOT NULL,
	PRIMARY KEY (chain_id, block_hash, tx_hash),
	FOREIGN KEY (chain_id, block_hash, tx_hash) REFERENCES transactions(chain_id, block_hash, hash)
);

CREATE TABLE IF NOT EXISTS logs (
	chain_id bigint NOT NULL,
	tx_hash text NOT NULL,
	block_hash text NOT NULL,
	block_number bigint NOT NULL,
	transaction_index integer NOT NULL,
	log_index integer NOT NULL,
	emitter_address text NOT NULL,
	topics jsonb NOT NULL,
	data text NOT NULL,
	event_name text,
	event_signature text,
	arguments jsonb,
	display_arguments jsonb,
	argument_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
	decode_status text NOT NULL,
	decode_error text,
	summary text NOT NULL,
	canonical boolean NOT NULL DEFAULT true,
	finalized boolean NOT NULL DEFAULT false,
	PRIMARY KEY (chain_id, block_hash, tx_hash, log_index),
	FOREIGN KEY (chain_id, block_hash, tx_hash) REFERENCES transactions(chain_id, block_hash, hash)
);
CREATE INDEX IF NOT EXISTS logs_feed ON logs(chain_id, block_number DESC, transaction_index DESC, log_index DESC) WHERE canonical;
CREATE INDEX IF NOT EXISTS logs_emitter ON logs(chain_id, emitter_address, block_number DESC) WHERE canonical;
CREATE INDEX IF NOT EXISTS logs_event ON logs(chain_id, event_name, block_number DESC) WHERE canonical;
CREATE UNIQUE INDEX IF NOT EXISTS logs_canonical_position ON logs(chain_id, tx_hash, log_index) WHERE canonical;

CREATE TABLE IF NOT EXISTS contract_discoveries (
	chain_id bigint NOT NULL REFERENCES networks(chain_id),
	address text NOT NULL,
	block_hash text NOT NULL,
	block_number bigint NOT NULL,
	tx_hash text NOT NULL,
	label text NOT NULL,
	kind text NOT NULL,
	provenance text NOT NULL,
	canonical boolean NOT NULL DEFAULT true,
	created_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (chain_id, address, block_hash, tx_hash)
);

CREATE TABLE IF NOT EXISTS token_metadata (
	chain_id bigint NOT NULL,
	address text NOT NULL,
	block_hash text NOT NULL,
	name text,
	symbol text,
	decimals integer,
	read_error text,
	read_block bigint NOT NULL,
	canonical boolean NOT NULL DEFAULT true,
	updated_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (chain_id, address, block_hash)
);
CREATE UNIQUE INDEX IF NOT EXISTS token_metadata_canonical_address ON token_metadata(chain_id, address) WHERE canonical;

CREATE TABLE IF NOT EXISTS questions (
	chain_id bigint NOT NULL,
	block_hash text NOT NULL,
	tx_hash text NOT NULL,
	log_index integer NOT NULL,
	block_number bigint NOT NULL,
	question_id numeric(78, 0) NOT NULL,
	created_timestamp timestamptz NOT NULL,
	title text NOT NULL,
	description text NOT NULL,
	start_time timestamptz NOT NULL,
	end_time timestamptz NOT NULL,
	num_ticks numeric(78, 0) NOT NULL,
	display_value_min numeric(78, 0) NOT NULL,
	display_value_max numeric(78, 0) NOT NULL,
	answer_unit text NOT NULL,
	outcome_options jsonb NOT NULL,
	canonical boolean NOT NULL DEFAULT true,
	PRIMARY KEY (chain_id, block_hash, tx_hash, log_index, question_id),
	FOREIGN KEY (chain_id, block_hash, tx_hash, log_index) REFERENCES logs(chain_id, block_hash, tx_hash, log_index)
);
CREATE UNIQUE INDEX IF NOT EXISTS questions_canonical_id ON questions(chain_id, question_id) WHERE canonical;

CREATE TABLE IF NOT EXISTS pools (
	chain_id bigint NOT NULL,
	block_hash text NOT NULL,
	tx_hash text NOT NULL,
	log_index integer NOT NULL,
	block_number bigint NOT NULL,
	pool_address text NOT NULL,
	parent_address text NOT NULL,
	universe_id numeric(78, 0) NOT NULL,
	question_id numeric(78, 0) NOT NULL,
	truth_auction_address text NOT NULL,
	coordinator_address text NOT NULL,
	share_token_address text NOT NULL,
	security_multiplier_bps numeric(78, 0) NOT NULL,
	initial_priority_fee_atto_eth_per_gas numeric(78, 0) NOT NULL,
	initial_retention_rate numeric(78, 0) NOT NULL,
	initial_settlement_collateral_atto_eth numeric(78, 0) NOT NULL,
	canonical boolean NOT NULL DEFAULT true,
	PRIMARY KEY (chain_id, block_hash, tx_hash, log_index, pool_address),
	FOREIGN KEY (chain_id, block_hash, tx_hash, log_index) REFERENCES logs(chain_id, block_hash, tx_hash, log_index)
);
CREATE UNIQUE INDEX IF NOT EXISTS pools_canonical_address ON pools(chain_id, pool_address) WHERE canonical;
CREATE INDEX IF NOT EXISTS pools_question ON pools(chain_id, question_id) WHERE canonical;
CREATE INDEX IF NOT EXISTS pools_universe ON pools(chain_id, universe_id) WHERE canonical;

CREATE TABLE IF NOT EXISTS pool_snapshots (
	chain_id bigint NOT NULL,
	block_hash text NOT NULL,
	tx_hash text NOT NULL,
	log_index integer NOT NULL,
	block_number bigint NOT NULL,
	pool_address text NOT NULL,
	reason integer NOT NULL,
	vault_address text NOT NULL,
	settlement_collateral_atto_eth numeric(78, 0) NOT NULL,
	total_capacity_ownership_atto_rep numeric(78, 0) NOT NULL,
	fee_eligible_capacity_ownership_atto_rep numeric(78, 0) NOT NULL,
	total_claimable_vault_fees_atto_eth numeric(78, 0) NOT NULL,
	unallocated_accrued_fees_atto_eth numeric(78, 0) NOT NULL,
	fee_index numeric(78, 0) NOT NULL,
	fee_index_remainder numeric(78, 0) NOT NULL,
	total_fees_owed_remainder numeric(78, 0) NOT NULL,
	uncheckpointed_fee_eligible_capacity_ownership_atto_rep numeric(78, 0) NOT NULL,
	last_updated_fee_accumulator timestamptz NOT NULL,
	current_retention_rate numeric(78, 0) NOT NULL,
	canonical boolean NOT NULL DEFAULT true,
	PRIMARY KEY (chain_id, block_hash, tx_hash, log_index, pool_address),
	FOREIGN KEY (chain_id, block_hash, tx_hash, log_index) REFERENCES logs(chain_id, block_hash, tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS pool_snapshots_history ON pool_snapshots(chain_id, pool_address, block_number DESC, log_index DESC) WHERE canonical;

CREATE TABLE IF NOT EXISTS pool_state_events (
	chain_id bigint NOT NULL,
	block_hash text NOT NULL,
	tx_hash text NOT NULL,
	log_index integer NOT NULL,
	block_number bigint NOT NULL,
	pool_address text NOT NULL,
	event_name text NOT NULL,
	state jsonb NOT NULL,
	canonical boolean NOT NULL DEFAULT true,
	PRIMARY KEY (chain_id, block_hash, tx_hash, log_index, pool_address),
	FOREIGN KEY (chain_id, block_hash, tx_hash, log_index) REFERENCES logs(chain_id, block_hash, tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS pool_state_events_history ON pool_state_events(chain_id, pool_address, block_number DESC, log_index DESC) WHERE canonical;

CREATE TABLE IF NOT EXISTS vault_snapshots (
	chain_id bigint NOT NULL,
	block_hash text NOT NULL,
	tx_hash text NOT NULL,
	log_index integer NOT NULL,
	block_number bigint NOT NULL,
	pool_address text NOT NULL,
	vault_address text NOT NULL,
	rep_backing_units numeric(78, 0) NOT NULL,
	capacity_ownership_atto_rep numeric(78, 0) NOT NULL,
	claimable_fees_atto_eth numeric(78, 0) NOT NULL,
	fee_index numeric(78, 0) NOT NULL,
	vault_fee_remainder numeric(78, 0) NOT NULL,
	resulting_total_rep_backing_units numeric(78, 0) NOT NULL,
	resulting_fee_eligible_capacity_ownership_atto_rep numeric(78, 0) NOT NULL,
	canonical boolean NOT NULL DEFAULT true,
	PRIMARY KEY (chain_id, block_hash, tx_hash, log_index, pool_address, vault_address),
	FOREIGN KEY (chain_id, block_hash, tx_hash, log_index) REFERENCES logs(chain_id, block_hash, tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS vault_snapshots_history ON vault_snapshots(chain_id, vault_address, pool_address, block_number DESC, log_index DESC) WHERE canonical;

CREATE TABLE IF NOT EXISTS universe_events (
	chain_id bigint NOT NULL,
	block_hash text NOT NULL,
	tx_hash text NOT NULL,
	log_index integer NOT NULL,
	block_number bigint NOT NULL,
	universe_id numeric(78, 0) NOT NULL,
	event_name text NOT NULL,
	parent_universe_id numeric(78, 0),
	forking_outcome_index numeric(78, 0),
	reputation_token_address text,
	fork_question_id numeric(78, 0),
	fork_time timestamptz,
	forker_address text,
	fork_threshold_atto_rep numeric(78, 0),
	migration_rep_balance_atto_rep numeric(78, 0),
	theoretical_supply_atto_rep numeric(78, 0),
	canonical boolean NOT NULL DEFAULT true,
	PRIMARY KEY (chain_id, block_hash, tx_hash, log_index, universe_id),
	FOREIGN KEY (chain_id, block_hash, tx_hash, log_index) REFERENCES logs(chain_id, block_hash, tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS universe_events_history ON universe_events(chain_id, universe_id, block_number DESC, log_index DESC) WHERE canonical;
