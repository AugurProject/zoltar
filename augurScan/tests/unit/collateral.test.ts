import { expect, test } from 'bun:test'
import { collateralUnit } from '../../src/collateral.ts'
import { poolSummaryMetrics } from '../../browser/pool-metrics.ts'
import { tradingActivitySummary, tradingPnlSummary } from '../../browser/trading-panels.ts'

for (const symbol of ['USDC', 'USDT']) {
	test(`${symbol} collateral amounts keep six decimal places across explorer pool and trading views`, () => {
		const collateral = { address: '0x1111111111111111111111111111111111111111', symbol, decimals: 6 }
		expect(poolSummaryMetrics({ collateral, questionSettlementAttoEth: String(1_000_000n) })).toContainEqual(['Question settlement value', `1 ${symbol}`])
		expect(tradingActivitySummary({ collateral, eth_in_atto_eth: '1250000', shares: '1000000000000000000' }, 'ETH')).toContain(`1.25 ${symbol} paid`)
		expect(tradingPnlSummary({ collateral, cost_basis_atto_eth: '1000000', proceeds_atto_eth: '1500000', realized_pnl_atto_eth: '500000', unrealized_pnl_atto_eth: '0', net_pnl_atto_eth: '500000', valuation: { status: 'available' } }, 'ETH')).toContain(`+0.5 ${symbol}`)
	})
}

test('missing collateral metadata uses labelled raw units instead of assuming ETH', () => {
	expect(collateralUnit({})).toEqual({ symbol: 'collateral units', decimals: 0 })
	expect(poolSummaryMetrics({ questionSettlementAttoEth: String(1_000_000n) })).toContainEqual(['Question settlement value', '1,000,000 collateral units'])
})
