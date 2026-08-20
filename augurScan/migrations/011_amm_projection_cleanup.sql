-- Migration 008 used the legacy `trading` timeline entity type, while later
-- projections use `amm`. Remove invalid derived rows under either taxonomy.
-- Raw logs and dedicated Uniswap observations remain the evidence source.
DELETE FROM amm_trade_events
WHERE (event_name = 'Swap' AND NOT (
	event_data ? 'yesForNo' AND event_data ? 'amountIn' AND event_data ? 'amountOut'
	AND event_data ? 'resultingYesReserve' AND event_data ? 'resultingNoReserve'
)) OR (event_name = 'Sync' AND NOT (event_data ? 'yesReserve' AND event_data ? 'noReserve'));

DELETE FROM protocol_timeline_entries
WHERE entity_type IN ('amm', 'trading') AND (
	(semantic_event_kind = 'Swap' AND NOT (
		summary_data ? 'yesForNo' AND summary_data ? 'amountIn' AND summary_data ? 'amountOut'
		AND summary_data ? 'resultingYesReserve' AND summary_data ? 'resultingNoReserve'
	)) OR (semantic_event_kind = 'Sync' AND NOT (summary_data ? 'yesReserve' AND summary_data ? 'noReserve'))
);
