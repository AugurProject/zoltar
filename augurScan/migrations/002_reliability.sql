ALTER TABLE networks
	ADD COLUMN IF NOT EXISTS last_success_at timestamptz,
	ADD COLUMN IF NOT EXISTS failure_started_at timestamptz,
	ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0,
	ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
	ADD COLUMN IF NOT EXISTS last_reorg_at timestamptz,
	ADD COLUMN IF NOT EXISTS last_reorg_depth bigint;

ALTER TABLE networks DROP CONSTRAINT IF EXISTS networks_checkpoint_pair;
ALTER TABLE networks ADD CONSTRAINT networks_checkpoint_pair CHECK ((indexed_block IS NULL) = (indexed_hash IS NULL));
ALTER TABLE networks DROP CONSTRAINT IF EXISTS networks_start_block_non_negative;
ALTER TABLE networks ADD CONSTRAINT networks_start_block_non_negative CHECK (start_block >= 0);
ALTER TABLE networks DROP CONSTRAINT IF EXISTS networks_failure_count_non_negative;
ALTER TABLE networks ADD CONSTRAINT networks_failure_count_non_negative CHECK (consecutive_failures >= 0);
ALTER TABLE networks DROP CONSTRAINT IF EXISTS networks_reorg_depth_non_negative;
ALTER TABLE networks ADD CONSTRAINT networks_reorg_depth_non_negative CHECK (last_reorg_depth IS NULL OR last_reorg_depth >= 0);

CREATE TABLE IF NOT EXISTS live_events (
	id bigserial PRIMARY KEY,
	event text NOT NULL CHECK (event IN ('block', 'reorg', 'status')),
	payload jsonb NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS live_events_created_at ON live_events(created_at);

CREATE TABLE IF NOT EXISTS live_event_state (
	singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
	pruned_through_id bigint NOT NULL DEFAULT 0 CHECK (pruned_through_id >= 0),
	updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO live_event_state (singleton) VALUES (true) ON CONFLICT (singleton) DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS blocks_chain_hash_number ON blocks(chain_id, hash, number);

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactions_block_position_fk') THEN
		ALTER TABLE transactions ADD CONSTRAINT transactions_block_position_fk
			FOREIGN KEY (chain_id, block_hash, block_number) REFERENCES blocks(chain_id, hash, number);
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_discoveries_block_position_fk') THEN
		ALTER TABLE contract_discoveries ADD CONSTRAINT contract_discoveries_block_position_fk
			FOREIGN KEY (chain_id, block_hash, block_number) REFERENCES blocks(chain_id, hash, number);
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'token_metadata_block_position_fk') THEN
		ALTER TABLE token_metadata ADD CONSTRAINT token_metadata_block_position_fk
			FOREIGN KEY (chain_id, block_hash, read_block) REFERENCES blocks(chain_id, hash, number);
	END IF;
END $$;
