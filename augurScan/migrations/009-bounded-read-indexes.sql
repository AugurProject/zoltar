CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA pg_catalog;
CREATE INDEX logs_sender_lookup ON public.logs USING btree (chain_id, lower((arguments ->> 'from'::text)), block_number DESC) WHERE canonical;
CREATE INDEX logs_receiver_lookup ON public.logs USING btree (chain_id, lower((arguments ->> 'to'::text)), block_number DESC) WHERE canonical;
CREATE INDEX logs_creator_lookup ON public.logs USING btree (chain_id, lower((arguments ->> 'creator'::text)), block_number DESC) WHERE canonical;
CREATE INDEX logs_redeemer_lookup ON public.logs USING btree (chain_id, lower((arguments ->> 'redeemer'::text)), block_number DESC) WHERE canonical;
CREATE INDEX logs_recipient_lookup ON public.logs USING btree (chain_id, lower((arguments ->> 'recipient'::text)), block_number DESC) WHERE canonical;
CREATE INDEX logs_migrator_lookup ON public.logs USING btree (chain_id, emitter_address, lower((arguments ->> 'migrator'::text)), block_number DESC) WHERE canonical;
CREATE INDEX logs_report_lookup ON public.logs USING btree (chain_id, ((arguments ->> 'reportId'::text)), block_number DESC, log_index DESC, tx_hash DESC) WHERE canonical;
CREATE INDEX transactions_sender_history ON public.transactions USING btree (chain_id, from_address, block_number DESC, transaction_index DESC) WHERE canonical;
CREATE INDEX escalation_depositor_lookup ON public.escalation_game_events USING btree (chain_id, lower((event_data ->> 'depositor'::text)), block_number DESC) WHERE canonical;
CREATE INDEX auction_bidder_lookup ON public.collateral_repair_auction_events USING btree (chain_id, lower((event_data ->> 'bidder'::text)), block_number DESC) WHERE canonical;
CREATE INDEX amm_recipient_lookup ON public.amm_trade_events USING btree (chain_id, lower((event_data ->> 'recipient'::text)), block_number DESC) WHERE canonical;
CREATE INDEX escalation_claim_positions ON public.entity_state_snapshots USING gin ((((read_result -> 'claimEvidence'::text) -> 'positions'::text)) jsonb_path_ops) WHERE (canonical AND (entity_type = 'escalation'::text));
CREATE INDEX timeline_source_lookup ON public.protocol_timeline_entries USING btree (chain_id, source_contract, block_number DESC);
CREATE INDEX timeline_related_lookup ON public.protocol_timeline_entries USING gin (related_entities);
CREATE INDEX timeline_summary_search ON public.protocol_timeline_entries USING gin (((summary_data)::text) gin_trgm_ops);
CREATE INDEX timeline_identity_search ON public.protocol_timeline_entries USING gin (entity_identity gin_trgm_ops);
CREATE INDEX timeline_event_search ON public.protocol_timeline_entries USING gin (semantic_event_kind gin_trgm_ops);
CREATE INDEX timeline_source_search ON public.protocol_timeline_entries USING gin (source_contract gin_trgm_ops);
CREATE INDEX address_balances_asset_refresh ON public.address_balance_snapshots USING btree (chain_id, asset_address, block_number DESC) WHERE canonical;

CREATE TABLE public.address_catalog (
 chain_id bigint NOT NULL, address text NOT NULL,
 CONSTRAINT address_catalog_pkey PRIMARY KEY (chain_id, address)
);
CREATE TABLE public.address_balance_assets (
 chain_id bigint NOT NULL, address text NOT NULL, asset_address text NOT NULL,
 CONSTRAINT address_balance_assets_pkey PRIMARY KEY (chain_id, address, asset_address)
);
CREATE TABLE public.address_activity_summaries (
 chain_id bigint NOT NULL, address text NOT NULL, block_hash text NOT NULL, block_number bigint NOT NULL,
 first_seen_block bigint NOT NULL, transaction_count bigint NOT NULL, interaction_count bigint NOT NULL, pool_count bigint NOT NULL,
 canonical boolean DEFAULT true NOT NULL,
 CONSTRAINT address_activity_summaries_pkey PRIMARY KEY (chain_id, block_hash, address),
 CONSTRAINT address_activity_summaries_block_fkey FOREIGN KEY (chain_id, block_hash, block_number) REFERENCES public.blocks(chain_id, hash, number)
);
CREATE INDEX address_activity_summaries_latest ON public.address_activity_summaries USING btree (chain_id, address, block_number DESC) WHERE canonical;
CREATE INDEX address_activity_pool_membership ON public.address_activity USING btree (chain_id, address, pool_address, block_number) WHERE canonical;
CREATE TABLE public.protocol_entity_identities (
 chain_id bigint NOT NULL, domain text NOT NULL, identity text NOT NULL,
 block_hash text NOT NULL, block_number bigint NOT NULL, canonical boolean DEFAULT true NOT NULL,
 CONSTRAINT protocol_entity_identities_pkey PRIMARY KEY (chain_id, domain, identity, block_hash),
 CONSTRAINT protocol_entity_identities_block_fkey FOREIGN KEY (chain_id, block_hash, block_number) REFERENCES public.blocks(chain_id, hash, number)
);
CREATE UNIQUE INDEX protocol_entity_identities_current ON public.protocol_entity_identities USING btree (chain_id, domain, identity) WHERE canonical;
CREATE TABLE public.protocol_entity_totals (
 chain_id bigint NOT NULL, domain text NOT NULL, block_hash text NOT NULL, block_number bigint NOT NULL,
 total bigint NOT NULL, canonical boolean DEFAULT true NOT NULL,
 CONSTRAINT protocol_entity_totals_pkey PRIMARY KEY (chain_id, domain, block_hash),
 CONSTRAINT protocol_entity_totals_block_fkey FOREIGN KEY (chain_id, block_hash, block_number) REFERENCES public.blocks(chain_id, hash, number)
);
CREATE INDEX protocol_entity_totals_latest ON public.protocol_entity_totals USING btree (chain_id, domain, block_number DESC) WHERE canonical;
CREATE INDEX report_catalog_recent ON public.open_oracle_report_events USING btree (chain_id, block_number DESC, log_index DESC, tx_hash DESC) WHERE canonical;

INSERT INTO public.address_catalog SELECT DISTINCT chain_id,address FROM public.address_activity ON CONFLICT DO NOTHING;
INSERT INTO public.address_balance_assets SELECT DISTINCT chain_id,address,asset_address FROM public.address_balance_snapshots ON CONFLICT DO NOTHING;
WITH first_pools AS (
 SELECT chain_id,address,pool_address,min(block_number) AS first_block FROM public.address_activity
 WHERE canonical AND pool_address <> '0x0000000000000000000000000000000000000000' GROUP BY chain_id,address,pool_address
), pool_deltas AS (
 SELECT chain_id,address,first_block,count(*) AS added FROM first_pools GROUP BY chain_id,address,first_block
), deltas AS (
 SELECT activity.chain_id,activity.address,activity.block_hash,activity.block_number,
 count(DISTINCT activity.tx_hash) FILTER (WHERE activity.role='sender') AS transactions,
 count(DISTINCT activity.tx_hash) AS interactions,COALESCE(max(pool_deltas.added),0) AS pools
 FROM public.address_activity activity LEFT JOIN pool_deltas ON pool_deltas.chain_id=activity.chain_id AND pool_deltas.address=activity.address AND pool_deltas.first_block=activity.block_number
 WHERE activity.canonical GROUP BY activity.chain_id,activity.address,activity.block_hash,activity.block_number
)
INSERT INTO public.address_activity_summaries (chain_id,address,block_hash,block_number,first_seen_block,transaction_count,interaction_count,pool_count)
SELECT chain_id,address,block_hash,block_number,min(block_number) OVER w,sum(transactions) OVER w,sum(interactions) OVER w,sum(pools) OVER w
FROM deltas WINDOW w AS (PARTITION BY chain_id,address ORDER BY block_number ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW);
WITH entities AS (
 SELECT chain_id,'reports'::text AS domain,open_oracle_address||':'||report_id::text AS identity,block_hash,block_number FROM public.open_oracle_report_events WHERE canonical
 UNION ALL SELECT chain_id,'escalations',game_address,block_hash,block_number FROM public.escalation_game_events WHERE canonical
 UNION ALL SELECT chain_id,'auctions',auction_address,block_hash,block_number FROM public.collateral_repair_auction_events WHERE canonical
 UNION ALL SELECT chain_id,'pools',pool_address,block_hash,block_number FROM public.pools WHERE canonical
 UNION ALL SELECT chain_id,'markets',pair_address,block_hash,block_number FROM public.amm_markets WHERE canonical
)
INSERT INTO public.protocol_entity_identities (chain_id,domain,identity,block_hash,block_number)
SELECT DISTINCT ON (chain_id,domain,identity) chain_id,domain,identity,block_hash,block_number FROM entities ORDER BY chain_id,domain,identity,block_number;
INSERT INTO public.protocol_entity_totals (chain_id,domain,block_hash,block_number,total)
SELECT chain_id,domain,block_hash,block_number,sum(count(*)) OVER (PARTITION BY chain_id,domain ORDER BY block_number ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
FROM public.protocol_entity_identities WHERE canonical GROUP BY chain_id,domain,block_hash,block_number;
