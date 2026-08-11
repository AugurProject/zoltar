DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pool_snapshots' AND column_name = 'total_coverage_commitment_atto_eth') THEN
		IF EXISTS (SELECT 1 FROM networks WHERE indexed_block IS NOT NULL) OR EXISTS (SELECT 1 FROM blocks LIMIT 1) THEN
			RAISE EXCEPTION 'augurScan cannot upgrade indexed pre-003 history: legacy ETH coverage projections and missing rich-list activity require rebuilding the database from the verified network start block';
		END IF;
		ALTER TABLE pool_snapshots RENAME COLUMN total_coverage_commitment_atto_eth TO total_capacity_ownership_atto_rep;
		ALTER TABLE pool_snapshots RENAME COLUMN fee_eligible_coverage_commitment_atto_eth TO fee_eligible_capacity_ownership_atto_rep;
		ALTER TABLE pool_snapshots RENAME COLUMN uncheckpointed_fee_eligible_coverage_atto_eth TO uncheckpointed_fee_eligible_capacity_ownership_atto_rep;
	END IF;
	IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vault_snapshots' AND column_name = 'coverage_commitment_atto_eth') THEN
		ALTER TABLE vault_snapshots RENAME COLUMN coverage_commitment_atto_eth TO capacity_ownership_atto_rep;
		ALTER TABLE vault_snapshots RENAME COLUMN resulting_fee_eligible_coverage_atto_eth TO resulting_fee_eligible_capacity_ownership_atto_rep;
	END IF;
END $$;

CREATE TABLE IF NOT EXISTS address_activity (
	chain_id bigint NOT NULL,
	block_hash text NOT NULL,
	block_number bigint NOT NULL,
	tx_hash text NOT NULL,
	address text NOT NULL,
	pool_address text NOT NULL,
	role text NOT NULL CHECK (role IN ('sender', 'referenced')),
	canonical boolean NOT NULL DEFAULT true,
	PRIMARY KEY (chain_id, block_hash, tx_hash, address, pool_address),
	FOREIGN KEY (chain_id, block_hash, tx_hash) REFERENCES transactions(chain_id, block_hash, hash),
	FOREIGN KEY (chain_id, block_hash, block_number) REFERENCES blocks(chain_id, hash, number)
);
CREATE INDEX IF NOT EXISTS address_activity_address ON address_activity(chain_id, address, block_number DESC) WHERE canonical;
CREATE INDEX IF NOT EXISTS address_activity_pool ON address_activity(chain_id, pool_address, address) WHERE canonical;

CREATE TABLE IF NOT EXISTS address_balance_snapshots (
	chain_id bigint NOT NULL,
	block_hash text NOT NULL,
	block_number bigint NOT NULL,
	address text NOT NULL,
	asset_address text NOT NULL,
	asset_kind text NOT NULL CHECK (asset_kind IN ('native', 'rep', 'weth')),
	balance numeric(78, 0) NOT NULL CHECK (balance >= 0),
	canonical boolean NOT NULL DEFAULT true,
	observed_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (chain_id, block_hash, address, asset_address),
	FOREIGN KEY (chain_id, block_hash, block_number) REFERENCES blocks(chain_id, hash, number)
);
CREATE INDEX IF NOT EXISTS address_balances_latest ON address_balance_snapshots(chain_id, address, asset_address, block_number DESC) WHERE canonical;
