import { expect, test } from 'bun:test'
import { chartValueBounds, uniswapLiquidityChartModel, uniswapPriceChartModel, uniswapPriceProvenance } from '../browser/chart-values.ts'

test('uses consistent nonnegative bounds for an all-zero price series', () => {
	expect(chartValueBounds([0], undefined)).toEqual({ minimum: 0, maximum: 1 })
})

test('centers lone and repeated nonzero prices inside padded bounds', () => {
	for (const values of [[18.25], [18.25, 18.25, 18.25]]) {
		const bounds = chartValueBounds(values, undefined)
		expect(bounds.minimum).toBeCloseTo(17.3375)
		expect(bounds.maximum).toBeCloseTo(19.1625)
		expect((18.25 - bounds.minimum) / (bounds.maximum - bounds.minimum)).toBeCloseTo(0.5)
	}
})

test('keeps relative padding nonnegative for the smallest 18-decimal price', () => {
	const value = 1e-18
	const bounds = chartValueBounds([value], undefined)
	expect(bounds.minimum).toBeCloseTo(value * 0.95, 30)
	expect(bounds.maximum).toBeCloseTo(value * 1.05, 30)
	expect(bounds.minimum).toBeGreaterThanOrEqual(0)
	expect((value - bounds.minimum) / (bounds.maximum - bounds.minimum)).toBeCloseTo(0.5)
})

test('preserves explicit and naturally varying chart bounds', () => {
	expect(chartValueBounds([48, 52], [0, 100])).toEqual({ minimum: 0, maximum: 100 })
	expect(chartValueBounds([18, 20], undefined)).toEqual({ minimum: 18, maximum: 20 })
})

test('keeps each Uniswap pool as a provenance-preserving sparse series on one value scale', () => {
	const model = uniswapPriceChartModel([
		{
			timestamp: '2026-08-10T00:00:00.000Z',
			block_number: '12',
			venue: 'v3',
			market_id: '0xpool-b',
			contract_address: '0xcontract-b',
			fee_hundredths_bip: '3000',
			quote_symbol: 'WETH',
			event_name: 'Swap',
			rep_per_eth_1e18: '19000000000000000000',
		},
		{
			timestamp: '2026-08-09T00:00:00.000Z',
			block_number: '11',
			venue: 'v2',
			market_id: '0xpool-a',
			contract_address: '0xcontract-a',
			fee_hundredths_bip: '3000',
			quote_symbol: 'WETH',
			event_name: 'Sync',
			rep_per_eth_1e18: '18000000000000000000',
		},
	])

	expect(model.definitions.map(({ label }) => label)).toEqual(['Uniswap V2 · 0.3% · WETH · 0xpool-a', 'Uniswap V3 · 0.3% · WETH · 0xpool-b'])
	const firstRow = model.rows[0]
	const secondRow = model.rows[1]
	if (firstRow === undefined || secondRow === undefined || model.latestObservation === undefined) throw new Error('Expected two chart rows')
	expect(firstRow).toMatchObject({ market_id: '0xpool-a', uniswap_price_0: '18000000000000000000' })
	expect(firstRow.uniswap_price_1).toBeUndefined()
	expect(secondRow).toMatchObject({ market_id: '0xpool-b', uniswap_price_1: '19000000000000000000' })
	expect(model.sharedRange).toEqual([18, 19])
	expect(model.latestObservation).toMatchObject({ market_id: '0xpool-b', rep_per_eth_1e18: '19000000000000000000' })
	expect(uniswapPriceProvenance(model.latestObservation)).toBe('V3 · 0.3% · WETH · 0xpool-b')
})

test('does not put unlike ETH and USDC quote units on one numeric axis', () => {
	const common = {
		timestamp: '2026-08-10T00:00:00.000Z',
		block_number: '12',
		venue: 'v3',
		contract_address: '0xcontract',
		fee_hundredths_bip: '500',
		event_name: 'Swap',
	}
	const model = uniswapPriceChartModel([
		{ ...common, market_id: '0xeth', quote_symbol: 'WETH', rep_per_eth_1e18: '19000000000000000000' },
		{ ...common, market_id: '0xusd', quote_symbol: 'USDC', rep_per_eth_1e18: '4200000000000000' },
	])
	expect(model.sharedRange).toBeUndefined()
})

test('keeps incompatible Uniswap liquidity measures in provenance-labeled sparse series', () => {
	const common = {
		timestamp: '2026-08-10T00:00:00.000Z',
		block_number: '12',
		contract_address: '0xcontract',
		fee_hundredths_bip: '3000',
		quote_symbol: 'WETH',
		event_name: 'Swap',
		rep_per_eth_1e18: '19000000000000000000',
	}
	const model = uniswapLiquidityChartModel([
		{ ...common, venue: 'v2', market_id: '0xv2', event_name: 'Sync', liquidity_value: '900' },
		{ ...common, venue: 'v3', market_id: '0xv3', liquidity_value: '1200' },
	])
	expect(model.definitions.map(({ label, unit, decimals }) => ({ label, unit, decimals }))).toEqual([
		{ label: 'V2 · 0.3% · WETH · 0xv2 liquidity', unit: 'reserve product', decimals: 0 },
		{ label: 'V3 · 0.3% · WETH · 0xv3 liquidity', unit: 'active liquidity', decimals: 0 },
	])
	expect(model.rows[0]).toMatchObject({ market_id: '0xv2', uniswap_liquidity_0: '900' })
	expect(model.rows[0]?.uniswap_liquidity_1).toBeUndefined()
	expect(model.rows[1]).toMatchObject({ market_id: '0xv3', uniswap_liquidity_1: '1200' })
	const v3Row = model.rows[1]
	if (v3Row === undefined) throw new Error('Expected a V3 liquidity row')
	expect(model.definitions[1]?.pointLabel(v3Row)).toContain('V3 Swap')
})
