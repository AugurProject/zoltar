import type { ScannerDatabase } from '../../src/database.ts'

// Model the physical v5 layout without changing any auction or pool rows.
export const rewindAuctionNamingToV5 = async (database: ScannerDatabase): Promise<void> => {
	await database.sql.unsafe(`
		ALTER TABLE public.collateral_repair_auction_events RENAME TO truth_auction_events;
		ALTER TABLE public.pools RENAME COLUMN collateral_repair_auction_address TO truth_auction_address;
		ALTER TABLE public.truth_auction_events RENAME CONSTRAINT collateral_repair_auction_events_pkey TO truth_auction_events_pkey;
		ALTER TABLE public.truth_auction_events RENAME CONSTRAINT collateral_repair_auction_events_log_fkey TO truth_auction_events_chain_id_block_hash_tx_hash_log_index_fkey;
		ALTER INDEX public.collateral_repair_auction_event_page RENAME TO truth_auction_event_page;
		ALTER INDEX public.collateral_repair_auctions_current RENAME TO truth_auctions_current;
	`)
}
