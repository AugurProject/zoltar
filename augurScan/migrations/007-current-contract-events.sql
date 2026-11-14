-- Accounting snapshots, vault snapshots and liquidation approvals were projected from events that no
-- contract emits any more, so every row in them predates the current contracts.
DROP TABLE public.liquidation_approval_events;
DROP TABLE public.vault_snapshots;
DROP TABLE public.pool_snapshots;

-- Pool accounting now records each QuestionAccountingCheckpoint; a projection rebuild repopulates it from stored logs.
CREATE TABLE public.pool_snapshots (
    chain_id bigint NOT NULL,
    block_hash text NOT NULL,
    tx_hash text NOT NULL,
    log_index integer NOT NULL,
    block_number bigint NOT NULL,
    pool_address text NOT NULL,
    reason integer NOT NULL,
    settlement_collateral_atto_eth numeric(78,0) NOT NULL,
    share_token_supply_atto_shares numeric(78,0) NOT NULL,
    last_settlement_portfolio_time timestamp with time zone NOT NULL,
    canonical boolean DEFAULT true NOT NULL
);

ALTER TABLE ONLY public.pool_snapshots
    ADD CONSTRAINT pool_snapshots_pkey PRIMARY KEY (chain_id, block_hash, tx_hash, log_index, pool_address);

ALTER TABLE ONLY public.pool_snapshots
    ADD CONSTRAINT pool_snapshots_chain_id_block_hash_tx_hash_log_index_fkey FOREIGN KEY (chain_id, block_hash, tx_hash, log_index) REFERENCES public.logs(chain_id, block_hash, tx_hash, log_index);

CREATE INDEX pool_snapshots_history ON public.pool_snapshots USING btree (chain_id, pool_address, block_number DESC, log_index DESC) WHERE canonical;

CREATE INDEX pool_snapshots_detail_page ON public.pool_snapshots USING btree (chain_id, pool_address, block_number DESC, log_index DESC, tx_hash DESC, block_hash DESC) WHERE canonical;
