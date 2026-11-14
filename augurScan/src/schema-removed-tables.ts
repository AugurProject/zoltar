// Storage that migration 007 replaced. Databases at schema versions 1 to 6 still hold these definitions, and
// their layout is verified against them before the upgrade runs.

export const POOL_SNAPSHOTS_BEFORE_SCHEMA_7 = `CREATE TABLE public.pool_snapshots (
    chain_id bigint NOT NULL,
    block_hash text NOT NULL,
    tx_hash text NOT NULL,
    log_index integer NOT NULL,
    block_number bigint NOT NULL,
    pool_address text NOT NULL,
    reason integer NOT NULL,
    vault_address text NOT NULL,
    settlement_collateral_atto_eth numeric(78,0) NOT NULL,
    total_capacity_ownership_atto_rep numeric(78,0) NOT NULL,
    fee_eligible_capacity_ownership_atto_rep numeric(78,0) NOT NULL,
    total_claimable_vault_fees_atto_eth numeric(78,0) NOT NULL,
    unallocated_accrued_fees_atto_eth numeric(78,0) NOT NULL,
    fee_index numeric(78,0) NOT NULL,
    fee_index_remainder numeric(78,0) NOT NULL,
    total_fees_owed_remainder numeric(78,0) NOT NULL,
    uncheckpointed_fee_eligible_capacity_ownership_atto_rep numeric(78,0) NOT NULL,
    last_updated_fee_accumulator timestamp with time zone NOT NULL,
    current_retention_rate numeric(78,0) NOT NULL,
    canonical boolean DEFAULT true NOT NULL
);`

export const TABLES_REMOVED_IN_SCHEMA_7 = `CREATE TABLE public.liquidation_approval_events (
    chain_id bigint NOT NULL,
    block_hash text NOT NULL,
    tx_hash text NOT NULL,
    transaction_index integer NOT NULL,
    log_index integer NOT NULL,
    block_number bigint NOT NULL,
    registry_address text NOT NULL,
    approval_identity text NOT NULL,
    receiver_vault text,
    event_name text NOT NULL,
    event_data jsonb NOT NULL,
    canonical boolean DEFAULT true NOT NULL,
    observed_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.vault_snapshots (
    chain_id bigint NOT NULL,
    block_hash text NOT NULL,
    tx_hash text NOT NULL,
    log_index integer NOT NULL,
    block_number bigint NOT NULL,
    pool_address text NOT NULL,
    vault_address text NOT NULL,
    rep_backing_units numeric(78,0) NOT NULL,
    capacity_ownership_atto_rep numeric(78,0) NOT NULL,
    claimable_fees_atto_eth numeric(78,0) NOT NULL,
    fee_index numeric(78,0) NOT NULL,
    vault_fee_remainder numeric(78,0) NOT NULL,
    resulting_total_rep_backing_units numeric(78,0) NOT NULL,
    resulting_fee_eligible_capacity_ownership_atto_rep numeric(78,0) NOT NULL,
    canonical boolean DEFAULT true NOT NULL
);

ALTER TABLE ONLY public.liquidation_approval_events
    ADD CONSTRAINT liquidation_approval_events_pkey PRIMARY KEY (chain_id, block_hash, tx_hash, log_index, registry_address);

ALTER TABLE ONLY public.vault_snapshots
    ADD CONSTRAINT vault_snapshots_pkey PRIMARY KEY (chain_id, block_hash, tx_hash, log_index, pool_address, vault_address);

CREATE INDEX liquidation_approval_identity_page ON public.liquidation_approval_events USING btree (chain_id, approval_identity, block_number DESC, transaction_index DESC, log_index DESC) WHERE canonical;

CREATE INDEX liquidation_approval_vault_page ON public.liquidation_approval_events USING btree (chain_id, receiver_vault, block_number DESC, transaction_index DESC, log_index DESC) WHERE canonical;

CREATE INDEX vault_snapshots_history ON public.vault_snapshots USING btree (chain_id, vault_address, pool_address, block_number DESC, log_index DESC) WHERE canonical;

CREATE INDEX vault_snapshots_detail_page ON public.vault_snapshots USING btree (chain_id, pool_address, vault_address, block_number DESC, log_index DESC, tx_hash DESC, block_hash DESC) WHERE canonical;

ALTER TABLE ONLY public.liquidation_approval_events
    ADD CONSTRAINT liquidation_approval_events_chain_id_block_hash_tx_hash_lo_fkey FOREIGN KEY (chain_id, block_hash, tx_hash, log_index) REFERENCES public.logs(chain_id, block_hash, tx_hash, log_index);

ALTER TABLE ONLY public.vault_snapshots
    ADD CONSTRAINT vault_snapshots_chain_id_block_hash_tx_hash_log_index_fkey FOREIGN KEY (chain_id, block_hash, tx_hash, log_index) REFERENCES public.logs(chain_id, block_hash, tx_hash, log_index);
`
