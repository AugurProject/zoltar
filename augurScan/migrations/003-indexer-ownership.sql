CREATE TABLE public.indexer_ownership (
    chain_id bigint NOT NULL,
    network_id text NOT NULL,
    state text NOT NULL,
    backend_pid integer,
    owner_run_id bigint,
    heartbeat_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT indexer_ownership_pkey PRIMARY KEY (chain_id),
    CONSTRAINT indexer_ownership_chain_id_fkey FOREIGN KEY (chain_id) REFERENCES public.networks(chain_id) ON DELETE CASCADE,
    CONSTRAINT indexer_ownership_owner_run_fkey FOREIGN KEY (owner_run_id) REFERENCES public.indexer_runs(id),
    CONSTRAINT indexer_ownership_state_check CHECK (state = ANY (ARRAY['owned'::text, 'standby'::text, 'released'::text, 'release-failed'::text, 'unknown'::text]))
);

CREATE INDEX indexer_ownership_heartbeat
    ON public.indexer_ownership USING btree (heartbeat_at DESC, chain_id);
