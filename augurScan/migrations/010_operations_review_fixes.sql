-- Liquidation approval state is separate from liquidation execution. Preserve
-- every transition so risk pages can explain authorization, reservation, use,
-- release, revocation, and nonce invalidation from canonical evidence.
CREATE TABLE IF NOT EXISTS liquidation_approval_events (
	chain_id bigint NOT NULL,
	block_hash text NOT NULL,
	tx_hash text NOT NULL,
	transaction_index integer NOT NULL,
	log_index integer NOT NULL,
	block_number bigint NOT NULL,
	registry_address text NOT NULL,
	approval_identity text NOT NULL,
	receiver_vault text,
	event_name text NOT NULL,
	event_data jsonb NOT NULL,
	canonical boolean NOT NULL DEFAULT true,
	observed_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (chain_id, block_hash, tx_hash, log_index, registry_address),
	FOREIGN KEY (chain_id, block_hash, tx_hash, log_index) REFERENCES logs(chain_id, block_hash, tx_hash, log_index)
);

CREATE INDEX IF NOT EXISTS liquidation_approval_identity_page
	ON liquidation_approval_events(chain_id, approval_identity, block_number DESC, transaction_index DESC, log_index DESC)
	WHERE canonical;
CREATE INDEX IF NOT EXISTS liquidation_approval_vault_page
	ON liquidation_approval_events(chain_id, receiver_vault, block_number DESC, transaction_index DESC, log_index DESC)
	WHERE canonical;

INSERT INTO liquidation_approval_events (
	chain_id, block_hash, tx_hash, transaction_index, log_index, block_number, registry_address,
	approval_identity, receiver_vault, event_name, event_data, canonical
)
SELECT chain_id, block_hash, tx_hash, transaction_index, log_index, block_number, emitter_address,
	COALESCE(arguments->>'approvalId', 'nonce:' || COALESCE(arguments->>'receiverVault', 'unknown')),
	arguments->>'receiverVault', event_name, arguments, canonical
FROM logs
WHERE decode_status = 'decoded' AND event_name IN (
	'LiquidationApprovalSet', 'LiquidationApprovalReserved', 'LiquidationApprovalReleased',
	'LiquidationApprovalConsumed', 'LiquidationApprovalRevoked', 'LiquidationApprovalNonceInvalidated'
)
ON CONFLICT (chain_id, block_hash, tx_hash, log_index, registry_address) DO UPDATE
SET canonical = EXCLUDED.canonical, event_data = EXCLUDED.event_data;

INSERT INTO protocol_timeline_entries (
	chain_id, block_hash, tx_hash, log_index, block_number, entity_type, entity_identity,
	semantic_event_kind, summary_data, related_entities, source_contract, source_event, canonical
)
SELECT chain_id, block_hash, tx_hash, log_index, block_number, 'liquidation-approval',
	emitter_address || ':' || COALESCE(arguments->>'approvalId', 'nonce:' || COALESCE(arguments->>'receiverVault', 'unknown')),
	event_name, arguments,
	to_jsonb(array_remove(ARRAY[arguments->>'receiverVault', arguments->>'operator', arguments->>'securityPool', arguments->>'targetVault'], NULL)),
	emitter_address, event_name, canonical
FROM logs
WHERE decode_status = 'decoded' AND event_name IN (
	'LiquidationApprovalSet', 'LiquidationApprovalReserved', 'LiquidationApprovalReleased',
	'LiquidationApprovalConsumed', 'LiquidationApprovalRevoked', 'LiquidationApprovalNonceInvalidated'
)
ON CONFLICT (chain_id, block_hash, tx_hash, log_index, entity_type, entity_identity) DO UPDATE
SET canonical = EXCLUDED.canonical, summary_data = EXCLUDED.summary_data, related_entities = EXCLUDED.related_entities;

-- Event names overlap across AMM families. Rows lacking Augur reserve evidence
-- were produced by the former event-name-only classifier and are not usable as
-- two-way-pair trades.
DELETE FROM amm_trade_events
WHERE event_name = 'Swap' AND NOT (
	event_data ? 'yesForNo' AND event_data ? 'amountIn' AND event_data ? 'amountOut'
	AND event_data ? 'resultingYesReserve' AND event_data ? 'resultingNoReserve'
);
DELETE FROM protocol_timeline_entries
WHERE entity_type = 'amm' AND semantic_event_kind = 'Swap' AND NOT (
	summary_data ? 'yesForNo' AND summary_data ? 'amountIn' AND summary_data ? 'amountOut'
	AND summary_data ? 'resultingYesReserve' AND summary_data ? 'resultingNoReserve'
);
