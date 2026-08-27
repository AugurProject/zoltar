-- Authoritative augurScan schema for a new, empty PostgreSQL database.
-- Forward migrations for retained databases live under migrations/.


-- Dumped from database version 17.11 (Debian 17.11-1.pgdg12+2)
-- Dumped by pg_dump version 18.6 (Debian 18.6-1.pgdg12+2)

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

-- *not* creating schema, since initdb creates it


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS '';


--
-- Name: actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.actions (
    chain_id bigint NOT NULL,
    block_hash text NOT NULL,
    tx_hash text NOT NULL,
    contract_address text,
    function_name text,
    function_signature text,
    arguments jsonb,
    display_arguments jsonb,
    argument_schema jsonb DEFAULT '[]'::jsonb NOT NULL,
    decode_status text NOT NULL,
    decode_error text,
    summary text NOT NULL
);


--
-- Name: address_activity; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.address_activity (
    chain_id bigint NOT NULL,
    block_hash text NOT NULL,
    block_number bigint NOT NULL,
    tx_hash text NOT NULL,
    address text NOT NULL,
    pool_address text NOT NULL,
    role text NOT NULL,
    canonical boolean DEFAULT true NOT NULL,
    CONSTRAINT address_activity_role_check CHECK ((role = ANY (ARRAY['sender'::text, 'referenced'::text])))
);


--
-- Name: address_balance_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.address_balance_snapshots (
    chain_id bigint NOT NULL,
    block_hash text NOT NULL,
    block_number bigint NOT NULL,
    address text NOT NULL,
    asset_address text NOT NULL,
    asset_kind text NOT NULL,
    balance numeric(78,0) NOT NULL,
    canonical boolean DEFAULT true NOT NULL,
    observed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT address_balance_snapshots_asset_kind_check CHECK ((asset_kind = ANY (ARRAY['native'::text, 'rep'::text, 'weth'::text]))),
    CONSTRAINT address_balance_snapshots_balance_check CHECK ((balance >= (0)::numeric))
);


--
-- Name: amm_markets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.amm_markets (
    chain_id bigint NOT NULL,
    block_hash text NOT NULL,
    tx_hash text NOT NULL,
    log_index integer NOT NULL,
    block_number bigint NOT NULL,
    pair_address text NOT NULL,
    pool_address text NOT NULL,
    share_token_address text NOT NULL,
    universe_id numeric(78,0) NOT NULL,
    fee_bps numeric(78,0) NOT NULL,
    canonical boolean DEFAULT true NOT NULL
);


--
-- Name: amm_price_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.amm_price_snapshots (
    chain_id bigint NOT NULL,
    block_hash text NOT NULL,
    tx_hash text NOT NULL,
    log_index integer NOT NULL,
    block_number bigint NOT NULL,
    pair_address text NOT NULL,
    yes_reserve_atto_shares numeric(78,0) NOT NULL,
    no_reserve_atto_shares numeric(78,0) NOT NULL,
    conditional_yes_bps numeric(78,0) NOT NULL,
    conditional_no_bps numeric(78,0) NOT NULL,
    canonical boolean DEFAULT true NOT NULL,
    CONSTRAINT amm_price_snapshots_check CHECK (((yes_reserve_atto_shares + no_reserve_atto_shares) > (0)::numeric)),
    CONSTRAINT amm_price_snapshots_check1 CHECK (((conditional_yes_bps + conditional_no_bps) = (10000)::numeric)),
    CONSTRAINT amm_price_snapshots_conditional_no_bps_check CHECK (((conditional_no_bps >= (0)::numeric) AND (conditional_no_bps <= (10000)::numeric))),
    CONSTRAINT amm_price_snapshots_conditional_yes_bps_check CHECK (((conditional_yes_bps >= (0)::numeric) AND (conditional_yes_bps <= (10000)::numeric)))
);


--
-- Name: amm_trade_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.amm_trade_events (
    chain_id bigint NOT NULL,
    block_hash text NOT NULL,
    tx_hash text NOT NULL,
    log_index integer NOT NULL,
    block_number bigint NOT NULL,
    market_address text NOT NULL,
    event_name text NOT NULL,
    event_data jsonb NOT NULL,
    canonical boolean DEFAULT true NOT NULL,
    observed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: blocks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.blocks (
    chain_id bigint NOT NULL,
    number bigint NOT NULL,
    hash text NOT NULL,
    parent_hash text NOT NULL,
    "timestamp" timestamp with time zone NOT NULL,
    canonical boolean DEFAULT true NOT NULL,
    finalized boolean DEFAULT false NOT NULL,
    ingested_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: contract_discoveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contract_discoveries (
    chain_id bigint NOT NULL,
    address text NOT NULL,
    block_hash text NOT NULL,
    block_number bigint NOT NULL,
    tx_hash text NOT NULL,
    label text NOT NULL,
    kind text NOT NULL,
    provenance text NOT NULL,
    canonical boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: contracts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contracts (
    chain_id bigint NOT NULL,
    address text NOT NULL,
    label text NOT NULL,
    kind text NOT NULL,
    provenance text NOT NULL,
    discovery_block bigint,
    discovery_tx_hash text,
    canonical boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deployment_block bigint,
    deployment_timestamp timestamp with time zone,
    deployment_block_exact boolean,
    deployment_checked_block bigint,
    CONSTRAINT contracts_deployment_block_non_negative CHECK (((deployment_block IS NULL) OR (deployment_block >= 0))),
    CONSTRAINT contracts_deployment_checked_block_non_negative CHECK (((deployment_checked_block IS NULL) OR (deployment_checked_block >= 0))),
    CONSTRAINT contracts_deployment_fields_complete CHECK ((((deployment_block IS NULL) AND (deployment_timestamp IS NULL) AND (deployment_block_exact IS NULL)) OR ((deployment_block IS NOT NULL) AND (deployment_timestamp IS NOT NULL) AND (deployment_block_exact IS NOT NULL))))
);


--
-- Name: entity_state_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entity_state_snapshots (
    chain_id bigint NOT NULL,
    entity_type text NOT NULL,
    entity_identity text NOT NULL,
    block_number bigint NOT NULL,
    block_hash text NOT NULL,
    block_timestamp timestamp with time zone NOT NULL,
    source_method text NOT NULL,
    read_status text NOT NULL,
    read_result jsonb,
    read_failure_reason text,
    observed_at timestamp with time zone DEFAULT now() NOT NULL,
    canonical boolean DEFAULT true NOT NULL,
    CONSTRAINT entity_state_snapshots_read_status_check CHECK ((read_status = ANY (ARRAY['success'::text, 'failed'::text, 'pending'::text, 'stale'::text])))
);


--
-- Name: escalation_game_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.escalation_game_events (
    chain_id bigint NOT NULL,
    block_hash text NOT NULL,
    tx_hash text NOT NULL,
    log_index integer NOT NULL,
    block_number bigint NOT NULL,
    game_address text NOT NULL,
    event_name text NOT NULL,
    event_data jsonb NOT NULL,
    canonical boolean DEFAULT true NOT NULL,
    observed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: fork_migration_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fork_migration_events (
    chain_id bigint NOT NULL,
    block_hash text NOT NULL,
    tx_hash text NOT NULL,
    log_index integer NOT NULL,
    block_number bigint NOT NULL,
    universe_identity text NOT NULL,
    event_name text NOT NULL,
    event_data jsonb NOT NULL,
    canonical boolean DEFAULT true NOT NULL,
    observed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: liquidation_approval_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.liquidation_approval_events (
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


--
-- Name: live_event_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.live_event_state (
    singleton boolean DEFAULT true NOT NULL,
    pruned_through_id bigint DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT live_event_state_pruned_through_id_check CHECK ((pruned_through_id >= 0)),
    CONSTRAINT live_event_state_singleton_check CHECK (singleton)
);

INSERT INTO public.live_event_state (singleton) VALUES (true);


--
-- Name: live_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.live_events (
    id bigint NOT NULL,
    event text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT live_events_event_check CHECK ((event = ANY (ARRAY['block'::text, 'reorg'::text, 'status'::text])))
);


--
-- Name: live_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.live_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: live_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.live_events_id_seq OWNED BY public.live_events.id;


--
-- Name: log_scan_cursors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.log_scan_cursors (
    chain_id bigint NOT NULL,
    contract_address text NOT NULL,
    start_block bigint NOT NULL,
    last_retrieved_block bigint NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT log_scan_cursors_check CHECK ((last_retrieved_block >= (start_block - 1))),
    CONSTRAINT log_scan_cursors_start_block_check CHECK ((start_block >= 0))
);


--
-- Name: logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.logs (
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
    argument_schema jsonb DEFAULT '[]'::jsonb NOT NULL,
    decode_status text NOT NULL,
    decode_error text,
    summary text NOT NULL,
    canonical boolean DEFAULT true NOT NULL,
    finalized boolean DEFAULT false NOT NULL
);


--
-- Name: networks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.networks (
    chain_id bigint NOT NULL,
    id text NOT NULL,
    name text NOT NULL,
    explorer_base_url text NOT NULL,
    start_block bigint NOT NULL,
    indexed_block bigint,
    indexed_hash text,
    indexed_timestamp timestamp with time zone,
    observed_block bigint,
    finalized_block bigint,
    phase text DEFAULT 'backfilling'::text NOT NULL,
    last_poll_at timestamp with time zone,
    last_error text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_success_at timestamp with time zone,
    failure_started_at timestamp with time zone,
    consecutive_failures integer DEFAULT 0 NOT NULL,
    next_retry_at timestamp with time zone,
    last_reorg_at timestamp with time zone,
    last_reorg_depth bigint,
    CONSTRAINT networks_checkpoint_pair CHECK (((indexed_block IS NULL) = (indexed_hash IS NULL))),
    CONSTRAINT networks_failure_count_non_negative CHECK ((consecutive_failures >= 0)),
    CONSTRAINT networks_reorg_depth_non_negative CHECK (((last_reorg_depth IS NULL) OR (last_reorg_depth >= 0))),
    CONSTRAINT networks_start_block_non_negative CHECK ((start_block >= 0))
);


--
-- Name: open_oracle_report_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.open_oracle_report_events (
    chain_id bigint NOT NULL,
    block_hash text NOT NULL,
    tx_hash text NOT NULL,
    log_index integer NOT NULL,
    block_number bigint NOT NULL,
    open_oracle_address text NOT NULL,
    report_id numeric(78,0) NOT NULL,
    event_name text NOT NULL,
    round_number numeric(78,0),
    report_data jsonb NOT NULL,
    canonical boolean DEFAULT true NOT NULL,
    observed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT open_oracle_report_events_event_name_check CHECK ((event_name = ANY (ARRAY['ReportSubmitted'::text, 'ReportDisputed'::text, 'ReportSettled'::text])))
);


--
-- Name: pool_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pool_snapshots (
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
);


--
-- Name: pool_state_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pool_state_events (
    chain_id bigint NOT NULL,
    block_hash text NOT NULL,
    tx_hash text NOT NULL,
    log_index integer NOT NULL,
    block_number bigint NOT NULL,
    pool_address text NOT NULL,
    event_name text NOT NULL,
    state jsonb NOT NULL,
    canonical boolean DEFAULT true NOT NULL
);


--
-- Name: pools; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pools (
    chain_id bigint NOT NULL,
    block_hash text NOT NULL,
    tx_hash text NOT NULL,
    log_index integer NOT NULL,
    block_number bigint NOT NULL,
    pool_address text NOT NULL,
    parent_address text NOT NULL,
    universe_id numeric(78,0) NOT NULL,
    question_id numeric(78,0) NOT NULL,
    truth_auction_address text NOT NULL,
    coordinator_address text NOT NULL,
    share_token_address text NOT NULL,
    security_multiplier_bps numeric(78,0) NOT NULL,
    initial_priority_fee_atto_eth_per_gas numeric(78,0) NOT NULL,
    initial_retention_rate numeric(78,0) NOT NULL,
    initial_settlement_collateral_atto_eth numeric(78,0) NOT NULL,
    canonical boolean DEFAULT true NOT NULL
);


--
-- Name: protocol_timeline_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.protocol_timeline_entries (
    chain_id bigint NOT NULL,
    block_hash text NOT NULL,
    tx_hash text NOT NULL,
    log_index integer NOT NULL,
    block_number bigint NOT NULL,
    entity_type text NOT NULL,
    entity_identity text NOT NULL,
    semantic_event_kind text NOT NULL,
    summary_data jsonb NOT NULL,
    related_entities jsonb DEFAULT '[]'::jsonb NOT NULL,
    source_contract text NOT NULL,
    source_event text NOT NULL,
    canonical boolean DEFAULT true NOT NULL,
    observed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.questions (
    chain_id bigint NOT NULL,
    block_hash text NOT NULL,
    tx_hash text NOT NULL,
    log_index integer NOT NULL,
    block_number bigint NOT NULL,
    question_id numeric(78,0) NOT NULL,
    created_timestamp timestamp with time zone NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    start_time timestamp with time zone NOT NULL,
    end_time timestamp with time zone NOT NULL,
    num_ticks numeric(78,0) NOT NULL,
    display_value_min numeric(78,0) NOT NULL,
    display_value_max numeric(78,0) NOT NULL,
    answer_unit text NOT NULL,
    outcome_options jsonb NOT NULL,
    canonical boolean DEFAULT true NOT NULL
);


--
-- Name: rep_eth_price_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rep_eth_price_snapshots (
    chain_id bigint NOT NULL,
    block_hash text NOT NULL,
    tx_hash text NOT NULL,
    log_index integer NOT NULL,
    block_number bigint NOT NULL,
    coordinator_address text NOT NULL,
    event_name text NOT NULL,
    report_id numeric(78,0),
    rep_per_eth_1e18 numeric(78,0) NOT NULL,
    settlement_timestamp timestamp with time zone,
    canonical boolean DEFAULT true NOT NULL,
    CONSTRAINT rep_eth_price_snapshots_event_name_check CHECK ((event_name = ANY (ARRAY['RepEthPriceSet'::text, 'PriceReported'::text]))),
    CONSTRAINT rep_eth_price_snapshots_rep_per_eth_1e18_check CHECK ((rep_per_eth_1e18 >= (0)::numeric))
);


--
-- Name: token_metadata; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.token_metadata (
    chain_id bigint NOT NULL,
    address text NOT NULL,
    block_hash text NOT NULL,
    name text,
    symbol text,
    decimals integer,
    read_error text,
    read_block bigint NOT NULL,
    canonical boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transactions (
    chain_id bigint NOT NULL,
    hash text NOT NULL,
    block_hash text NOT NULL,
    block_number bigint NOT NULL,
    transaction_index integer NOT NULL,
    from_address text NOT NULL,
    to_address text,
    value numeric(78,0) NOT NULL,
    input text NOT NULL,
    status text NOT NULL,
    gas_used numeric(78,0),
    receipt jsonb NOT NULL,
    canonical boolean DEFAULT true NOT NULL,
    CONSTRAINT transactions_successful_log_evidence CHECK ((status = 'success'::text))
);


--
-- Name: truth_auction_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.truth_auction_events (
    chain_id bigint NOT NULL,
    block_hash text NOT NULL,
    tx_hash text NOT NULL,
    log_index integer NOT NULL,
    block_number bigint NOT NULL,
    auction_address text NOT NULL,
    event_name text NOT NULL,
    event_data jsonb NOT NULL,
    canonical boolean DEFAULT true NOT NULL,
    observed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: uniswap_rep_eth_markets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.uniswap_rep_eth_markets (
    chain_id bigint NOT NULL,
    block_hash text NOT NULL,
    tx_hash text NOT NULL,
    log_index integer NOT NULL,
    block_number bigint NOT NULL,
    venue text NOT NULL,
    market_id text NOT NULL,
    contract_address text NOT NULL,
    token0_address text NOT NULL,
    token1_address text NOT NULL,
    fee_hundredths_bip numeric(78,0) NOT NULL,
    tick_spacing integer,
    hooks_address text,
    canonical boolean DEFAULT true NOT NULL,
    CONSTRAINT uniswap_rep_eth_markets_check CHECK ((token0_address <> token1_address)),
    CONSTRAINT uniswap_rep_eth_markets_check1 CHECK ((((venue = 'v2'::text) AND (tick_spacing IS NULL) AND (hooks_address IS NULL)) OR (venue <> 'v2'::text))),
    CONSTRAINT uniswap_rep_eth_markets_check2 CHECK ((((venue = 'v4'::text) AND (hooks_address IS NOT NULL)) OR ((venue <> 'v4'::text) AND (hooks_address IS NULL)))),
    CONSTRAINT uniswap_rep_eth_markets_check3 CHECK (((venue <> 'v4'::text) OR ((fee_hundredths_bip = (100)::numeric) AND (tick_spacing = 1)) OR ((fee_hundredths_bip = (500)::numeric) AND (tick_spacing = 10)) OR ((fee_hundredths_bip = (3000)::numeric) AND (tick_spacing = 60)) OR ((fee_hundredths_bip = (10000)::numeric) AND (tick_spacing = 200)))),
    CONSTRAINT uniswap_rep_eth_markets_venue_check CHECK ((venue = ANY (ARRAY['v2'::text, 'v3'::text, 'v4'::text])))
);


--
-- Name: uniswap_rep_eth_price_observations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.uniswap_rep_eth_price_observations (
    chain_id bigint NOT NULL,
    block_hash text NOT NULL,
    tx_hash text NOT NULL,
    log_index integer NOT NULL,
    block_number bigint NOT NULL,
    venue text NOT NULL,
    market_id text NOT NULL,
    event_name text NOT NULL,
    reserve0 numeric(78,0),
    reserve1 numeric(78,0),
    sqrt_price_x96 numeric(78,0),
    canonical boolean DEFAULT true NOT NULL,
    liquidity numeric(78,0),
    CONSTRAINT uniswap_rep_eth_price_observations_check CHECK ((((venue = 'v2'::text) AND (event_name = 'Sync'::text) AND (reserve0 IS NOT NULL) AND (reserve1 IS NOT NULL) AND (sqrt_price_x96 IS NULL)) OR ((venue = ANY (ARRAY['v3'::text, 'v4'::text])) AND (event_name = ANY (ARRAY['Initialize'::text, 'Swap'::text])) AND (reserve0 IS NULL) AND (reserve1 IS NULL) AND (sqrt_price_x96 IS NOT NULL)))),
    CONSTRAINT uniswap_rep_eth_price_observations_event_name_check CHECK ((event_name = ANY (ARRAY['Initialize'::text, 'Swap'::text, 'Sync'::text]))),
    CONSTRAINT uniswap_rep_eth_price_observations_venue_check CHECK ((venue = ANY (ARRAY['v2'::text, 'v3'::text, 'v4'::text])))
);


--
-- Name: universe_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.universe_events (
    chain_id bigint NOT NULL,
    block_hash text NOT NULL,
    tx_hash text NOT NULL,
    log_index integer NOT NULL,
    block_number bigint NOT NULL,
    universe_id numeric(78,0) NOT NULL,
    event_name text NOT NULL,
    parent_universe_id numeric(78,0),
    forking_outcome_index numeric(78,0),
    reputation_token_address text,
    fork_question_id numeric(78,0),
    fork_time timestamp with time zone,
    forker_address text,
    fork_threshold_atto_rep numeric(78,0),
    migration_rep_balance_atto_rep numeric(78,0),
    theoretical_supply_atto_rep numeric(78,0),
    canonical boolean DEFAULT true NOT NULL
);


--
-- Name: vault_snapshots; Type: TABLE; Schema: public; Owner: -
--

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


--
-- Name: live_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_events ALTER COLUMN id SET DEFAULT nextval('public.live_events_id_seq'::regclass);


--
-- Name: actions actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.actions
    ADD CONSTRAINT actions_pkey PRIMARY KEY (chain_id, block_hash, tx_hash);


--
-- Name: address_activity address_activity_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.address_activity
    ADD CONSTRAINT address_activity_pkey PRIMARY KEY (chain_id, block_hash, tx_hash, address, pool_address);


--
-- Name: address_balance_snapshots address_balance_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.address_balance_snapshots
    ADD CONSTRAINT address_balance_snapshots_pkey PRIMARY KEY (chain_id, block_hash, address, asset_address);


--
-- Name: amm_markets amm_markets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.amm_markets
    ADD CONSTRAINT amm_markets_pkey PRIMARY KEY (chain_id, block_hash, tx_hash, log_index, pair_address);


--
-- Name: amm_price_snapshots amm_price_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.amm_price_snapshots
    ADD CONSTRAINT amm_price_snapshots_pkey PRIMARY KEY (chain_id, block_hash, tx_hash, log_index, pair_address);


--
-- Name: amm_trade_events amm_trade_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.amm_trade_events
    ADD CONSTRAINT amm_trade_events_pkey PRIMARY KEY (chain_id, block_hash, tx_hash, log_index, market_address);


--
-- Name: blocks blocks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blocks
    ADD CONSTRAINT blocks_pkey PRIMARY KEY (chain_id, hash);


--
-- Name: contract_discoveries contract_discoveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_discoveries
    ADD CONSTRAINT contract_discoveries_pkey PRIMARY KEY (chain_id, address, block_hash, tx_hash);


--
-- Name: contracts contracts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_pkey PRIMARY KEY (chain_id, address);


--
-- Name: entity_state_snapshots entity_state_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_state_snapshots
    ADD CONSTRAINT entity_state_snapshots_pkey PRIMARY KEY (chain_id, entity_type, entity_identity, block_hash, source_method);


--
-- Name: escalation_game_events escalation_game_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.escalation_game_events
    ADD CONSTRAINT escalation_game_events_pkey PRIMARY KEY (chain_id, block_hash, tx_hash, log_index, game_address);


--
-- Name: fork_migration_events fork_migration_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fork_migration_events
    ADD CONSTRAINT fork_migration_events_pkey PRIMARY KEY (chain_id, block_hash, tx_hash, log_index, universe_identity);


--
-- Name: liquidation_approval_events liquidation_approval_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.liquidation_approval_events
    ADD CONSTRAINT liquidation_approval_events_pkey PRIMARY KEY (chain_id, block_hash, tx_hash, log_index, registry_address);


--
-- Name: live_event_state live_event_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_event_state
    ADD CONSTRAINT live_event_state_pkey PRIMARY KEY (singleton);


--
-- Name: live_events live_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_events
    ADD CONSTRAINT live_events_pkey PRIMARY KEY (id);


--
-- Name: log_scan_cursors log_scan_cursors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.log_scan_cursors
    ADD CONSTRAINT log_scan_cursors_pkey PRIMARY KEY (chain_id, contract_address);


--
-- Name: logs logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.logs
    ADD CONSTRAINT logs_pkey PRIMARY KEY (chain_id, block_hash, tx_hash, log_index);


--
-- Name: networks networks_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.networks
    ADD CONSTRAINT networks_id_key UNIQUE (id);


--
-- Name: networks networks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.networks
    ADD CONSTRAINT networks_pkey PRIMARY KEY (chain_id);


--
-- Name: open_oracle_report_events open_oracle_report_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_oracle_report_events
    ADD CONSTRAINT open_oracle_report_events_pkey PRIMARY KEY (chain_id, block_hash, tx_hash, log_index, open_oracle_address, report_id);


--
-- Name: pool_snapshots pool_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pool_snapshots
    ADD CONSTRAINT pool_snapshots_pkey PRIMARY KEY (chain_id, block_hash, tx_hash, log_index, pool_address);


--
-- Name: pool_state_events pool_state_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pool_state_events
    ADD CONSTRAINT pool_state_events_pkey PRIMARY KEY (chain_id, block_hash, tx_hash, log_index, pool_address);


--
-- Name: pools pools_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pools
    ADD CONSTRAINT pools_pkey PRIMARY KEY (chain_id, block_hash, tx_hash, log_index, pool_address);


--
-- Name: protocol_timeline_entries protocol_timeline_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.protocol_timeline_entries
    ADD CONSTRAINT protocol_timeline_entries_pkey PRIMARY KEY (chain_id, block_hash, tx_hash, log_index, entity_type, entity_identity);


--
-- Name: questions questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_pkey PRIMARY KEY (chain_id, block_hash, tx_hash, log_index, question_id);


--
-- Name: rep_eth_price_snapshots rep_eth_price_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rep_eth_price_snapshots
    ADD CONSTRAINT rep_eth_price_snapshots_pkey PRIMARY KEY (chain_id, block_hash, tx_hash, log_index, coordinator_address);


--
-- Name: token_metadata token_metadata_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.token_metadata
    ADD CONSTRAINT token_metadata_pkey PRIMARY KEY (chain_id, address, block_hash);


--
-- Name: transactions transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (chain_id, block_hash, hash);


--
-- Name: truth_auction_events truth_auction_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.truth_auction_events
    ADD CONSTRAINT truth_auction_events_pkey PRIMARY KEY (chain_id, block_hash, tx_hash, log_index, auction_address);


--
-- Name: uniswap_rep_eth_markets uniswap_rep_eth_markets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uniswap_rep_eth_markets
    ADD CONSTRAINT uniswap_rep_eth_markets_pkey PRIMARY KEY (chain_id, block_hash, tx_hash, log_index, market_id);


--
-- Name: uniswap_rep_eth_price_observations uniswap_rep_eth_price_observations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uniswap_rep_eth_price_observations
    ADD CONSTRAINT uniswap_rep_eth_price_observations_pkey PRIMARY KEY (chain_id, block_hash, tx_hash, log_index, market_id);


--
-- Name: universe_events universe_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.universe_events
    ADD CONSTRAINT universe_events_pkey PRIMARY KEY (chain_id, block_hash, tx_hash, log_index, universe_id);


--
-- Name: vault_snapshots vault_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vault_snapshots
    ADD CONSTRAINT vault_snapshots_pkey PRIMARY KEY (chain_id, block_hash, tx_hash, log_index, pool_address, vault_address);


--
-- Name: address_activity_address; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX address_activity_address ON public.address_activity USING btree (chain_id, address, block_number DESC) WHERE canonical;


--
-- Name: address_activity_pool; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX address_activity_pool ON public.address_activity USING btree (chain_id, pool_address, address) WHERE canonical;


--
-- Name: address_balances_latest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX address_balances_latest ON public.address_balance_snapshots USING btree (chain_id, address, asset_address, block_number DESC) WHERE canonical;


--
-- Name: amm_markets_canonical_pair; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX amm_markets_canonical_pair ON public.amm_markets USING btree (chain_id, pair_address) WHERE canonical;


--
-- Name: amm_markets_canonical_pool; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX amm_markets_canonical_pool ON public.amm_markets USING btree (chain_id, pool_address) WHERE canonical;


--
-- Name: amm_price_snapshots_history; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX amm_price_snapshots_history ON public.amm_price_snapshots USING btree (chain_id, pair_address, block_number DESC, log_index DESC) WHERE canonical;


--
-- Name: amm_trade_interval; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX amm_trade_interval ON public.amm_trade_events USING btree (chain_id, market_address, block_number, log_index, tx_hash) WHERE canonical;


--
-- Name: amm_trade_market; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX amm_trade_market ON public.amm_trade_events USING btree (chain_id, market_address, block_number DESC, log_index DESC) WHERE canonical;


--
-- Name: blocks_canonical_number; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX blocks_canonical_number ON public.blocks USING btree (chain_id, number) WHERE canonical;


--
-- Name: blocks_chain_hash_number; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX blocks_chain_hash_number ON public.blocks USING btree (chain_id, hash, number);


--
-- Name: entity_state_snapshot_canonical_latest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX entity_state_snapshot_canonical_latest ON public.entity_state_snapshots USING btree (chain_id, entity_type, entity_identity, block_number DESC, observed_at DESC) WHERE canonical;


--
-- Name: entity_state_snapshot_latest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX entity_state_snapshot_latest ON public.entity_state_snapshots USING btree (chain_id, entity_type, entity_identity, block_number DESC);


--
-- Name: escalation_game_event_page; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX escalation_game_event_page ON public.escalation_game_events USING btree (chain_id, game_address, block_number DESC, log_index DESC, tx_hash DESC) WHERE canonical;


--
-- Name: escalation_games_current; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX escalation_games_current ON public.escalation_game_events USING btree (chain_id, game_address, block_number DESC, log_index DESC) WHERE canonical;


--
-- Name: fork_migration_page; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fork_migration_page ON public.fork_migration_events USING btree (chain_id, universe_identity, block_number DESC, log_index DESC, tx_hash DESC) WHERE canonical;


--
-- Name: fork_migration_universe; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX fork_migration_universe ON public.fork_migration_events USING btree (chain_id, universe_identity, block_number DESC, log_index DESC) WHERE canonical;


--
-- Name: liquidation_approval_identity_page; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX liquidation_approval_identity_page ON public.liquidation_approval_events USING btree (chain_id, approval_identity, block_number DESC, transaction_index DESC, log_index DESC) WHERE canonical;


--
-- Name: liquidation_approval_vault_page; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX liquidation_approval_vault_page ON public.liquidation_approval_events USING btree (chain_id, receiver_vault, block_number DESC, transaction_index DESC, log_index DESC) WHERE canonical;


--
-- Name: live_events_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX live_events_created_at ON public.live_events USING btree (created_at);


--
-- Name: log_scan_cursors_progress; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX log_scan_cursors_progress ON public.log_scan_cursors USING btree (chain_id, last_retrieved_block, contract_address);


--
-- Name: logs_canonical_position; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX logs_canonical_position ON public.logs USING btree (chain_id, tx_hash, log_index) WHERE canonical;


--
-- Name: logs_emitter; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX logs_emitter ON public.logs USING btree (chain_id, emitter_address, block_number DESC) WHERE canonical;


--
-- Name: logs_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX logs_event ON public.logs USING btree (chain_id, event_name, block_number DESC) WHERE canonical;


--
-- Name: logs_feed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX logs_feed ON public.logs USING btree (chain_id, block_number DESC, transaction_index DESC, log_index DESC) WHERE canonical;


--
-- Name: open_oracle_report_round_page; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX open_oracle_report_round_page ON public.open_oracle_report_events USING btree (chain_id, open_oracle_address, report_id, block_number DESC, log_index DESC, tx_hash DESC) WHERE canonical;


--
-- Name: open_oracle_reports_current; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX open_oracle_reports_current ON public.open_oracle_report_events USING btree (chain_id, open_oracle_address, report_id, block_number DESC, log_index DESC) WHERE canonical;


--
-- Name: pool_snapshots_history; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pool_snapshots_history ON public.pool_snapshots USING btree (chain_id, pool_address, block_number DESC, log_index DESC) WHERE canonical;


--
-- Name: pool_state_events_history; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pool_state_events_history ON public.pool_state_events USING btree (chain_id, pool_address, block_number DESC, log_index DESC) WHERE canonical;


--
-- Name: pools_canonical_address; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX pools_canonical_address ON public.pools USING btree (chain_id, pool_address) WHERE canonical;


--
-- Name: pools_question; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pools_question ON public.pools USING btree (chain_id, question_id) WHERE canonical;


--
-- Name: pools_universe; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pools_universe ON public.pools USING btree (chain_id, universe_id) WHERE canonical;


--
-- Name: protocol_timeline_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX protocol_timeline_entity ON public.protocol_timeline_entries USING btree (chain_id, entity_type, entity_identity, block_number DESC, log_index DESC) WHERE canonical;


--
-- Name: protocol_timeline_page; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX protocol_timeline_page ON public.protocol_timeline_entries USING btree (chain_id, entity_type, entity_identity, block_number DESC, log_index DESC, tx_hash DESC) WHERE canonical;


--
-- Name: protocol_timeline_recent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX protocol_timeline_recent ON public.protocol_timeline_entries USING btree (chain_id, block_number DESC, log_index DESC) WHERE canonical;


--
-- Name: questions_canonical_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX questions_canonical_id ON public.questions USING btree (chain_id, question_id) WHERE canonical;


--
-- Name: rep_eth_price_snapshots_history; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rep_eth_price_snapshots_history ON public.rep_eth_price_snapshots USING btree (chain_id, coordinator_address, block_number DESC, log_index DESC) WHERE canonical;


--
-- Name: token_metadata_canonical_address; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX token_metadata_canonical_address ON public.token_metadata USING btree (chain_id, address) WHERE canonical;


--
-- Name: transactions_block_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX transactions_block_order ON public.transactions USING btree (chain_id, block_number DESC, transaction_index DESC) WHERE canonical;


--
-- Name: transactions_canonical_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX transactions_canonical_hash ON public.transactions USING btree (chain_id, hash) WHERE canonical;


--
-- Name: truth_auction_event_page; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX truth_auction_event_page ON public.truth_auction_events USING btree (chain_id, auction_address, block_number DESC, log_index DESC, tx_hash DESC) WHERE canonical;


--
-- Name: truth_auctions_current; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX truth_auctions_current ON public.truth_auction_events USING btree (chain_id, auction_address, block_number DESC, log_index DESC) WHERE canonical;


--
-- Name: uniswap_rep_eth_markets_canonical_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniswap_rep_eth_markets_canonical_id ON public.uniswap_rep_eth_markets USING btree (chain_id, venue, market_id) WHERE canonical;


--
-- Name: uniswap_rep_eth_markets_tokens; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX uniswap_rep_eth_markets_tokens ON public.uniswap_rep_eth_markets USING btree (chain_id, token0_address, token1_address) WHERE canonical;


--
-- Name: uniswap_rep_eth_price_observations_history; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX uniswap_rep_eth_price_observations_history ON public.uniswap_rep_eth_price_observations USING btree (chain_id, venue, market_id, block_number DESC, log_index DESC) WHERE canonical;


--
-- Name: universe_events_history; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX universe_events_history ON public.universe_events USING btree (chain_id, universe_id, block_number DESC, log_index DESC) WHERE canonical;


--
-- Name: vault_snapshots_history; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vault_snapshots_history ON public.vault_snapshots USING btree (chain_id, vault_address, pool_address, block_number DESC, log_index DESC) WHERE canonical;


--
-- Name: actions actions_chain_id_block_hash_tx_hash_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.actions
    ADD CONSTRAINT actions_chain_id_block_hash_tx_hash_fkey FOREIGN KEY (chain_id, block_hash, tx_hash) REFERENCES public.transactions(chain_id, block_hash, hash);


--
-- Name: address_activity address_activity_chain_id_block_hash_block_number_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.address_activity
    ADD CONSTRAINT address_activity_chain_id_block_hash_block_number_fkey FOREIGN KEY (chain_id, block_hash, block_number) REFERENCES public.blocks(chain_id, hash, number);


--
-- Name: address_activity address_activity_chain_id_block_hash_tx_hash_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.address_activity
    ADD CONSTRAINT address_activity_chain_id_block_hash_tx_hash_fkey FOREIGN KEY (chain_id, block_hash, tx_hash) REFERENCES public.transactions(chain_id, block_hash, hash);


--
-- Name: address_balance_snapshots address_balance_snapshots_chain_id_block_hash_block_number_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.address_balance_snapshots
    ADD CONSTRAINT address_balance_snapshots_chain_id_block_hash_block_number_fkey FOREIGN KEY (chain_id, block_hash, block_number) REFERENCES public.blocks(chain_id, hash, number);


--
-- Name: amm_markets amm_markets_chain_id_block_hash_tx_hash_log_index_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.amm_markets
    ADD CONSTRAINT amm_markets_chain_id_block_hash_tx_hash_log_index_fkey FOREIGN KEY (chain_id, block_hash, tx_hash, log_index) REFERENCES public.logs(chain_id, block_hash, tx_hash, log_index);


--
-- Name: amm_price_snapshots amm_price_snapshots_chain_id_block_hash_tx_hash_log_index_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.amm_price_snapshots
    ADD CONSTRAINT amm_price_snapshots_chain_id_block_hash_tx_hash_log_index_fkey FOREIGN KEY (chain_id, block_hash, tx_hash, log_index) REFERENCES public.logs(chain_id, block_hash, tx_hash, log_index);


--
-- Name: amm_trade_events amm_trade_events_chain_id_block_hash_tx_hash_log_index_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.amm_trade_events
    ADD CONSTRAINT amm_trade_events_chain_id_block_hash_tx_hash_log_index_fkey FOREIGN KEY (chain_id, block_hash, tx_hash, log_index) REFERENCES public.logs(chain_id, block_hash, tx_hash, log_index);


--
-- Name: blocks blocks_chain_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blocks
    ADD CONSTRAINT blocks_chain_id_fkey FOREIGN KEY (chain_id) REFERENCES public.networks(chain_id);


--
-- Name: contract_discoveries contract_discoveries_block_position_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_discoveries
    ADD CONSTRAINT contract_discoveries_block_position_fk FOREIGN KEY (chain_id, block_hash, block_number) REFERENCES public.blocks(chain_id, hash, number);


--
-- Name: contract_discoveries contract_discoveries_chain_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contract_discoveries
    ADD CONSTRAINT contract_discoveries_chain_id_fkey FOREIGN KEY (chain_id) REFERENCES public.networks(chain_id);


--
-- Name: contracts contracts_chain_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contracts
    ADD CONSTRAINT contracts_chain_id_fkey FOREIGN KEY (chain_id) REFERENCES public.networks(chain_id);


--
-- Name: entity_state_snapshots entity_state_snapshots_chain_id_block_hash_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_state_snapshots
    ADD CONSTRAINT entity_state_snapshots_chain_id_block_hash_fkey FOREIGN KEY (chain_id, block_hash) REFERENCES public.blocks(chain_id, hash);


--
-- Name: escalation_game_events escalation_game_events_chain_id_block_hash_tx_hash_log_ind_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.escalation_game_events
    ADD CONSTRAINT escalation_game_events_chain_id_block_hash_tx_hash_log_ind_fkey FOREIGN KEY (chain_id, block_hash, tx_hash, log_index) REFERENCES public.logs(chain_id, block_hash, tx_hash, log_index);


--
-- Name: fork_migration_events fork_migration_events_chain_id_block_hash_tx_hash_log_inde_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fork_migration_events
    ADD CONSTRAINT fork_migration_events_chain_id_block_hash_tx_hash_log_inde_fkey FOREIGN KEY (chain_id, block_hash, tx_hash, log_index) REFERENCES public.logs(chain_id, block_hash, tx_hash, log_index);


--
-- Name: liquidation_approval_events liquidation_approval_events_chain_id_block_hash_tx_hash_lo_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.liquidation_approval_events
    ADD CONSTRAINT liquidation_approval_events_chain_id_block_hash_tx_hash_lo_fkey FOREIGN KEY (chain_id, block_hash, tx_hash, log_index) REFERENCES public.logs(chain_id, block_hash, tx_hash, log_index);


--
-- Name: log_scan_cursors log_scan_cursors_chain_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.log_scan_cursors
    ADD CONSTRAINT log_scan_cursors_chain_id_fkey FOREIGN KEY (chain_id) REFERENCES public.networks(chain_id);


--
-- Name: logs logs_chain_id_block_hash_tx_hash_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.logs
    ADD CONSTRAINT logs_chain_id_block_hash_tx_hash_fkey FOREIGN KEY (chain_id, block_hash, tx_hash) REFERENCES public.transactions(chain_id, block_hash, hash);


--
-- Name: open_oracle_report_events open_oracle_report_events_chain_id_block_hash_tx_hash_log__fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.open_oracle_report_events
    ADD CONSTRAINT open_oracle_report_events_chain_id_block_hash_tx_hash_log__fkey FOREIGN KEY (chain_id, block_hash, tx_hash, log_index) REFERENCES public.logs(chain_id, block_hash, tx_hash, log_index);


--
-- Name: pool_snapshots pool_snapshots_chain_id_block_hash_tx_hash_log_index_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pool_snapshots
    ADD CONSTRAINT pool_snapshots_chain_id_block_hash_tx_hash_log_index_fkey FOREIGN KEY (chain_id, block_hash, tx_hash, log_index) REFERENCES public.logs(chain_id, block_hash, tx_hash, log_index);


--
-- Name: pool_state_events pool_state_events_chain_id_block_hash_tx_hash_log_index_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pool_state_events
    ADD CONSTRAINT pool_state_events_chain_id_block_hash_tx_hash_log_index_fkey FOREIGN KEY (chain_id, block_hash, tx_hash, log_index) REFERENCES public.logs(chain_id, block_hash, tx_hash, log_index);


--
-- Name: pools pools_chain_id_block_hash_tx_hash_log_index_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pools
    ADD CONSTRAINT pools_chain_id_block_hash_tx_hash_log_index_fkey FOREIGN KEY (chain_id, block_hash, tx_hash, log_index) REFERENCES public.logs(chain_id, block_hash, tx_hash, log_index);


--
-- Name: protocol_timeline_entries protocol_timeline_entries_chain_id_block_hash_tx_hash_log__fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.protocol_timeline_entries
    ADD CONSTRAINT protocol_timeline_entries_chain_id_block_hash_tx_hash_log__fkey FOREIGN KEY (chain_id, block_hash, tx_hash, log_index) REFERENCES public.logs(chain_id, block_hash, tx_hash, log_index);


--
-- Name: questions questions_chain_id_block_hash_tx_hash_log_index_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_chain_id_block_hash_tx_hash_log_index_fkey FOREIGN KEY (chain_id, block_hash, tx_hash, log_index) REFERENCES public.logs(chain_id, block_hash, tx_hash, log_index);


--
-- Name: rep_eth_price_snapshots rep_eth_price_snapshots_chain_id_block_hash_tx_hash_log_in_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rep_eth_price_snapshots
    ADD CONSTRAINT rep_eth_price_snapshots_chain_id_block_hash_tx_hash_log_in_fkey FOREIGN KEY (chain_id, block_hash, tx_hash, log_index) REFERENCES public.logs(chain_id, block_hash, tx_hash, log_index);


--
-- Name: token_metadata token_metadata_block_position_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.token_metadata
    ADD CONSTRAINT token_metadata_block_position_fk FOREIGN KEY (chain_id, block_hash, read_block) REFERENCES public.blocks(chain_id, hash, number);


--
-- Name: transactions transactions_block_position_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_block_position_fk FOREIGN KEY (chain_id, block_hash, block_number) REFERENCES public.blocks(chain_id, hash, number);


--
-- Name: transactions transactions_chain_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_chain_id_fkey FOREIGN KEY (chain_id) REFERENCES public.networks(chain_id);


--
-- Name: truth_auction_events truth_auction_events_chain_id_block_hash_tx_hash_log_index_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.truth_auction_events
    ADD CONSTRAINT truth_auction_events_chain_id_block_hash_tx_hash_log_index_fkey FOREIGN KEY (chain_id, block_hash, tx_hash, log_index) REFERENCES public.logs(chain_id, block_hash, tx_hash, log_index);


--
-- Name: uniswap_rep_eth_markets uniswap_rep_eth_markets_chain_id_block_hash_tx_hash_log_in_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uniswap_rep_eth_markets
    ADD CONSTRAINT uniswap_rep_eth_markets_chain_id_block_hash_tx_hash_log_in_fkey FOREIGN KEY (chain_id, block_hash, tx_hash, log_index) REFERENCES public.logs(chain_id, block_hash, tx_hash, log_index);


--
-- Name: uniswap_rep_eth_price_observations uniswap_rep_eth_price_observa_chain_id_block_hash_tx_hash__fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uniswap_rep_eth_price_observations
    ADD CONSTRAINT uniswap_rep_eth_price_observa_chain_id_block_hash_tx_hash__fkey FOREIGN KEY (chain_id, block_hash, tx_hash, log_index) REFERENCES public.logs(chain_id, block_hash, tx_hash, log_index);


--
-- Name: universe_events universe_events_chain_id_block_hash_tx_hash_log_index_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.universe_events
    ADD CONSTRAINT universe_events_chain_id_block_hash_tx_hash_log_index_fkey FOREIGN KEY (chain_id, block_hash, tx_hash, log_index) REFERENCES public.logs(chain_id, block_hash, tx_hash, log_index);


--
-- Name: vault_snapshots vault_snapshots_chain_id_block_hash_tx_hash_log_index_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vault_snapshots
    ADD CONSTRAINT vault_snapshots_chain_id_block_hash_tx_hash_log_index_fkey FOREIGN KEY (chain_id, block_hash, tx_hash, log_index) REFERENCES public.logs(chain_id, block_hash, tx_hash, log_index);


--
-- Historical integrity and scanner provenance
--

CREATE TABLE public.augurscan_schema_migrations (
    schema_version text NOT NULL,
    description text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT augurscan_schema_migrations_pkey PRIMARY KEY (schema_version)
);

CREATE TABLE public.chain_reorganizations (
    id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
    chain_id bigint NOT NULL,
    previous_block bigint,
    previous_hash text,
    ancestor_block bigint NOT NULL,
    ancestor_hash text,
    depth bigint NOT NULL,
    reason text NOT NULL,
    detected_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chain_reorganizations_pkey PRIMARY KEY (id),
    CONSTRAINT chain_reorganizations_chain_id_fkey FOREIGN KEY (chain_id) REFERENCES public.networks(chain_id),
    CONSTRAINT chain_reorganizations_depth_check CHECK ((depth >= 0)),
    CONSTRAINT chain_reorganizations_reason_check CHECK ((reason = ANY (ARRAY['chain-reorg'::text, 'manifest-reset'::text, 'start-boundary-advanced'::text])))
);

CREATE INDEX chain_reorganizations_history
    ON public.chain_reorganizations USING btree (chain_id, detected_at DESC, id DESC);

CREATE TABLE public.indexer_runs (
    id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
    schema_version text NOT NULL,
    app_version text NOT NULL,
    abi_source_hash text NOT NULL,
    network_configuration jsonb NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    stopped_at timestamp with time zone,
    CONSTRAINT indexer_runs_pkey PRIMARY KEY (id)
);

CREATE INDEX indexer_runs_started_at ON public.indexer_runs USING btree (started_at DESC, id DESC);


--
-- PostgreSQL database dump complete
--
