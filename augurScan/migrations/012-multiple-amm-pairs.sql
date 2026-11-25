DROP INDEX public.amm_markets_canonical_pool;
CREATE INDEX amm_markets_canonical_pool ON public.amm_markets USING btree (chain_id, pool_address) WHERE canonical;
