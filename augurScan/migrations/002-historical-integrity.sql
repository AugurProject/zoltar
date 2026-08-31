ALTER TABLE public.networks
    ADD COLUMN applied_abi_source_hash text,
    ADD COLUMN applied_application_source_hash text,
    ADD COLUMN applied_projection_source_hash text;

ALTER TABLE public.contracts
    ADD COLUMN configured_deployment_block bigint;

CREATE INDEX pool_snapshots_detail_page
    ON public.pool_snapshots USING btree (chain_id, pool_address, block_number DESC, log_index DESC, tx_hash DESC, block_hash DESC) WHERE canonical;

CREATE INDEX vault_snapshots_detail_page
    ON public.vault_snapshots USING btree (chain_id, pool_address, vault_address, block_number DESC, log_index DESC, tx_hash DESC, block_hash DESC) WHERE canonical;

CREATE INDEX protocol_timeline_entity_history_page
    ON public.protocol_timeline_entries USING btree (chain_id, entity_type, entity_identity, block_number DESC, log_index DESC, tx_hash DESC, block_hash DESC) WHERE canonical;

CREATE INDEX protocol_timeline_history_page
    ON public.protocol_timeline_entries USING btree (chain_id, block_number DESC, log_index DESC, tx_hash DESC, block_hash DESC, entity_type DESC, entity_identity DESC) WHERE canonical;

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
    indexer_run_id bigint,
    abi_source_hash text,
    application_source_hash text,
    projection_source_hash text,
    detected_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chain_reorganizations_pkey PRIMARY KEY (id),
    CONSTRAINT chain_reorganizations_chain_id_fkey FOREIGN KEY (chain_id) REFERENCES public.networks(chain_id),
    CONSTRAINT chain_reorganizations_depth_check CHECK ((depth >= 0)),
    CONSTRAINT chain_reorganizations_reason_check CHECK ((reason = ANY (ARRAY['chain-reorg'::text, 'manifest-reset'::text, 'start-boundary-advanced'::text, 'abi-redecode'::text, 'projection-rebuild'::text])))
);

CREATE INDEX chain_reorganizations_history
    ON public.chain_reorganizations USING btree (chain_id, detected_at DESC, id DESC);

CREATE TABLE public.history_invalidation_causes (
    invalidation_id bigint NOT NULL,
    reason text NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT history_invalidation_causes_pkey PRIMARY KEY (invalidation_id, reason),
    CONSTRAINT history_invalidation_causes_reason_check CHECK ((reason = ANY (ARRAY['chain-reorg'::text, 'manifest-reset'::text, 'start-boundary-advanced'::text, 'abi-redecode'::text, 'projection-rebuild'::text]))),
    CONSTRAINT history_invalidation_causes_invalidation_fkey FOREIGN KEY (invalidation_id) REFERENCES public.chain_reorganizations(id)
);

CREATE TABLE public.indexer_runs (
    id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
    schema_version text NOT NULL,
    app_version text NOT NULL,
    abi_source_hash text NOT NULL,
    application_source_hash text NOT NULL,
    projection_source_hash text NOT NULL,
    indexer_enabled boolean NOT NULL,
    network_configuration jsonb NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    stopped_at timestamp with time zone,
    CONSTRAINT indexer_runs_pkey PRIMARY KEY (id)
);

CREATE INDEX indexer_runs_started_at ON public.indexer_runs USING btree (started_at DESC, id DESC);

ALTER TABLE ONLY public.chain_reorganizations
    ADD CONSTRAINT chain_reorganizations_indexer_run_fkey FOREIGN KEY (indexer_run_id) REFERENCES public.indexer_runs(id);

ALTER TABLE public.entity_state_snapshots
    ADD COLUMN indexer_run_id bigint,
    ADD COLUMN abi_source_hash text,
    ADD COLUMN application_source_hash text,
    ADD COLUMN projection_source_hash text;

CREATE TABLE public.entity_state_observations (
    id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
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
    indexer_run_id bigint,
    abi_source_hash text,
    application_source_hash text,
    projection_source_hash text,
    CONSTRAINT entity_state_observations_pkey PRIMARY KEY (id),
    CONSTRAINT entity_state_observations_read_status_check CHECK ((read_status = ANY (ARRAY['success'::text, 'failed'::text, 'pending'::text, 'stale'::text]))),
    CONSTRAINT entity_state_observations_block_fkey FOREIGN KEY (chain_id, block_hash) REFERENCES public.blocks(chain_id, hash),
    CONSTRAINT entity_state_observations_run_fkey FOREIGN KEY (indexer_run_id) REFERENCES public.indexer_runs(id)
);

CREATE INDEX entity_state_observation_canonical_history
    ON public.entity_state_observations USING btree (chain_id, entity_type, entity_identity, block_number DESC, observed_at DESC, id DESC) WHERE canonical;

INSERT INTO public.entity_state_observations (
    chain_id, entity_type, entity_identity, block_number, block_hash, block_timestamp,
    source_method, read_status, read_result, read_failure_reason, observed_at, canonical
)
SELECT chain_id, entity_type, entity_identity, block_number, block_hash, block_timestamp,
    source_method, read_status, read_result, read_failure_reason, observed_at, canonical
FROM public.entity_state_snapshots;

CREATE TABLE public.address_balance_observations (
    id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
    chain_id bigint NOT NULL,
    block_hash text NOT NULL,
    block_number bigint NOT NULL,
    address text NOT NULL,
    asset_address text NOT NULL,
    asset_kind text NOT NULL,
    read_status text NOT NULL,
    balance numeric(78,0),
    read_failure_reason text,
    canonical boolean DEFAULT true NOT NULL,
    observed_at timestamp with time zone DEFAULT now() NOT NULL,
    indexer_run_id bigint,
    abi_source_hash text,
    application_source_hash text,
    projection_source_hash text,
    CONSTRAINT address_balance_observations_pkey PRIMARY KEY (id),
    CONSTRAINT address_balance_observations_asset_kind_check CHECK ((asset_kind = ANY (ARRAY['native'::text, 'rep'::text, 'weth'::text]))),
    CONSTRAINT address_balance_observations_read_status_check CHECK ((read_status = ANY (ARRAY['success'::text, 'failed'::text]))),
    CONSTRAINT address_balance_observations_result_check CHECK ((((read_status = 'success'::text) AND (balance IS NOT NULL) AND (read_failure_reason IS NULL)) OR ((read_status = 'failed'::text) AND (balance IS NULL) AND (read_failure_reason IS NOT NULL) AND (length(read_failure_reason) > 0)))),
    CONSTRAINT address_balance_observations_balance_check CHECK (((balance IS NULL) OR (balance >= (0)::numeric))),
    CONSTRAINT address_balance_observations_block_fkey FOREIGN KEY (chain_id, block_hash, block_number) REFERENCES public.blocks(chain_id, hash, number),
    CONSTRAINT address_balance_observations_run_fkey FOREIGN KEY (indexer_run_id) REFERENCES public.indexer_runs(id)
);

CREATE INDEX address_balance_observation_history
    ON public.address_balance_observations USING btree (chain_id, address, asset_address, block_number DESC, observed_at DESC, id DESC);

CREATE INDEX address_balance_observation_page
    ON public.address_balance_observations USING btree (chain_id, observed_at DESC, id DESC);

CREATE INDEX address_balance_observation_address_page
    ON public.address_balance_observations USING btree (chain_id, address, observed_at DESC, id DESC);

CREATE INDEX address_balance_observation_asset_page
    ON public.address_balance_observations USING btree (chain_id, asset_address, observed_at DESC, id DESC);

INSERT INTO public.address_balance_observations (
    chain_id, block_hash, block_number, address, asset_address, asset_kind,
    read_status, balance, canonical, observed_at
)
SELECT chain_id, block_hash, block_number, address, asset_address, asset_kind,
    'success', balance, canonical, observed_at
FROM public.address_balance_snapshots;

CREATE TABLE public.token_metadata_observations (
    id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
    chain_id bigint NOT NULL,
    address text NOT NULL,
    block_hash text NOT NULL,
    name text,
    symbol text,
    decimals integer,
    read_status text NOT NULL,
    read_error text,
    read_block bigint NOT NULL,
    canonical boolean DEFAULT true NOT NULL,
    observed_at timestamp with time zone DEFAULT now() NOT NULL,
    indexer_run_id bigint,
    abi_source_hash text,
    application_source_hash text,
    projection_source_hash text,
    CONSTRAINT token_metadata_observations_pkey PRIMARY KEY (id),
    CONSTRAINT token_metadata_observations_read_status_check CHECK ((read_status = ANY (ARRAY['success'::text, 'failed'::text]))),
    CONSTRAINT token_metadata_observations_result_check CHECK ((((read_status = 'success'::text) AND (read_error IS NULL)) OR ((read_status = 'failed'::text) AND (read_error IS NOT NULL) AND (length(read_error) > 0)))),
    CONSTRAINT token_metadata_observations_block_fkey FOREIGN KEY (chain_id, block_hash, read_block) REFERENCES public.blocks(chain_id, hash, number),
    CONSTRAINT token_metadata_observations_run_fkey FOREIGN KEY (indexer_run_id) REFERENCES public.indexer_runs(id)
);

CREATE INDEX token_metadata_observation_history
    ON public.token_metadata_observations USING btree (chain_id, address, read_block DESC, observed_at DESC, id DESC);

CREATE INDEX token_metadata_observation_page
    ON public.token_metadata_observations USING btree (chain_id, observed_at DESC, id DESC);

CREATE INDEX token_metadata_observation_address_page
    ON public.token_metadata_observations USING btree (chain_id, address, observed_at DESC, id DESC);

INSERT INTO public.token_metadata_observations (
    chain_id, address, block_hash, name, symbol, decimals, read_status, read_error, read_block, canonical, observed_at
)
SELECT chain_id, address, block_hash, name, symbol, decimals,
    CASE WHEN read_error IS NULL THEN 'success' ELSE 'failed' END,
    read_error, read_block, canonical, updated_at
FROM public.token_metadata;

CREATE TABLE public.action_interpretations (
    chain_id bigint NOT NULL,
    block_hash text NOT NULL,
    tx_hash text NOT NULL,
    indexer_run_id bigint NOT NULL,
    abi_source_hash text NOT NULL,
    application_source_hash text NOT NULL,
    interpretation jsonb NOT NULL,
    interpreted_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT action_interpretations_pkey PRIMARY KEY (chain_id, block_hash, tx_hash, indexer_run_id),
    CONSTRAINT action_interpretations_action_fkey FOREIGN KEY (chain_id, block_hash, tx_hash) REFERENCES public.actions(chain_id, block_hash, tx_hash),
    CONSTRAINT action_interpretations_run_fkey FOREIGN KEY (indexer_run_id) REFERENCES public.indexer_runs(id)
);

CREATE INDEX action_interpretations_history
    ON public.action_interpretations USING btree (chain_id, block_hash, tx_hash, interpreted_at DESC, indexer_run_id DESC);

CREATE TABLE public.log_interpretations (
    chain_id bigint NOT NULL,
    block_hash text NOT NULL,
    tx_hash text NOT NULL,
    log_index integer NOT NULL,
    interpretation_kind text NOT NULL,
    interpretation_key text NOT NULL,
    indexer_run_id bigint NOT NULL,
    abi_source_hash text NOT NULL,
    application_source_hash text NOT NULL,
    projection_source_hash text NOT NULL,
    interpretation jsonb NOT NULL,
    interpreted_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT log_interpretations_pkey PRIMARY KEY (chain_id, block_hash, tx_hash, log_index, interpretation_kind, interpretation_key, indexer_run_id),
    CONSTRAINT log_interpretations_kind_check CHECK ((interpretation_kind = ANY (ARRAY['decode'::text, 'projection'::text]))),
    CONSTRAINT log_interpretations_log_fkey FOREIGN KEY (chain_id, block_hash, tx_hash, log_index) REFERENCES public.logs(chain_id, block_hash, tx_hash, log_index),
    CONSTRAINT log_interpretations_run_fkey FOREIGN KEY (indexer_run_id) REFERENCES public.indexer_runs(id)
);

CREATE INDEX log_interpretations_history
    ON public.log_interpretations USING btree (chain_id, block_hash, tx_hash, log_index, interpreted_at DESC, indexer_run_id DESC);

CREATE TABLE public.history_invalidation_occurrences (
    invalidation_id bigint NOT NULL,
    occurrence_kind text NOT NULL,
    chain_id bigint NOT NULL,
    block_hash text NOT NULL,
    occurrence_id text NOT NULL,
    sub_index integer NOT NULL,
    captured_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT history_invalidation_occurrences_pkey PRIMARY KEY (invalidation_id, occurrence_kind, chain_id, block_hash, occurrence_id, sub_index),
    CONSTRAINT history_invalidation_occurrences_kind_check CHECK ((occurrence_kind = ANY (ARRAY['block'::text, 'transaction'::text, 'log'::text, 'entity-state'::text, 'address-balance'::text, 'token-metadata'::text]))),
    CONSTRAINT history_invalidation_occurrences_invalidation_fkey FOREIGN KEY (invalidation_id) REFERENCES public.chain_reorganizations(id),
    CONSTRAINT history_invalidation_occurrences_chain_fkey FOREIGN KEY (chain_id) REFERENCES public.networks(chain_id)
);

CREATE INDEX history_invalidation_occurrences_lookup
    ON public.history_invalidation_occurrences USING btree (occurrence_kind, chain_id, block_hash, occurrence_id, sub_index, invalidation_id DESC);

INSERT INTO public.amm_trade_events
    (chain_id, block_hash, tx_hash, log_index, block_number, market_address, event_name, event_data, canonical)
SELECT log.chain_id, log.block_hash, log.tx_hash, log.log_index, log.block_number,
    CASE WHEN log.event_name = 'PairCreated' THEN lower(log.arguments->>'pair') ELSE log.emitter_address END,
    log.event_name, log.arguments, log.canonical
FROM public.logs log
WHERE log.event_name IN ('PairCreated', 'Transfer', 'Approval') AND log.decode_status = 'decoded' AND log.arguments IS NOT NULL
    AND ((log.event_name = 'PairCreated' AND EXISTS (
        SELECT 1 FROM public.amm_markets market
        WHERE market.chain_id = log.chain_id AND market.block_hash = log.block_hash
            AND market.tx_hash = log.tx_hash AND market.log_index = log.log_index
            AND market.pair_address = lower(log.arguments->>'pair')
    )) OR EXISTS (
        SELECT 1 FROM public.amm_markets market
        WHERE market.chain_id = log.chain_id AND market.pair_address = log.emitter_address
    ))
ON CONFLICT (chain_id, block_hash, tx_hash, log_index, market_address)
DO UPDATE SET canonical = EXCLUDED.canonical, event_data = EXCLUDED.event_data;

INSERT INTO public.protocol_timeline_entries
    (chain_id, block_hash, tx_hash, log_index, block_number, entity_type, entity_identity,
        semantic_event_kind, summary_data, related_entities, source_contract, source_event, canonical)
SELECT log.chain_id, log.block_hash, log.tx_hash, log.log_index, log.block_number,
    CASE
        WHEN log.event_name = 'QuestionCreated' THEN 'question'
        WHEN log.event_name IN ('DeploySecurityPool', 'SecurityPoolRegistered') THEN 'pool'
        WHEN log.event_name IN ('PairCreated', 'Transfer', 'Approval') THEN 'amm'
        WHEN log.event_name = 'UniverseInitialized' THEN 'fork'
        WHEN log.event_name IN ('EscalationMigrationEntitlementInitialized', 'EscalationMigrationEntitlementMaterialized') THEN 'fork'
        WHEN log.event_name = 'ForkContinuationResidualRepBurned' THEN 'escalation'
        WHEN log.event_name = 'VaultDepositTargetHealthFactorRecorded' THEN 'vault'
        WHEN log.event_name IN ('TheoreticalSupplySet', 'Mint', 'Burn') THEN 'reputation-token'
        WHEN log.event_name IN ('AuthorizationUpdated', 'TransferSingle', 'TransferBatch') THEN 'share-token'
        WHEN log.event_name = 'DeploymentAddressesSet' THEN 'deployment'
        ELSE 'price-coordinator'
    END,
    lower(CASE
        WHEN log.event_name = 'QuestionCreated' THEN log.arguments->>'questionId'
        WHEN log.event_name IN ('DeploySecurityPool', 'SecurityPoolRegistered') THEN log.arguments->>'securityPool'
        WHEN log.event_name = 'PairCreated' THEN log.arguments->>'pair'
        WHEN log.event_name = 'UniverseInitialized' THEN log.arguments->>'universeId'
        WHEN log.event_name IN ('EscalationMigrationEntitlementInitialized', 'EscalationMigrationEntitlementMaterialized') THEN log.arguments->>'parent'
        WHEN log.event_name = 'VaultDepositTargetHealthFactorRecorded' THEN log.emitter_address || ':' || lower(log.arguments->>'vault')
        ELSE log.emitter_address
    END),
    log.event_name, log.arguments,
    COALESCE(to_jsonb(ARRAY(SELECT lower(value) FROM jsonb_each_text(log.arguments)
        WHERE value ~ '^0x[0-9a-fA-F]{40}$')), '[]'::jsonb),
    log.emitter_address, log.event_name, log.canonical
FROM public.logs log
WHERE log.event_name IN (
        'QuestionCreated', 'DeploymentAddressesSet', 'TheoreticalSupplySet', 'Mint', 'Burn',
        'AuthorizationUpdated', 'TransferSingle', 'TransferBatch', 'InternalApproval',
        'DeploySecurityPool', 'SecurityPoolRegistered', 'PairCreated', 'UniverseInitialized', 'Transfer', 'Approval',
        'EscalationMigrationEntitlementInitialized', 'EscalationMigrationEntitlementMaterialized',
        'ForkContinuationResidualRepBurned', 'VaultDepositTargetHealthFactorRecorded'
    )
    AND log.decode_status = 'decoded' AND log.arguments IS NOT NULL
    AND (log.event_name <> 'PairCreated' OR EXISTS (
        SELECT 1 FROM public.amm_markets market
        WHERE market.chain_id = log.chain_id AND market.block_hash = log.block_hash
            AND market.tx_hash = log.tx_hash AND market.log_index = log.log_index
            AND market.pair_address = lower(log.arguments->>'pair')
    ))
    AND (log.event_name NOT IN ('Transfer', 'Approval') OR EXISTS (
        SELECT 1 FROM public.amm_markets market
        WHERE market.chain_id = log.chain_id AND market.pair_address = log.emitter_address
    ))
ON CONFLICT (chain_id, block_hash, tx_hash, log_index, entity_type, entity_identity)
DO UPDATE SET canonical = EXCLUDED.canonical, summary_data = EXCLUDED.summary_data,
    related_entities = EXCLUDED.related_entities;

INSERT INTO public.fork_migration_events
    (chain_id, block_hash, tx_hash, log_index, block_number, universe_identity, event_name, event_data, canonical)
SELECT log.chain_id, log.block_hash, log.tx_hash, log.log_index, log.block_number,
    CASE WHEN log.event_name = 'UniverseInitialized' THEN log.arguments->>'universeId' ELSE log.arguments->>'parent' END,
    log.event_name, log.arguments, log.canonical
FROM public.logs log
WHERE log.event_name IN ('UniverseInitialized', 'EscalationMigrationEntitlementInitialized', 'EscalationMigrationEntitlementMaterialized')
    AND log.decode_status = 'decoded' AND log.arguments IS NOT NULL
    AND ((log.event_name = 'UniverseInitialized' AND log.arguments ? 'universeId')
        OR (log.event_name <> 'UniverseInitialized' AND log.arguments ? 'parent'))
ON CONFLICT (chain_id, block_hash, tx_hash, log_index, universe_identity)
DO UPDATE SET canonical = EXCLUDED.canonical, event_data = EXCLUDED.event_data;

INSERT INTO public.escalation_game_events
    (chain_id, block_hash, tx_hash, log_index, block_number, game_address, event_name, event_data, canonical)
SELECT log.chain_id, log.block_hash, log.tx_hash, log.log_index, log.block_number,
    log.emitter_address, log.event_name, log.arguments, log.canonical
FROM public.logs log
WHERE log.event_name = 'ForkContinuationResidualRepBurned' AND log.decode_status = 'decoded' AND log.arguments IS NOT NULL
ON CONFLICT (chain_id, block_hash, tx_hash, log_index, game_address)
DO UPDATE SET canonical = EXCLUDED.canonical, event_data = EXCLUDED.event_data;

UPDATE public.fork_migration_events
SET universe_identity = COALESCE(
    event_data->>'universeId', event_data->>'parentUniverseId', event_data->>'parent',
    event_data->>'parentPool', event_data->>'securityPool', event_data->>'childUniverseId',
    event_data->>'childPool', universe_identity
);

UPDATE public.protocol_timeline_entries
SET entity_identity = lower(COALESCE(
    summary_data->>'universeId', summary_data->>'parentUniverseId', summary_data->>'parent',
    summary_data->>'parentPool', summary_data->>'securityPool', summary_data->>'childUniverseId',
    summary_data->>'childPool', source_contract
))
WHERE entity_type = 'fork' AND source_event <> 'Migrate';

UPDATE public.protocol_timeline_entries
SET entity_type = 'share-token', entity_identity = source_contract
WHERE source_event = 'Migrate';

DELETE FROM public.fork_migration_events WHERE event_name = 'Migrate';
