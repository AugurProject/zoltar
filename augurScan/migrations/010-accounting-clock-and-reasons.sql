-- This clock measures fork-adjusted portfolio time, not a wall-clock instant.
-- Earlier versions encoded its integer seconds as a timestamp; preserve those exact seconds.
ALTER TABLE public.pool_snapshots
    ALTER COLUMN last_settlement_portfolio_time TYPE numeric(78,0)
    USING EXTRACT(EPOCH FROM last_settlement_portfolio_time)::numeric(78,0);

ALTER TABLE public.pool_snapshots
    ADD CONSTRAINT pool_snapshots_reason_check CHECK (((reason >= 0) AND (reason <= 2)));

ALTER TABLE public.pool_snapshots
    ADD CONSTRAINT pool_snapshots_portfolio_time_check CHECK ((last_settlement_portfolio_time >= (0)::numeric));
