DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM networks WHERE indexed_block IS NOT NULL)
		OR EXISTS (SELECT 1 FROM blocks LIMIT 1)
	THEN
		RAISE EXCEPTION 'augurScan range indexing requires a fresh database; rebuild PostgreSQL from each network start block';
	END IF;
END $$;

ALTER TABLE transactions ALTER COLUMN status SET NOT NULL;
ALTER TABLE transactions ADD CONSTRAINT transactions_successful_log_evidence CHECK (status = 'success');

CREATE TABLE log_scan_cursors (
	chain_id bigint NOT NULL REFERENCES networks(chain_id),
	contract_address text NOT NULL,
	start_block bigint NOT NULL CHECK (start_block >= 0),
	last_retrieved_block bigint NOT NULL,
	updated_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (chain_id, contract_address),
	CHECK (last_retrieved_block >= start_block - 1)
);

CREATE INDEX log_scan_cursors_progress
	ON log_scan_cursors(chain_id, last_retrieved_block, contract_address);
