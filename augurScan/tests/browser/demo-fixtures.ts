import type { UniswapPriceObservation } from '../../browser/chart-values.ts'

import type { AmmPriceHistoryRecord, RepEthPriceHistoryRecord } from '../../browser/browser-types.ts'

interface DemoUniswapMarket {
	venue: 'v2' | 'v3' | 'v4'
	fee: string
	quote?: 'ETH' | 'USDC' | 'WETH'
}

const demoRepEthValues = ['18250000000000000000', '17980000000000000000', '18420000000000000000', '19110000000000000000', '18860000000000000000', '19640000000000000000']

export const demoAmmPriceHistory = (now = Date.now()): AmmPriceHistoryRecord[] =>
	Array.from({ length: 12 }, (_, index) => {
		const yesReserveAttoShares = BigInt(210 + index * 7) * 10n ** 18n
		const noReserveAttoShares = BigInt(196 + index * 11) * 10n ** 18n
		const conditionalYesBps = (noReserveAttoShares * 10_000n) / (yesReserveAttoShares + noReserveAttoShares)
		return {
			timestamp: new Date(now - (11 - index) * 4 * 86_400_000).toISOString(),
			block_number: String(23_120_000 + index * 5_800),
			conditional_yes_bps: conditionalYesBps.toString(),
			conditional_no_bps: (10_000n - conditionalYesBps).toString(),
			yes_reserve_atto_shares: yesReserveAttoShares.toString(),
			no_reserve_atto_shares: noReserveAttoShares.toString(),
		}
	})

export const demoRepEthPriceHistory = (now = Date.now()): RepEthPriceHistoryRecord[] =>
	demoRepEthValues.map((value, index) => {
		const timestamp = new Date(now - (demoRepEthValues.length - 1 - index) * 9 * 86_400_000).toISOString()
		return {
			timestamp,
			settlement_timestamp: index === 0 ? null : timestamp,
			block_number: String(23_100_000 + index * 13_200),
			event_name: index === 0 ? 'RepEthPriceSet' : 'PriceReported',
			report_id: index === 0 ? null : String(1_830 + index),
			rep_per_eth_1e18: value,
		}
	})

const demoPriceEventName = (index: number, venue: string) => {
	if (venue === 'v2') return 'Sync'
	return index === 0 ? 'Initialize' : 'Swap'
}

const demoLiquidityValue = (venue: string, quote: string | undefined, index: number): string => {
	const quoteDecimals = quote === 'USDC' ? 6 : 18
	const decimals = venue === 'v2' ? 18 + quoteDecimals : (18 + quoteDecimals) / 2
	return ((100n + BigInt(index)) * 10n ** BigInt(decimals)).toString()
}

const demoUniswapHistory = (markets: readonly DemoUniswapMarket[], now: number): UniswapPriceObservation[] =>
	markets.flatMap(({ venue, fee, quote }, venueIndex) =>
		demoRepEthValues.slice(1).map((value, index) => ({
			timestamp: new Date(now - (4 - index) * 8 * 86_400_000 + venueIndex * 9_000_000).toISOString(),
			block_number: String(23_110_000 + index * 12_000 + venueIndex * 120),
			venue,
			market_id: venue === 'v4' ? `0x${(venueIndex + 7).toString(16).repeat(64)}` : `0x${(venueIndex + 7).toString(16).repeat(40)}`,
			contract_address: `0x${(venueIndex + 4).toString(16).repeat(40)}`,
			fee_hundredths_bip: fee,
			quote_decimals: quote === 'USDC' ? 6 : 18,
			quote_symbol: quote ?? (venue === 'v4' ? 'ETH' : 'WETH'),
			event_name: demoPriceEventName(index, venue),
			rep_per_eth_1e18: quote === 'USDC' ? (4_200_000_000_000_000n + BigInt(index) * 90_000_000_000_000n).toString() : (BigInt(value) + (BigInt(venueIndex) - 1n) * 300_000_000_000_000_000n).toString(),
			liquidity_value: demoLiquidityValue(venue, quote, venueIndex * 7 + index),
		})),
	)

export const demoUniswapRepEthPriceHistory = (now = Date.now()): UniswapPriceObservation[] =>
	demoUniswapHistory(
		[
			{ venue: 'v2', fee: '3000' },
			{ venue: 'v3', fee: '500' },
			{ venue: 'v3', fee: '500', quote: 'USDC' },
			{ venue: 'v4', fee: '3000' },
		],
		now,
	)

export const demoDenseUniswapRepEthPriceHistory = (now = Date.now()): UniswapPriceObservation[] =>
	demoUniswapHistory(
		[
			{ venue: 'v2', fee: '3000' },
			{ venue: 'v3', fee: '100' },
			{ venue: 'v3', fee: '500' },
			{ venue: 'v3', fee: '3000' },
			{ venue: 'v4', fee: '100' },
			{ venue: 'v4', fee: '500' },
			{ venue: 'v4', fee: '3000' },
			{ venue: 'v4', fee: '10000' },
		],
		now,
	)

const demoTrader = '0xc9b36e44643fc5d882654ffd9791ae7171b0e9db'
const demoTransaction = (seed: number) => `0x${seed.toString(16).padStart(64, '7')}`

export const demoTradingActivity = (asOf: { readonly blockNumber: string; readonly blockTimestamp: string }) =>
	(
		[
			['exit', 'YES', demoTrader, '5200000000000000000', '0', '3100000000000000000'],
			['swap', 'NO', '0x3333333333333333333333333333333333333333', '1900000000000000000', null, null],
			['enter', 'YES', demoTrader, '9800000000000000000', '5000000000000000000', '0'],
			['add-liquidity', null, '0x2222222222222222222222222222222222222222', '12500000000000000000', '15000000000000000000', '0'],
		] as const
	).map(([kind, side, account, shares, ethIn, ethOut], index) => ({
		block_hash: demoTransaction(900 + index),
		tx_hash: demoTransaction(index + 1),
		block_number: String(BigInt(asOf.blockNumber) - BigInt(index * 40)),
		log_index: 3,
		timestamp_seconds: String(BigInt(asOf.blockTimestamp) - BigInt(index * 480)),
		kind,
		side,
		account,
		shares,
		eth_in_atto_eth: ethIn,
		eth_out_atto_eth: ethOut,
	}))

const demoPnlPosition = (market: string, questionTitle: string, holdings: readonly [string, string, string], flows: readonly [cost: string, proceeds: string, value: string, realized: string, unrealized: string, net: string]) => ({
	market_address: market,
	question_title: questionTitle,
	action_count: 2,
	invalid_atto_shares: holdings[0],
	yes_atto_shares: holdings[1],
	no_atto_shares: holdings[2],
	lp_tokens: '0',
	cost_basis_atto_eth: flows[0],
	proceeds_atto_eth: flows[1],
	holdings_value_atto_eth: flows[2],
	realized_pnl_atto_eth: flows[3],
	unrealized_pnl_atto_eth: flows[4],
	net_pnl_atto_eth: flows[5],
	open: holdings.some(value => value !== '0'),
	valuation: { status: 'available' },
})

export const demoTradingPnl = (market: string) => ({
	items: [
		demoPnlPosition(market, 'Will the 2030 global mean temperature anomaly exceed 1.5°C?', ['1800000000000000000', '4600000000000000000', '0'], ['5000000000000000000', '3100000000000000000', '1650000000000000000', '0', '-250000000000000000', '-250000000000000000']),
		demoPnlPosition('0xa7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7', 'Will the protocol meet its launch reliability target?', ['0', '0', '0'], ['2000000000000000000', '2640000000000000000', '0', '640000000000000000', '0', '640000000000000000']),
	],
	truncated: false,
	basis: 'Cost basis is the ETH this account paid into the market’s security pool; holdings are valued at the ETH an exit would return at the latest indexed reserves.',
})
