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

INSERT INTO public.amm_trade_events
    (chain_id, block_hash, tx_hash, log_index, block_number, market_address, event_name, event_data, canonical)
SELECT log.chain_id, log.block_hash, log.tx_hash, log.log_index, log.block_number,
    CASE WHEN log.event_name = 'PairCreated' THEN lower(log.arguments->>'pair') ELSE log.emitter_address END,
    log.event_name, log.arguments, log.canonical
FROM public.logs log
WHERE log.event_name IN ('PairCreated', 'Transfer') AND log.decode_status = 'decoded' AND log.arguments IS NOT NULL
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
        WHEN log.event_name = 'PairCreated' OR log.event_name = 'Transfer' THEN 'amm'
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
        'DeploySecurityPool', 'SecurityPoolRegistered', 'PairCreated', 'UniverseInitialized', 'Transfer',
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
    AND (log.event_name <> 'Transfer' OR EXISTS (
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
