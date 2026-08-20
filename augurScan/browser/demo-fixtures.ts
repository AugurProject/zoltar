import type { UniswapPriceObservation } from './chart-values.ts'

export interface AmmPriceHistoryRecord {
	timestamp: string
	block_number: string
	conditional_yes_bps: string
	conditional_no_bps: string
	yes_reserve_atto_shares: string
	no_reserve_atto_shares: string
}

export interface RepEthPriceHistoryRecord {
	timestamp: string
	settlement_timestamp: string | null
	block_number: string
	event_name: string
	report_id: string | null
	rep_per_eth_1e18: string
}

interface DemoUniswapMarket {
	venue: 'v2' | 'v3' | 'v4'
	fee: string
}

const demoRepEthValues = [
	'18250000000000000000',
	'17980000000000000000',
	'18420000000000000000',
	'19110000000000000000',
	'18860000000000000000',
	'19640000000000000000',
]

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

const demoUniswapHistory = (markets: readonly DemoUniswapMarket[], now: number): UniswapPriceObservation[] =>
	markets.flatMap(({ venue, fee }, venueIndex) =>
		demoRepEthValues.slice(1).map((value, index) => ({
			timestamp: new Date(now - (4 - index) * 8 * 86_400_000 + venueIndex * 9_000_000).toISOString(),
			block_number: String(23_110_000 + index * 12_000 + venueIndex * 120),
			venue,
			market_id: venue === 'v4' ? `0x${(venueIndex + 7).toString(16).repeat(64)}` : `0x${(venueIndex + 7).toString(16).repeat(40)}`,
			contract_address: `0x${(venueIndex + 4).toString(16).repeat(40)}`,
			fee_hundredths_bip: fee,
			quote_symbol: venue === 'v4' ? 'ETH' : 'WETH',
			event_name: index === 0 && venue !== 'v2' ? 'Initialize' : venue === 'v2' ? 'Sync' : 'Swap',
			rep_per_eth_1e18: (BigInt(value) + (BigInt(venueIndex) - 1n) * 300_000_000_000_000_000n).toString(),
		})),
	)

export const demoUniswapRepEthPriceHistory = (now = Date.now()): UniswapPriceObservation[] =>
	demoUniswapHistory(
		[
			{ venue: 'v2', fee: '3000' },
			{ venue: 'v3', fee: '500' },
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
