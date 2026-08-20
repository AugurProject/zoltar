-- Migration 008 used broad legacy timeline entity types. Migration 009
-- reprojects those logs under their stable domain identities, whose primary key
-- intentionally differs by entity type. Remove the superseded copies so an
-- upgrade retains one semantic timeline row per intended entity.
DELETE FROM protocol_timeline_entries WHERE entity_type IN ('trading', 'risk');

-- EVM log indexes are block-global execution order. Transaction hashes are only
-- deterministic tie-breakers and must not order transitions within one block.
DROP INDEX IF EXISTS open_oracle_report_round_page;
DROP INDEX IF EXISTS escalation_game_event_page;
DROP INDEX IF EXISTS truth_auction_event_page;
DROP INDEX IF EXISTS amm_trade_interval;
DROP INDEX IF EXISTS fork_migration_page;
DROP INDEX IF EXISTS protocol_timeline_page;

CREATE INDEX open_oracle_report_round_page
	ON open_oracle_report_events(chain_id, open_oracle_address, report_id, block_number DESC, log_index DESC, tx_hash DESC)
	WHERE canonical;

CREATE INDEX escalation_game_event_page
	ON escalation_game_events(chain_id, game_address, block_number DESC, log_index DESC, tx_hash DESC)
	WHERE canonical;

CREATE INDEX truth_auction_event_page
	ON truth_auction_events(chain_id, auction_address, block_number DESC, log_index DESC, tx_hash DESC)
	WHERE canonical;

CREATE INDEX amm_trade_interval
	ON amm_trade_events(chain_id, market_address, block_number, log_index, tx_hash)
	WHERE canonical;

CREATE INDEX fork_migration_page
	ON fork_migration_events(chain_id, universe_identity, block_number DESC, log_index DESC, tx_hash DESC)
	WHERE canonical;

CREATE INDEX protocol_timeline_page
	ON protocol_timeline_entries(chain_id, entity_type, entity_identity, block_number DESC, log_index DESC, tx_hash DESC)
	WHERE canonical;
