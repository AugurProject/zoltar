import type { ScannerDatabase } from '../../src/database.ts'
import { POOL_SNAPSHOTS_BEFORE_SCHEMA_7, TABLES_REMOVED_IN_SCHEMA_7 } from '../../src/schema-removed-tables.ts'

// Model the physical v7 layout without losing pool or price rows: the constant pool deployment columns and
// the coordinator seed price shape that migration 008 removed.
export const rewindStaleContractValuesToV7 = async (database: ScannerDatabase): Promise<void> => {
	await database.sql.unsafe(`
		ALTER TABLE public.pools ADD COLUMN collateral_repair_auction_address text DEFAULT '0x0000000000000000000000000000000000000000' NOT NULL;
		ALTER TABLE public.pools ALTER COLUMN collateral_repair_auction_address DROP DEFAULT;
		ALTER TABLE public.pools ADD COLUMN initial_retention_rate numeric(78,0) DEFAULT 0 NOT NULL;
		ALTER TABLE public.pools ALTER COLUMN initial_retention_rate DROP DEFAULT;
		ALTER TABLE public.pools ADD COLUMN initial_settlement_collateral_atto_eth numeric(78,0) DEFAULT 0 NOT NULL;
		ALTER TABLE public.pools ALTER COLUMN initial_settlement_collateral_atto_eth DROP DEFAULT;
		ALTER TABLE public.rep_eth_price_snapshots DROP CONSTRAINT rep_eth_price_snapshots_event_name_check;
		ALTER TABLE public.rep_eth_price_snapshots ADD CONSTRAINT rep_eth_price_snapshots_event_name_check CHECK ((event_name = ANY (ARRAY['RepEthPriceSet'::text, 'PriceReported'::text])));
		ALTER TABLE public.rep_eth_price_snapshots ALTER COLUMN report_id DROP NOT NULL;
		ALTER TABLE public.rep_eth_price_snapshots ALTER COLUMN settlement_timestamp DROP NOT NULL;
	`)
}

// Model the physical v6 layout: the accounting tables that migration 007 replaced. A v6 database also predates migration 008.
export const rewindAccountingStorageToV6 = async (database: ScannerDatabase): Promise<void> => {
	await rewindStaleContractValuesToV7(database)
	await database.sql.unsafe(`
		DROP TABLE public.pool_snapshots;
		${POOL_SNAPSHOTS_BEFORE_SCHEMA_7}
		ALTER TABLE ONLY public.pool_snapshots ADD CONSTRAINT pool_snapshots_pkey PRIMARY KEY (chain_id, block_hash, tx_hash, log_index, pool_address);
		ALTER TABLE ONLY public.pool_snapshots ADD CONSTRAINT pool_snapshots_chain_id_block_hash_tx_hash_log_index_fkey FOREIGN KEY (chain_id, block_hash, tx_hash, log_index) REFERENCES public.logs(chain_id, block_hash, tx_hash, log_index);
		CREATE INDEX pool_snapshots_history ON public.pool_snapshots USING btree (chain_id, pool_address, block_number DESC, log_index DESC) WHERE canonical;
		CREATE INDEX pool_snapshots_detail_page ON public.pool_snapshots USING btree (chain_id, pool_address, block_number DESC, log_index DESC, tx_hash DESC, block_hash DESC) WHERE canonical;
		${TABLES_REMOVED_IN_SCHEMA_7}
	`)
}

// Model the physical v5 layout without changing any auction or pool rows. A v5 database also predates migration 007.
export const rewindAuctionNamingToV5 = async (database: ScannerDatabase): Promise<void> => {
	await rewindAccountingStorageToV6(database)
	await database.sql.unsafe(`
		ALTER TABLE public.collateral_repair_auction_events RENAME TO truth_auction_events;
		ALTER TABLE public.pools RENAME COLUMN collateral_repair_auction_address TO truth_auction_address;
		ALTER TABLE public.truth_auction_events RENAME CONSTRAINT collateral_repair_auction_events_pkey TO truth_auction_events_pkey;
		ALTER TABLE public.truth_auction_events RENAME CONSTRAINT collateral_repair_auction_events_log_fkey TO truth_auction_events_chain_id_block_hash_tx_hash_log_index_fkey;
		ALTER INDEX public.collateral_repair_auction_event_page RENAME TO truth_auction_event_page;
		ALTER INDEX public.collateral_repair_auctions_current RENAME TO truth_auctions_current;
	`)
}
