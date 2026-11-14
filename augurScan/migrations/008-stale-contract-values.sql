-- No contract emits RepEthPriceSet, so a coordinator price is always an accepted PriceReported settlement
-- that carries its report and settlement time. Rows projected from the removed seed event are discarded.
DELETE FROM public.rep_eth_price_snapshots WHERE event_name <> 'PriceReported';

ALTER TABLE public.rep_eth_price_snapshots DROP CONSTRAINT rep_eth_price_snapshots_event_name_check;

ALTER TABLE public.rep_eth_price_snapshots
    ADD CONSTRAINT rep_eth_price_snapshots_event_name_check CHECK ((event_name = 'PriceReported'::text));

ALTER TABLE public.rep_eth_price_snapshots ALTER COLUMN report_id SET NOT NULL;

ALTER TABLE public.rep_eth_price_snapshots ALTER COLUMN settlement_timestamp SET NOT NULL;

-- Every pool is deployed without a collateral repair auction, with a zero retention rate and with no
-- settlement collateral, so these columns only ever held those constants.
ALTER TABLE public.pools DROP COLUMN collateral_repair_auction_address;

ALTER TABLE public.pools DROP COLUMN initial_retention_rate;

ALTER TABLE public.pools DROP COLUMN initial_settlement_collateral_atto_eth;
