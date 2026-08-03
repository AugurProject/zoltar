import { describe, expect, spyOn, test } from 'bun:test'
import {
	aggregateCentralizedMarketObservations,
	centralizedMarketConfigurationAllowsExecution,
	centralizedMarketConsensusObservations,
	centralizedPriceAllowsExecution,
	centralizedPriceDeviationBps,
	observeCentralizedMarkets,
	parseCentralizedMarketSettings,
	serializeCentralizedMarketSettings,
	type CentralizedExchangeFactory,
	type CentralizedMarketObservation,
} from '../src/monitoring/centralized-markets.ts'

const REP_ASSET = '0x0000000000000000000000000000000000000001'
const CHILD_REP_ASSET = '0x0000000000000000000000000000000000000002'

const settings = parseCentralizedMarketSettings({
	assetAddress: REP_ASSET,
	assetChainId: 1,
	assetSymbol: 'REP',
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
	venueConsensus: {
		allowSingleGroupFallback: false,
		dexProbeDepthEth: '1',
		dexSources: [
			{ feeBps: 30, pair: '0x0000000000000000000000000000000000000003', sourceId: 'uniswap-v2' },
			{ feeBps: 30, pair: '0x0000000000000000000000000000000000000004', sourceId: 'sushiswap-v2' },
		],
		maximumGroupDeviationBps: 500,
		minimumDexAskDepthEth: '0.5',
		minimumDexBidDepthEth: '0.5',
		minimumDexSourceCount: 2,
		minimumSourceObservationCount: 2,
		minimumSourceObservationSpanMilliseconds: 10_000,
		minimumTotalSourceCount: 3,
	},
})

function observation(exchangeId: string, priceRepPerEth: bigint, timestamp = 10_000): CentralizedMarketObservation {
	return {
		assetId: REP_ASSET,
		askDepthEth: 2n * 10n ** 18n,
		bestAskQuote: '10.1',
		bestBidQuote: '9.9',
		bidDepthEth: 2n * 10n ** 18n,
		chainId: 1,
		exchangeId,
		ethTickerTimestamp: timestamp,
		observedAt: timestamp,
		orderBookTimestamp: timestamp,
		priceRepPerEth,
		repMarket: 'REP/USD',
		usesEthTicker: true,
	}
}

describe('centralized market observations', () => {
	test('validates exchange timestamps against the time after requests complete', async () => {
		let clockReads = 0
		const now = spyOn(Date, 'now').mockImplementation(() => (clockReads++ === 0 ? 10_000 : 10_001))
		const factory: CentralizedExchangeFactory = () => ({
			fetchOrderBook: async () => ({
				asks: [[10.1, 1_000]],
				bids: [[9.9, 1_000]],
				timestamp: 10_001,
			}),
			fetchTicker: async () => ({ ask: 2_010, bid: 1_990, last: 2_000, timestamp: 10_001 }),
			loadMarkets: async () => ({}),
		})
		try {
			const estimate = await observeCentralizedMarkets(settings, REP_ASSET, 1, factory)
			expect(estimate?.reliable).toBe(true)
			expect(estimate?.observations).toHaveLength(2)
		} finally {
			now.mockRestore()
		}
	})

	test('uses a cross-venue median and executable depth to validate a DEX price', () => {
		const estimate = aggregateCentralizedMarketObservations([observation('alpha', 200n * 10n ** 18n), observation('beta', 202n * 10n ** 18n)], settings, REP_ASSET, 10_000)
		if (estimate === undefined) throw new Error('Expected a centralized market estimate')
		expect(estimate?.priceRepPerEth).toBe(201n * 10n ** 18n)
		expect(estimate?.reliable).toBe(true)
		expect(centralizedPriceAllowsExecution(205n * 10n ** 18n, estimate, settings, REP_ASSET, 10_000)).toBe(true)
		expect(centralizedPriceAllowsExecution(250n * 10n ** 18n, estimate, settings, REP_ASSET, 10_000)).toBe(false)
		expect(centralizedPriceAllowsExecution(205n * 10n ** 18n, estimate, settings, CHILD_REP_ASSET, 10_000)).toBe(false)
		const advisorySettings = { ...settings, requiredForExecution: false }
		expect(centralizedPriceAllowsExecution(250n * 10n ** 18n, estimate, advisorySettings, CHILD_REP_ASSET, 10_000)).toBe(true)
		expect(centralizedPriceDeviationBps(205n * 10n ** 18n, estimate, CHILD_REP_ASSET)).toBeUndefined()
	})

	test('fails closed when observations are stale, dispersed, shallow, or unavailable', () => {
		const stale = aggregateCentralizedMarketObservations([observation('alpha', 200n * 10n ** 18n, 1), observation('beta', 201n * 10n ** 18n, 1)], settings, REP_ASSET, 100_000)
		expect(stale?.reliable).toBe(false)
		const dispersed = aggregateCentralizedMarketObservations([observation('alpha', 100n * 10n ** 18n), observation('beta', 200n * 10n ** 18n)], settings, REP_ASSET, 10_000)
		expect(dispersed?.reliable).toBe(false)
		expect(centralizedPriceAllowsExecution(150n * 10n ** 18n, undefined, settings, REP_ASSET)).toBe(false)
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

	test('round trips operator-configured CEX and constant-product DEX sources', () => {
		const configured = parseCentralizedMarketSettings({
			...serializeCentralizedMarketSettings(settings),
			requiredForExecution: false,
			venueConsensus: {
				allowSingleGroupFallback: false,
				dexProbeDepthEth: '1',
				dexSources: [{ feeBps: 30, pair: '0x0000000000000000000000000000000000000003', sourceId: 'uniswap-v2' }],
				maximumGroupDeviationBps: 500,
				minimumDexAskDepthEth: '0.5',
				minimumDexBidDepthEth: '0.5',
				minimumDexSourceCount: 2,
				minimumSourceObservationCount: 2,
				minimumSourceObservationSpanMilliseconds: 10000,
				minimumTotalSourceCount: 3,
			},
		})
		expect(serializeCentralizedMarketSettings(configured).venueConsensus).toEqual({
			allowSingleGroupFallback: false,
			dexProbeDepthEth: '1',
			dexSources: [{ feeBps: 30, pair: '0x0000000000000000000000000000000000000003', sourceId: 'uniswap-v2' }],
			maximumGroupDeviationBps: 500,
			minimumDexAskDepthEth: '0.5',
			minimumDexBidDepthEth: '0.5',
			minimumDexSourceCount: 2,
			minimumSourceObservationCount: 2,
			minimumSourceObservationSpanMilliseconds: 10000,
			minimumTotalSourceCount: 3,
		})
	})

	test('requires temporal and independent-source quorum for mandatory venue consensus', () => {
		const serialized = serializeCentralizedMarketSettings(settings)
		Reflect.deleteProperty(serialized, 'venueConsensus')
		expect(() => parseCentralizedMarketSettings(serialized)).toThrow('needs venueConsensus')
		expect(() =>
			parseCentralizedMarketSettings({
				...serializeCentralizedMarketSettings(settings),
				venueConsensus: {
					allowSingleGroupFallback: false,
					dexProbeDepthEth: '1',
					dexSources: [],
					maximumGroupDeviationBps: 500,
					minimumDexAskDepthEth: '0.5',
					minimumDexBidDepthEth: '0.5',
					minimumDexSourceCount: 2,
					minimumSourceObservationCount: 1,
					minimumSourceObservationSpanMilliseconds: 0,
					minimumTotalSourceCount: 2,
				},
			}),
		).toThrow('enough configured DEX sources')
		expect(() =>
			parseCentralizedMarketSettings({
				...serializeCentralizedMarketSettings(settings),
				venueConsensus: {
					...serializeCentralizedMarketSettings(settings).venueConsensus,
					minimumTotalSourceCount: 5,
				},
			}),
		).toThrow('enough configured CEX and DEX sources')
		expect(() =>
			parseCentralizedMarketSettings({
				...serializeCentralizedMarketSettings(settings),
				maximumObservationAgeMilliseconds: 30_000,
				venueConsensus: {
					...serializeCentralizedMarketSettings(settings).venueConsensus,
					minimumSourceObservationSpanMilliseconds: 31_000,
				},
			}),
		).toThrow('observation span cannot exceed')
	})

	test('binds configured markets to REP, the exact token address, chain, and globally unique failure domains', () => {
		expect(() => parseCentralizedMarketSettings({ ...serializeCentralizedMarketSettings(settings), assetSymbol: 'BTC', sources: settings.sources.map(source => ({ ...source, repMarket: 'BTC/USD' })) })).toThrow('assetSymbol must be REP')
		expect(() => parseCentralizedMarketSettings({ ...serializeCentralizedMarketSettings(settings), sources: [{ ethMarket: 'ETH/USD', exchangeId: 'alpha', repMarket: 'BTC/USD' }, settings.sources[1]] })).toThrow('repMarket base')
		expect(() =>
			parseCentralizedMarketSettings({
				...serializeCentralizedMarketSettings(settings),
				venueConsensus: {
					...serializeCentralizedMarketSettings(settings).venueConsensus,
					dexSources: [
						{ feeBps: 30, pair: '0x0000000000000000000000000000000000000003', sourceId: 'alpha' },
						{ feeBps: 30, pair: '0x0000000000000000000000000000000000000004', sourceId: 'sushiswap-v2' },
					],
				},
			}),
		).toThrow('globally distinct')
		expect(() => aggregateCentralizedMarketObservations([observation('alpha', 200n * 10n ** 18n)], { ...settings, assetChainId: 2 }, REP_ASSET, 10_000)).toThrow('exact REP asset and chain')
	})

	test('requires an exact ETH cross market and forbids one for direct REP/ETH books', () => {
		const serialized = serializeCentralizedMarketSettings(settings)
		expect(() => parseCentralizedMarketSettings({ ...serialized, minimumSourceCount: 1, requiredForExecution: false, sources: [{ ethMarket: 'BTC/USD', exchangeId: 'alpha', repMarket: 'REP/USD' }] })).toThrow('must be ETH/USD')
		expect(() => parseCentralizedMarketSettings({ ...serialized, minimumSourceCount: 1, requiredForExecution: false, sources: [{ ethMarket: 'USD/ETH', exchangeId: 'alpha', repMarket: 'REP/USD' }] })).toThrow('must be ETH/USD')
		expect(() => parseCentralizedMarketSettings({ ...serialized, minimumSourceCount: 1, requiredForExecution: false, sources: [{ ethMarket: 'BTC/ETH', exchangeId: 'alpha', repMarket: 'REP/ETH' }] })).toThrow('must be absent')
		expect(parseCentralizedMarketSettings({ ...serialized, minimumSourceCount: 1, requiredForExecution: false, sources: [{ ethMarket: 'ETH/USDT', exchangeId: 'alpha', repMarket: 'REP/USDT' }] }).sources[0]?.ethMarket).toBe('ETH/USDT')
	})

	test('fails closed for manually constructed required settings with too few configured DEX sources', () => {
		const venueConsensus = settings.venueConsensus
		if (venueConsensus === undefined) throw new Error('Expected venue consensus settings')
		const firstCex = settings.sources[0]
		const firstDex = venueConsensus.dexSources[0]
		const secondDex = venueConsensus.dexSources[1]
		if (firstCex === undefined || firstDex === undefined || secondDex === undefined) throw new Error('Expected configured market sources')
		expect(centralizedMarketConfigurationAllowsExecution({ ...settings, venueConsensus: { ...venueConsensus, dexSources: [] } })).toBe(false)
		expect(centralizedMarketConfigurationAllowsExecution({ ...settings, minimumSourceCount: 1, sources: settings.sources.slice(0, 1) })).toBe(false)
		expect(centralizedMarketConfigurationAllowsExecution({ ...settings, maximumObservationAgeMilliseconds: 5_000 })).toBe(false)
		expect(centralizedMarketConfigurationAllowsExecution({ ...settings, maximumObservationAgeMilliseconds: Number.POSITIVE_INFINITY })).toBe(false)
		expect(centralizedMarketConfigurationAllowsExecution({ ...settings, minimumAskDepthEth: -1n })).toBe(false)
		expect(centralizedMarketConfigurationAllowsExecution({ ...settings, maximumVenueDispersionBps: 10_001n })).toBe(false)
		expect(centralizedMarketConfigurationAllowsExecution({ ...settings, minimumSourceCount: -1 })).toBe(false)
		expect(centralizedMarketConfigurationAllowsExecution({ ...settings, sources: [{ ...firstCex, exchangeId: 'Alpha' }, settings.sources[1] ?? firstCex] })).toBe(false)
		expect(centralizedMarketConfigurationAllowsExecution({ ...settings, sources: [firstCex, firstCex] })).toBe(false)
		expect(centralizedMarketConfigurationAllowsExecution({ ...settings, venueConsensus: { ...venueConsensus, dexSources: [firstDex, firstDex] } })).toBe(false)
		expect(
			centralizedMarketConfigurationAllowsExecution({
				...settings,
				venueConsensus: {
					...venueConsensus,
					dexSources: [firstDex, { ...secondDex, pair: firstDex.pair }],
				},
			}),
		).toBe(false)
	})

	test('uses the oldest exchange-native timestamp when creating consensus evidence', () => {
		const estimate = aggregateCentralizedMarketObservations(
			[
				{ ...observation('alpha', 200n * 10n ** 18n, 9_000), ethTickerTimestamp: 8_000, observedAt: 10_000 },
				{ ...observation('beta', 201n * 10n ** 18n, 9_500), ethTickerTimestamp: 8_500, observedAt: 10_000 },
			],
			settings,
			REP_ASSET,
			10_000,
		)
		expect(centralizedMarketConsensusObservations(estimate).map(value => value.observedAt)).toEqual([8_000, 8_500])
	})

	test('does not admit timestamp-less cached exchange responses into required consensus history', () => {
		const cached = [
			{ ...observation('alpha', 200n * 10n ** 18n), ethTickerTimestamp: undefined, observedAt: 10_000, orderBookTimestamp: undefined },
			{ ...observation('beta', 201n * 10n ** 18n), ethTickerTimestamp: undefined, observedAt: 10_000, orderBookTimestamp: undefined },
		]
		const first = aggregateCentralizedMarketObservations(cached, settings, REP_ASSET, 10_000)
		const second = aggregateCentralizedMarketObservations(
			cached.map(value => ({ ...value, observedAt: 20_000 })),
			settings,
			REP_ASSET,
			20_000,
		)
		expect(first?.reliable).toBe(false)
		expect(second?.reliable).toBe(false)
		expect(centralizedMarketConsensusObservations(first)).toEqual([])
		expect(centralizedMarketConsensusObservations(second)).toEqual([])
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
				timestamp: 10_000,
			}),
			loadMarkets: async () => ({}),
		})
		const estimate = await observeCentralizedMarkets(settings, REP_ASSET, 1, factory, 10_000)
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
		const estimate = await observeCentralizedMarkets(directSettings, REP_ASSET, 1, factory, 10_000)
		expect(estimate?.priceRepPerEth).toBe(200n * 10n ** 18n)
		expect(estimate?.reliable).toBe(true)
	})

	test('does not expose exchange adapter failures in operator-facing reasons', async () => {
		const factory: CentralizedExchangeFactory = exchangeId => ({
			fetchOrderBook: async () => {
				throw new Error(`CCXT ${exchangeId} socket timeout at api.exchange.example/private-detail`)
			},
			fetchTicker: async () => {
				throw new Error('Ticker should not be requested after the order book fails')
			},
			loadMarkets: async () => ({}),
		})
		const estimate = await observeCentralizedMarkets(settings, REP_ASSET, 1, factory, 10_000)
		expect(estimate?.reasons).toContain('alpha observation unavailable')
		expect(estimate?.reasons).toContain('beta observation unavailable')
		expect(estimate?.reasons.join(' ')).not.toContain('CCXT')
		expect(estimate?.reasons.join(' ')).not.toContain('socket timeout')
		expect(estimate?.reasons.join(' ')).not.toContain('api.exchange.example')
	})

	test('rejects a fresh REP book when its required ETH cross ticker is stale', async () => {
		const factory: CentralizedExchangeFactory = () => ({
			fetchOrderBook: async () => ({
				asks: [[10.1, 1_000]],
				bids: [[9.9, 1_000]],
				timestamp: 100_000,
			}),
			fetchTicker: async () => ({
				ask: 2_010,
				bid: 1_990,
				last: 2_000,
				timestamp: 1,
			}),
			loadMarkets: async () => ({}),
		})
		const estimate = await observeCentralizedMarkets(settings, REP_ASSET, 1, factory, 100_000)
		expect(estimate?.reliable).toBe(false)
		expect(estimate?.observations).toHaveLength(0)
		expect(centralizedPriceAllowsExecution(200n * 10n ** 18n, estimate, settings, REP_ASSET, 100_000)).toBe(false)
	})
})
