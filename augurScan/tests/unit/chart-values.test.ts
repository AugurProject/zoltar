import { expect, test } from 'bun:test'
import { chartValueBounds, chartTokenValue, retentionChartBounds, uniswapLiquidityChartModel, uniswapPriceChartModel, uniswapPriceProvenance } from '../../browser/chart-values.ts'

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
		quote_decimals: 18,
		event_name: 'Swap',
		rep_per_eth_1e18: '19000000000000000000',
	}
	const model = uniswapLiquidityChartModel([
		{ ...common, venue: 'v2', market_id: '0xv2', event_name: 'Sync', liquidity_value: '900' },
		{ ...common, venue: 'v3', market_id: '0xv3', liquidity_value: '1200' },
	])
	expect(model.definitions.map(({ label, unit, decimals }) => ({ label, unit, decimals }))).toEqual([
		{ label: 'V2 · 0.3% · WETH · 0xv2 liquidity', unit: 'REP × WETH', decimals: 36 },
		{ label: 'V3 · 0.3% · WETH · 0xv3 liquidity', unit: '√(REP × WETH)', decimals: 18 },
	])
	expect(model.rows[0]).toMatchObject({ market_id: '0xv2', uniswap_liquidity_0: '900' })
	expect(model.rows[0]?.uniswap_liquidity_1).toBeUndefined()
	expect(model.rows[1]).toMatchObject({ market_id: '0xv3', uniswap_liquidity_1: '1200' })
	const v3Row = model.rows[1]
	if (v3Row === undefined) throw new Error('Expected a V3 liquidity row')
	expect(model.definitions[1]?.pointLabel(v3Row)).toContain('V3 Swap')
})

test('scales liquidity using both token decimals and preserves fractional token values', () => {
	const common = { timestamp: '2026-08-10T00:00:00.000Z', block_number: '12', contract_address: '0xcontract', fee_hundredths_bip: '500', event_name: 'Swap', rep_per_eth_1e18: '1000000000000000000' }
	for (const quote_decimals of [6, 18]) {
		for (const venue of ['v2', 'v3', 'v4']) {
			const decimals = venue === 'v2' ? 18 + quote_decimals : (18 + quote_decimals) / 2
			const raw = (125n * 10n ** BigInt(decimals - 2)).toString()
			const model = uniswapLiquidityChartModel([{ ...common, venue, market_id: '0xpool', quote_symbol: quote_decimals === 6 ? 'USDC' : 'WETH', quote_decimals, liquidity_value: raw }])
			expect(model.definitions[0]?.decimals).toBe(decimals)
			expect(model.rows[0]?.liquidity_value).toBe(raw)
			expect(chartTokenValue(raw, model.definitions[0]?.decimals)).toBeCloseTo(1.25)
		}
	}
	expect(chartTokenValue('1', 36)).toBe(1e-36)
	expect(chartTokenValue('125', 2)).toBe(1.25)
	expect(chartTokenValue('7', 0)).toBe(7)
})

test('does not guess liquidity units from a token symbol when decimals are missing', () => {
	const model = uniswapLiquidityChartModel([{ timestamp: '2026-08-10T00:00:00Z', block_number: '1', contract_address: '0xcontract', fee_hundredths_bip: '500', event_name: 'Swap', rep_per_eth_1e18: '1', venue: 'v3', market_id: '0xpool', quote_symbol: 'USDC', liquidity_value: '123' }])
	expect(model.rows).toEqual([])
	expect(model.unavailableCount).toBe(1)
})

test('keeps 36-decimal reserve products fractional instead of capping their scale at 18', () => {
	expect(chartTokenValue('1250000000000000000000000000000000000', 36)).toBeCloseTo(1.25)
})

test('anchors stock and balance charts at zero without imposing an arbitrary maximum', () => {
	expect(chartValueBounds([100, 120], undefined, true)).toEqual({ minimum: 0, maximum: 120 })
	expect(chartValueBounds([0], undefined, true)).toEqual({ minimum: 0, maximum: 1 })
	expect(chartValueBounds([100], undefined, true)).toEqual({ minimum: 0, maximum: 100 })
	expect(chartValueBounds([-1, 20], undefined, true)).toEqual({ minimum: -1, maximum: 20 })
	expect(chartValueBounds([48, 52], [0, 100], true)).toEqual({ minimum: 0, maximum: 100 })
})

test('uses the protocol retention limits and expands for out-of-range evidence without clipping it', () => {
	const limits = [0.99999997788, 0.999999996848] as const
	expect(retentionChartBounds([])).toEqual({ sharedRange: limits, expanded: false })
	expect(retentionChartBounds([undefined, null, '', 'invalid', '999999987000000000'])).toEqual({ sharedRange: limits, expanded: false })
	expect(retentionChartBounds(['999999977880000000', '999999996848000000'])).toEqual({ sharedRange: limits, expanded: false })
	expect(retentionChartBounds(['1000000000000000000'])).toEqual({ sharedRange: [limits[0], 1], expanded: true })
	expect(retentionChartBounds(['999999700000000000'])).toEqual({ sharedRange: [0.9999997, limits[1]], expanded: true })
})
