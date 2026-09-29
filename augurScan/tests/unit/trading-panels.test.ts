import { expect, test } from 'bun:test'
import { tradingActivitySummary, tradingActivityTitle, tradingPnlHoldings, tradingPnlSummary } from '../../browser/trading-panels.ts'

test('labels trading activity by kind, side, and ETH direction', () => {
	const enter = { kind: 'enter', side: 'YES', shares: '16000000000000000000', eth_in_atto_eth: '10000000000000000000', eth_out_atto_eth: '0', timestamp_seconds: '1767225600' }
	expect(tradingActivityTitle(enter)).toBe('Enter YES')
	expect(tradingActivitySummary(enter)).toBe('16 YES shares · 10 ETH paid · 2026-01-01 00:00:00 UTC')
	const exit = { kind: 'exit', side: 'NO', shares: '1', eth_in_atto_eth: '0', eth_out_atto_eth: '500000000000000000' }
	expect(tradingActivitySummary(exit)).toBe('0.000000000000000001 NO shares · 0.5 ETH received')
	expect(tradingActivityTitle({ kind: 'swap', side: 'NO' })).toBe('Swap for NO')
	expect(tradingActivitySummary({ kind: 'swap', side: 'NO', shares: '2000000000000000000', eth_in_atto_eth: null, eth_out_atto_eth: null })).toBe('2 NO shares · No ETH moved')
	expect(tradingActivitySummary({ kind: 'remove-liquidity', side: null, shares: '3000000000000000000' })).toBe('3 LP tokens · No ETH moved')
	expect(tradingActivityTitle({ kind: 'settlement', side: null })).toBe('Settlement redemption')
})

test('summarizes profit and loss with signed results and unavailable valuations', () => {
	expect(
		tradingPnlSummary({
			cost_basis_atto_eth: '10000000000000000000',
			proceeds_atto_eth: '4000000000000000000',
			holdings_value_atto_eth: '2000000000000000000',
			realized_pnl_atto_eth: '0',
			unrealized_pnl_atto_eth: '-4000000000000000000',
			net_pnl_atto_eth: '-4000000000000000000',
			valuation: { status: 'available' },
		}),
	).toBe('10 ETH paid in · 4 ETH received · 2 ETH exit value · realized 0 ETH · unrealized -4 ETH · net -4 ETH')
	expect(tradingPnlSummary({ cost_basis_atto_eth: '1', proceeds_atto_eth: '3', realized_pnl_atto_eth: '2', valuation: { status: 'unavailable', reason: 'No indexed complete-set exchange rate for this pool' } })).toContain(
		'holdings value unavailable (no indexed complete-set exchange rate for this pool) · realized +0.000000000000000002 ETH · unrealized unavailable',
	)
	expect(tradingPnlSummary({ cost_basis_atto_eth: '0', proceeds_atto_eth: '0', holdings_value_atto_eth: '0', realized_pnl_atto_eth: '0', unrealized_pnl_atto_eth: '0', net_pnl_atto_eth: '0', valuation: { status: 'available', partial: true } })).toContain('0 ETH exit value (partial, some shares unvalued)')
	expect(tradingPnlHoldings({ open: false })).toBe('Closed position')
	expect(tradingPnlHoldings({ open: true, invalid_atto_shares: '1000000000000000000', yes_atto_shares: '0', no_atto_shares: '0', lp_tokens: '0' })).toBe('Open · 1 INVALID · 0 YES · 0 NO · 0 LP tokens')
})
