import { describe, expect, test } from 'bun:test'
import { aggregateCentralizedMarketObservations, centralizedPriceAllowsExecution, observeCentralizedMarkets, parseCentralizedMarketSettings, serializeCentralizedMarketSettings, type CentralizedExchangeFactory, type CentralizedMarketObservation } from '../src/monitoring/centralized-markets.ts'

const settings = parseCentralizedMarketSettings({
	depthBps: 500,
	maximumDexDeviationBps: 1_000,
	maximumObservationAgeMilliseconds: 30_000,
	maximumVenueDispersionBps: 500,
	minimumAskDepthEth: '2',
	minimumBidDepthEth: '2',
	minimumSourceCount: 2,
	orderBookLimit: 20,
	requestTimeoutMilliseconds: 2_000,
	requiredForExecution: true,
	sources: [
		{ ethMarket: 'ETH/USD', exchangeId: 'alpha', repMarket: 'REP/USD' },
		{ ethMarket: 'ETH/USD', exchangeId: 'beta', repMarket: 'REP/USD' },
	],
})

function observation(exchangeId: string, priceRepPerEth: bigint, timestamp = 10_000): CentralizedMarketObservation {
	return {
		askDepthEth: 2n * 10n ** 18n,
		bestAskQuote: '10.1',
		bestBidQuote: '9.9',
		bidDepthEth: 2n * 10n ** 18n,
		exchangeId,
		observedAt: timestamp,
		priceRepPerEth,
		repMarket: 'REP/USD',
		sourceTimestamp: timestamp,
	}
}

describe('centralized market observations', () => {
	test('uses a cross-venue median and executable depth to validate a DEX price', () => {
		const estimate = aggregateCentralizedMarketObservations([observation('alpha', 200n * 10n ** 18n), observation('beta', 202n * 10n ** 18n)], settings, 10_000)
		expect(estimate?.priceRepPerEth).toBe(201n * 10n ** 18n)
		expect(estimate?.reliable).toBe(true)
		expect(centralizedPriceAllowsExecution(205n * 10n ** 18n, estimate, settings, 10_000)).toBe(true)
		expect(centralizedPriceAllowsExecution(250n * 10n ** 18n, estimate, settings, 10_000)).toBe(false)
	})

	test('fails closed when observations are stale, dispersed, shallow, or unavailable', () => {
		const stale = aggregateCentralizedMarketObservations([observation('alpha', 200n * 10n ** 18n, 1), observation('beta', 201n * 10n ** 18n, 1)], settings, 100_000)
		expect(stale?.reliable).toBe(false)
		const dispersed = aggregateCentralizedMarketObservations([observation('alpha', 100n * 10n ** 18n), observation('beta', 200n * 10n ** 18n)], settings, 10_000)
		expect(dispersed?.reliable).toBe(false)
		expect(centralizedPriceAllowsExecution(150n * 10n ** 18n, undefined, settings)).toBe(false)
	})

	test('requires independent exchanges when centralized evidence is an execution prerequisite', () => {
		expect(() =>
			parseCentralizedMarketSettings({
				...serializeCentralizedMarketSettings(settings),
				sources: [
					{ ethMarket: 'ETH/USD', exchangeId: 'alpha', repMarket: 'REP/USD' },
					{ ethMarket: 'ETH/USDT', exchangeId: 'alpha', repMarket: 'REP/USDT' },
				],
			}),
		).toThrow('distinct exchanges')
	})

	test('normalizes public CCXT order books and quote-currency ETH prices', async () => {
		const factory: CentralizedExchangeFactory = () => ({
			fetchOrderBook: async () => ({
				asks: [[10.1, 1_000]],
				bids: [[9.9, 1_000]],
				timestamp: 10_000,
			}),
			fetchTicker: async () => ({
				ask: 2_010,
				bid: 1_990,
				last: 2_000,
			}),
			loadMarkets: async () => ({}),
		})
		const estimate = await observeCentralizedMarkets(settings, factory, 10_000)
		expect(estimate?.priceRepPerEth).toBe(200n * 10n ** 18n)
		expect(estimate?.reliable).toBe(true)
	})

	test('supports REP markets quoted directly in ETH', async () => {
		const directSettings = parseCentralizedMarketSettings({
			...serializeCentralizedMarketSettings(settings),
			minimumAskDepthEth: '0',
			minimumBidDepthEth: '0',
			minimumSourceCount: 1,
			requiredForExecution: false,
			sources: [{ ethMarket: null, exchangeId: 'alpha', repMarket: 'REP/ETH' }],
		})
		const factory: CentralizedExchangeFactory = () => ({
			fetchOrderBook: async () => ({
				asks: [[0.0051, 1_000]],
				bids: [[0.0049, 1_000]],
				timestamp: 10_000,
			}),
			fetchTicker: async () => {
				throw new Error('Direct ETH quote must not request an ETH ticker')
			},
			loadMarkets: async () => ({}),
		})
		const estimate = await observeCentralizedMarkets(directSettings, factory, 10_000)
		expect(estimate?.priceRepPerEth).toBe(200n * 10n ** 18n)
		expect(estimate?.reliable).toBe(true)
	})
})
