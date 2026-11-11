-- Rename existing storage in place: auction history, canonical flags and pool bindings survive.
ALTER TABLE public.truth_auction_events RENAME TO collateral_repair_auction_events;
ALTER TABLE public.pools RENAME COLUMN truth_auction_address TO collateral_repair_auction_address;
ALTER TABLE public.collateral_repair_auction_events
    RENAME CONSTRAINT truth_auction_events_pkey TO collateral_repair_auction_events_pkey;
ALTER TABLE public.collateral_repair_auction_events
    RENAME CONSTRAINT truth_auction_events_chain_id_block_hash_tx_hash_log_index_fkey
    TO collateral_repair_auction_events_log_fkey;
ALTER INDEX public.truth_auction_event_page RENAME TO collateral_repair_auction_event_page;
ALTER INDEX public.truth_auctions_current RENAME TO collateral_repair_auctions_current;
