import { expect, test } from 'bun:test'
import { sharePositionSummary, tradingActivitySummary, tradingActivityTitle, tradingPnlHoldings, tradingPnlSummary } from '../../browser/trading-panels.ts'

test('labels trading activity by kind, side, and ETH direction', () => {
	const enter = { collateral: { symbol: 'ETH', decimals: 18 }, kind: 'enter', side: 'YES', shares: '16000000000000000000', eth_in_atto_eth: '10000000000000000000', eth_out_atto_eth: '0', timestamp_seconds: '1767225600' }
	expect(tradingActivityTitle(enter)).toBe('Enter YES')
	expect(tradingActivitySummary(enter, 'ETH')).toBe('16 YES shares · 10 ETH paid · 2026-01-01 00:00:00 UTC')
	const exit = { collateral: { symbol: 'ETH', decimals: 18 }, kind: 'exit', side: 'NO', shares: '1', eth_in_atto_eth: '0', eth_out_atto_eth: '500000000000000000' }
	expect(tradingActivitySummary(exit, 'ETH')).toBe('0.000000000000000001 NO shares · 0.5 ETH received')
	expect(tradingActivityTitle({ kind: 'swap', side: 'NO' })).toBe('Swap for NO')
	expect(tradingActivitySummary({ collateral: { symbol: 'ETH', decimals: 18 }, kind: 'swap', side: 'NO', shares: '2000000000000000000', eth_in_atto_eth: null, eth_out_atto_eth: null }, 'ETH')).toBe('2 NO shares · No ETH moved')
	expect(tradingActivitySummary({ collateral: { symbol: 'SepoliaETH', decimals: 18 }, kind: 'remove-liquidity', side: null, shares: '3000000000000000000' }, 'SepoliaETH')).toBe('3 LP tokens · No SepoliaETH moved')
	expect(tradingActivityTitle({ kind: 'settlement', side: null })).toBe('Settlement redemption')
})

test('share positions use the collateral token precision, not 18 decimals', () => {
	const position = { invalid_atto_shares: '0', yes_atto_shares: '1000000', no_atto_shares: '2500000', complete_sets_atto_shares: '0', migration_locked: false }
	expect(sharePositionSummary({ ...position, collateral: { symbol: 'USDC', decimals: 6 } })).toBe('0 INVALID · 1 YES · 2.5 NO · 0 complete sets')
	// Without sampled collateral metadata the shares stay in raw units.
	expect(sharePositionSummary(position)).toBe('0 INVALID · 1,000,000 YES · 2,500,000 NO · 0 complete sets')
})

test('summarizes profit and loss with signed results and unavailable valuations', () => {
	expect(
		tradingPnlSummary(
			{
				collateral: { symbol: 'ETH', decimals: 18 },
				cost_basis_atto_eth: '10000000000000000000',
				proceeds_atto_eth: '4000000000000000000',
				holdings_value_atto_eth: '2000000000000000000',
				realized_pnl_atto_eth: '0',
				unrealized_pnl_atto_eth: '-4000000000000000000',
				net_pnl_atto_eth: '-4000000000000000000',
				valuation: { status: 'available' },
			},
			'ETH',
		),
	).toBe('10 ETH paid in · 4 ETH received · 2 ETH exit value · realized 0 ETH · unrealized -4 ETH · net -4 ETH')
	expect(tradingPnlSummary({ collateral: { symbol: 'ETH', decimals: 18 }, cost_basis_atto_eth: '1', proceeds_atto_eth: '3', realized_pnl_atto_eth: '2', valuation: { status: 'unavailable', reason: 'No indexed complete-set exchange rate for this pool' } }, 'ETH')).toContain(
		'holdings value unavailable (no indexed complete-set exchange rate for this pool) · realized +0.000000000000000002 ETH · unrealized unavailable',
	)
	expect(tradingPnlSummary({ collateral: { symbol: 'SepoliaETH', decimals: 18 }, cost_basis_atto_eth: '0', proceeds_atto_eth: '0', holdings_value_atto_eth: '0', realized_pnl_atto_eth: '0', unrealized_pnl_atto_eth: '0', net_pnl_atto_eth: '0', valuation: { status: 'available', partial: true } }, 'SepoliaETH')).toContain(
		'0 SepoliaETH exit value (partial, some shares unvalued)',
	)
	expect(tradingPnlSummary({ collateral: { symbol: 'USDC', decimals: 6 }, known_cost_atto_eth: '1500000', cost_basis_status: 'unknown', proceeds_atto_eth: '0', holdings_value_atto_eth: '2000000', valuation: { status: 'available', method: 'winning-share-settlement' } }, 'ETH')).toBe(
		'Unknown cost basis (1.5 USDC indexed payments) · 0 USDC received · 2 USDC settlement value · Profit unavailable',
	)
	expect(tradingPnlHoldings({ open: false })).toBe('Closed position')
	expect(tradingPnlHoldings({ collateral: { symbol: 'ETH', decimals: 18 }, open: true, invalid_atto_shares: '1000000000000000000', yes_atto_shares: '0', no_atto_shares: '0', lp_tokens: '0' })).toBe('Open · 1 INVALID · 0 YES · 0 NO · 0 LP tokens')
})

test('shows the assets delivered by the router, including REP-only receipts', () => {
	const receipt = { kind: 'exit', side: 'YES', shares: '1000000000000000000', collateral: { symbol: 'WETH', decimals: 18 }, native_collateral: true, recovery_rep_atto_rep: '1000000000000000000' }
	expect(tradingActivitySummary({ ...receipt, eth_out_atto_eth: '0' }, 'ETH')).toBe('1 YES shares · 1 REP received')
	expect(tradingActivitySummary({ ...receipt, eth_out_atto_eth: '2000000000000000000' }, 'ETH')).toBe('1 YES shares · 2 ETH received · 1 REP received')
	expect(tradingActivitySummary({ ...receipt, native_collateral: false, kind: 'settlement', side: null, eth_out_atto_eth: '2000000000000000000' }, 'ETH')).toBe('1 winning shares · 2 WETH received · 1 REP received')
})
