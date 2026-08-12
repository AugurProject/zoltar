import ccxt, { type Exchange } from 'ccxt'
import { bigintToSafeNumber } from '../ethereum.ts'
import type { MarketConsensusObservation, MarketConsensusSettings } from './market-consensus.ts'

const FIXED_UNIT = 10n ** 18n
const BPS = 10_000n

export type CentralizedMarketSource = {
	ethMarket: string | undefined
	exchangeId: string
	repMarket: string
}

export type CentralizedMarketSettings = {
	assetAddress: `0x${string}`
	assetChainId: number
	assetSymbol: string
	depthBps: bigint
	maximumDexDeviationBps: bigint
	maximumObservationAgeMilliseconds: number
	maximumVenueDispersionBps: bigint
	minimumAskDepthAttoEth: bigint
	minimumBidDepthAttoEth: bigint
	minimumSourceCount: number
	orderBookLimit: number
	requestTimeoutMilliseconds: number
	requiredForExecution: boolean
	sources: readonly CentralizedMarketSource[]
	venueConsensus?: {
		allowSingleGroupFallback: boolean
		dexProbeDepthAttoEth: bigint
		dexSources: readonly {
			feeBps: number
			pair: `0x${string}`
			sourceId: string
		}[]
		maximumGroupDeviationBps: bigint
		minimumDexAskDepthAttoEth: bigint
		minimumDexBidDepthAttoEth: bigint
		minimumDexSourceCount: number
		minimumSourceObservationCount: number
		minimumSourceObservationSpanMilliseconds: number
		minimumTotalSourceCount: number
	}
}

export type CentralizedMarketObservation = {
	assetId: string
	askDepthAttoEth: bigint
	bestAskQuote: string
	bestBidQuote: string
	bidDepthAttoEth: bigint
	chainId: number
	exchangeId: string
	ethTickerTimestamp: number | undefined
	observedAt: number
	orderBookTimestamp: number | undefined
	priceRepPerEth: bigint
	repMarket: string
	usesEthTicker: boolean
}

export type CentralizedMarketEstimate = {
	assetId: string
	askDepthAttoEth: bigint
	bidDepthAttoEth: bigint
	chainId: number
	maximumPriceRepPerEth: bigint
	minimumPriceRepPerEth: bigint
	observations: readonly CentralizedMarketObservation[]
	priceRepPerEth: bigint
	reliable: boolean
	reasons: readonly string[]
}

type MarketOrderBook = {
	asks: [number | undefined, number | undefined][]
	bids: [number | undefined, number | undefined][]
	timestamp: number | undefined
}

type MarketTicker = {
	ask: number | undefined
	bid: number | undefined
	last: number | undefined
	timestamp: number | undefined
}

type MarketExchange = {
	fetchOrderBook: (symbol: string, limit: number) => Promise<MarketOrderBook>
	fetchTicker: (symbol: string) => Promise<MarketTicker>
	loadMarkets: () => Promise<unknown>
}
export type CentralizedExchangeFactory = (exchangeId: string, timeoutMilliseconds: number) => MarketExchange
const exchangeCache = new Map<string, MarketExchange>()

function record(value: unknown, label: string) {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`)
	return value as Record<string, unknown>
}

function integer(value: unknown, label: string, minimum: number, maximum: number) {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new Error(`${label} must be an integer from ${minimum.toString()} through ${maximum.toString()}`)
	}
	return value
}

function decimalEth(value: unknown, label: string) {
	if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value)) {
		throw new Error(`${label} must be a non-negative decimal with at most 18 places`)
	}
	const [whole = '0', fraction = ''] = value.split('.')
	return BigInt(whole) * FIXED_UNIT + BigInt(fraction.padEnd(18, '0'))
}

function market(value: unknown, label: string) {
	if (typeof value !== 'string' || !/^[A-Z0-9][A-Z0-9._-]*\/[A-Z0-9][A-Z0-9._-]*$/.test(value)) {
		throw new Error(`${label} must use the unified BASE/QUOTE market format`)
	}
	return value
}

function address(value: unknown, label: string) {
	if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`${label} must be an address`)
	return value as `0x${string}`
}

function assetSymbol(value: unknown) {
	if (typeof value !== 'string' || !/^[A-Z0-9][A-Z0-9._-]*$/.test(value)) throw new Error('centralizedMarkets.assetSymbol is invalid')
	if (value !== 'REP') throw new Error('centralizedMarkets.assetSymbol must be REP')
	return value
}

export function parseCentralizedMarketSettings(value: unknown): CentralizedMarketSettings {
	const settings = record(value, 'centralizedMarkets')
	const allowed = new Set([
		'assetAddress',
		'assetChainId',
		'assetSymbol',
		'depthBps',
		'maximumDexDeviationBps',
		'maximumObservationAgeMilliseconds',
		'maximumVenueDispersionBps',
		'minimumAskDepthEth',
		'minimumBidDepthEth',
		'minimumSourceCount',
		'orderBookLimit',
		'requestTimeoutMilliseconds',
		'requiredForExecution',
		'sources',
		'venueConsensus',
	])
	for (const key of Object.keys(settings)) {
		if (!allowed.has(key)) throw new Error(`Unknown centralizedMarkets field: ${key}`)
	}
	for (const key of [...allowed].filter(key => key !== 'venueConsensus')) {
		if (!(key in settings)) throw new Error(`centralizedMarkets is missing ${key}`)
	}
	if (!Array.isArray(settings['sources'])) throw new Error('centralizedMarkets.sources must be an array')
	const configuredAssetSymbol = assetSymbol(settings['assetSymbol'])
	const sources = settings['sources'].map((rawSource, index) => {
		const source = record(rawSource, `centralizedMarkets.sources[${index.toString()}]`)
		if (Object.keys(source).some(key => key !== 'exchangeId' && key !== 'repMarket' && key !== 'ethMarket')) {
			throw new Error(`centralizedMarkets.sources[${index.toString()}] has an unknown field`)
		}
		if (typeof source['exchangeId'] !== 'string' || !/^[a-z0-9]+$/.test(source['exchangeId'])) {
			throw new Error(`centralizedMarkets.sources[${index.toString()}].exchangeId must be a lowercase CCXT exchange id`)
		}
		const repMarket = market(source['repMarket'], `centralizedMarkets.sources[${index.toString()}].repMarket`)
		if (repMarket.split('/')[0] !== configuredAssetSymbol) throw new Error(`centralizedMarkets.sources[${index.toString()}].repMarket base must match centralizedMarkets.assetSymbol`)
		const quoteAsset = repMarket.split('/')[1]
		const ethMarket = source['ethMarket'] === null || source['ethMarket'] === undefined ? undefined : market(source['ethMarket'], `centralizedMarkets.sources[${index.toString()}].ethMarket`)
		if (quoteAsset === 'ETH' && ethMarket !== undefined) throw new Error(`centralizedMarkets.sources[${index.toString()}].ethMarket must be absent when REP is quoted in ETH`)
		if (quoteAsset !== 'ETH' && ethMarket !== `ETH/${quoteAsset}`) throw new Error(`centralizedMarkets.sources[${index.toString()}].ethMarket must be ETH/${quoteAsset ?? 'QUOTE'}`)
		return { ethMarket, exchangeId: source['exchangeId'], repMarket }
	})
	const uniqueSources = new Set(sources.map(source => `${source.exchangeId}:${source.repMarket}:${source.ethMarket ?? ''}`))
	if (uniqueSources.size !== sources.length) throw new Error('centralizedMarkets.sources must not contain duplicates')
	const uniqueExchanges = new Set(sources.map(source => source.exchangeId))
	if (uniqueExchanges.size !== sources.length) throw new Error('centralizedMarkets.sources must use distinct exchanges')
	const depthBps = BigInt(integer(settings['depthBps'], 'centralizedMarkets.depthBps', 1, 5_000))
	const maximumDexDeviationBps = BigInt(integer(settings['maximumDexDeviationBps'], 'centralizedMarkets.maximumDexDeviationBps', 1, 10_000))
	const maximumObservationAgeMilliseconds = integer(settings['maximumObservationAgeMilliseconds'], 'centralizedMarkets.maximumObservationAgeMilliseconds', 1_000, 3_600_000)
	const maximumVenueDispersionBps = BigInt(integer(settings['maximumVenueDispersionBps'], 'centralizedMarkets.maximumVenueDispersionBps', 1, 10_000))
	const minimumSourceCount = integer(settings['minimumSourceCount'], 'centralizedMarkets.minimumSourceCount', 1, 100)
	if (sources.length > 0 && minimumSourceCount > sources.length) throw new Error('centralizedMarkets.minimumSourceCount cannot exceed the configured source count')
	if (typeof settings['requiredForExecution'] !== 'boolean') throw new Error('centralizedMarkets.requiredForExecution must be a boolean')
	if (settings['requiredForExecution'] && sources.length === 0) throw new Error('centralizedMarkets.requiredForExecution needs at least one source')
	if (settings['requiredForExecution'] && minimumSourceCount < 2) throw new Error('centralizedMarkets.requiredForExecution needs at least two independent sources')
	const rawVenueConsensus = settings['venueConsensus']
	if (settings['requiredForExecution'] && rawVenueConsensus === undefined) throw new Error('centralizedMarkets.requiredForExecution needs venueConsensus')
	const venueConsensus =
		rawVenueConsensus === undefined
			? undefined
			: (() => {
					const consensus = record(rawVenueConsensus, 'centralizedMarkets.venueConsensus')
					const consensusKeys = new Set(['allowSingleGroupFallback', 'dexProbeDepthEth', 'dexSources', 'maximumGroupDeviationBps', 'minimumDexAskDepthEth', 'minimumDexBidDepthEth', 'minimumDexSourceCount', 'minimumSourceObservationCount', 'minimumSourceObservationSpanMilliseconds', 'minimumTotalSourceCount'])
					for (const key of Object.keys(consensus)) if (!consensusKeys.has(key)) throw new Error(`Unknown centralizedMarkets.venueConsensus field: ${key}`)
					for (const key of consensusKeys) if (!(key in consensus)) throw new Error(`centralizedMarkets.venueConsensus is missing ${key}`)
					if (!Array.isArray(consensus['dexSources'])) throw new Error('centralizedMarkets.venueConsensus.dexSources must be an array')
					const dexSources = consensus['dexSources'].map((value, index) => {
						const source = record(value, `centralizedMarkets.venueConsensus.dexSources[${index.toString()}]`)
						if (Object.keys(source).some(key => key !== 'feeBps' && key !== 'pair' && key !== 'sourceId')) throw new Error(`centralizedMarkets.venueConsensus.dexSources[${index.toString()}] has an unknown field`)
						if (typeof source['sourceId'] !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(source['sourceId'])) throw new Error(`centralizedMarkets.venueConsensus.dexSources[${index.toString()}].sourceId is invalid`)
						if (typeof source['pair'] !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(source['pair'])) throw new Error(`centralizedMarkets.venueConsensus.dexSources[${index.toString()}].pair must be an address`)
						return { feeBps: integer(source['feeBps'], `centralizedMarkets.venueConsensus.dexSources[${index.toString()}].feeBps`, 0, 1_000), pair: source['pair'] as `0x${string}`, sourceId: source['sourceId'] }
					})
					if (new Set(dexSources.map(source => source.sourceId)).size !== dexSources.length) throw new Error('centralizedMarkets.venueConsensus.dexSources must use distinct sourceId values')
					if (new Set(dexSources.map(source => source.pair.toLowerCase())).size !== dexSources.length) throw new Error('centralizedMarkets.venueConsensus.dexSources must use distinct pair addresses')
					if (dexSources.some(source => sources.some(cexSource => cexSource.exchangeId === source.sourceId))) throw new Error('CEX and DEX sources must use globally distinct failure-domain IDs')
					if (typeof consensus['allowSingleGroupFallback'] !== 'boolean') throw new Error('centralizedMarkets.venueConsensus.allowSingleGroupFallback must be a boolean')
					return {
						allowSingleGroupFallback: consensus['allowSingleGroupFallback'],
						dexProbeDepthAttoEth: decimalEth(consensus['dexProbeDepthEth'], 'centralizedMarkets.venueConsensus.dexProbeDepthEth'),
						dexSources,
						maximumGroupDeviationBps: BigInt(integer(consensus['maximumGroupDeviationBps'], 'centralizedMarkets.venueConsensus.maximumGroupDeviationBps', 1, 10_000)),
						minimumDexAskDepthAttoEth: decimalEth(consensus['minimumDexAskDepthEth'], 'centralizedMarkets.venueConsensus.minimumDexAskDepthEth'),
						minimumDexBidDepthAttoEth: decimalEth(consensus['minimumDexBidDepthEth'], 'centralizedMarkets.venueConsensus.minimumDexBidDepthEth'),
						minimumDexSourceCount: integer(consensus['minimumDexSourceCount'], 'centralizedMarkets.venueConsensus.minimumDexSourceCount', 1, 100),
						minimumSourceObservationCount: integer(consensus['minimumSourceObservationCount'], 'centralizedMarkets.venueConsensus.minimumSourceObservationCount', 1, 100),
						minimumSourceObservationSpanMilliseconds: integer(consensus['minimumSourceObservationSpanMilliseconds'], 'centralizedMarkets.venueConsensus.minimumSourceObservationSpanMilliseconds', 0, 3_600_000),
						minimumTotalSourceCount: integer(consensus['minimumTotalSourceCount'], 'centralizedMarkets.venueConsensus.minimumTotalSourceCount', 2, 200),
					}
				})()
	if (settings['requiredForExecution'] && venueConsensus !== undefined) {
		if (venueConsensus.minimumDexSourceCount < 2) throw new Error('Required venue consensus needs at least two independent DEX sources')
		if (venueConsensus.dexSources.length < venueConsensus.minimumDexSourceCount) throw new Error('Required venue consensus needs enough configured DEX sources to satisfy minimumDexSourceCount')
		if (venueConsensus.minimumTotalSourceCount < 3) throw new Error('Required venue consensus needs at least three total independent sources')
		if (sources.length + venueConsensus.dexSources.length < venueConsensus.minimumTotalSourceCount) throw new Error('Required venue consensus needs enough configured CEX and DEX sources to satisfy minimumTotalSourceCount')
		if (venueConsensus.minimumSourceObservationCount < 2 || venueConsensus.minimumSourceObservationSpanMilliseconds < 1_000) {
			throw new Error('Required venue consensus needs multiple observations spanning at least one second')
		}
		if (venueConsensus.minimumSourceObservationSpanMilliseconds > maximumObservationAgeMilliseconds) throw new Error('Required venue consensus observation span cannot exceed maximumObservationAgeMilliseconds')
	}
	return {
		assetAddress: address(settings['assetAddress'], 'centralizedMarkets.assetAddress'),
		assetChainId: integer(settings['assetChainId'], 'centralizedMarkets.assetChainId', 1, 2 ** 31 - 1),
		assetSymbol: configuredAssetSymbol,
		depthBps,
		maximumDexDeviationBps,
		maximumObservationAgeMilliseconds,
		maximumVenueDispersionBps,
		minimumAskDepthAttoEth: decimalEth(settings['minimumAskDepthEth'], 'centralizedMarkets.minimumAskDepthEth'),
		minimumBidDepthAttoEth: decimalEth(settings['minimumBidDepthEth'], 'centralizedMarkets.minimumBidDepthEth'),
		minimumSourceCount,
		orderBookLimit: integer(settings['orderBookLimit'], 'centralizedMarkets.orderBookLimit', 1, 1_000),
		requestTimeoutMilliseconds: integer(settings['requestTimeoutMilliseconds'], 'centralizedMarkets.requestTimeoutMilliseconds', 250, 60_000),
		requiredForExecution: settings['requiredForExecution'],
		sources,
		...(venueConsensus === undefined ? {} : { venueConsensus }),
	}
}

export function centralizedMarketConfigurationAllowsExecution(settings: CentralizedMarketSettings) {
	if (!settings.requiredForExecution) return true
	let validated: CentralizedMarketSettings
	try {
		validated = parseCentralizedMarketSettings(serializeCentralizedMarketSettings(settings))
	} catch (error) {
		void error
		return false
	}
	const venueConsensus = validated.venueConsensus
	const uniqueCexExchanges = new Set(validated.sources.map(source => source.exchangeId))
	const uniqueDexSources = new Set(venueConsensus?.dexSources.map(source => source.sourceId))
	const uniqueDexPairs = new Set(venueConsensus?.dexSources.map(source => source.pair.toLowerCase()))
	return (
		venueConsensus !== undefined &&
		validated.minimumSourceCount >= 2 &&
		uniqueCexExchanges.size === validated.sources.length &&
		validated.sources.length >= validated.minimumSourceCount &&
		venueConsensus.minimumDexSourceCount >= 2 &&
		uniqueDexSources.size === venueConsensus.dexSources.length &&
		uniqueDexPairs.size === venueConsensus.dexSources.length &&
		venueConsensus.dexSources.length >= venueConsensus.minimumDexSourceCount &&
		venueConsensus.minimumTotalSourceCount >= 3 &&
		validated.sources.length + venueConsensus.dexSources.length >= venueConsensus.minimumTotalSourceCount &&
		venueConsensus.minimumSourceObservationCount >= 2 &&
		venueConsensus.minimumSourceObservationSpanMilliseconds >= 1_000 &&
		venueConsensus.minimumSourceObservationSpanMilliseconds <= validated.maximumObservationAgeMilliseconds
	)
}

export function serializeCentralizedMarketSettings(settings: CentralizedMarketSettings) {
	return {
		assetAddress: settings.assetAddress,
		assetChainId: settings.assetChainId,
		assetSymbol: settings.assetSymbol,
		depthBps: bigintToSafeNumber(settings.depthBps, 'Depth basis points'),
		maximumDexDeviationBps: bigintToSafeNumber(settings.maximumDexDeviationBps, 'Maximum DEX deviation basis points'),
		maximumObservationAgeMilliseconds: settings.maximumObservationAgeMilliseconds,
		maximumVenueDispersionBps: bigintToSafeNumber(settings.maximumVenueDispersionBps, 'Maximum venue dispersion basis points'),
		minimumAskDepthEth: formatFixed(settings.minimumAskDepthAttoEth),
		minimumBidDepthEth: formatFixed(settings.minimumBidDepthAttoEth),
		minimumSourceCount: settings.minimumSourceCount,
		orderBookLimit: settings.orderBookLimit,
		requestTimeoutMilliseconds: settings.requestTimeoutMilliseconds,
		requiredForExecution: settings.requiredForExecution,
		sources: settings.sources.map(source => ({
			ethMarket: source.ethMarket ?? null,
			exchangeId: source.exchangeId,
			repMarket: source.repMarket,
		})),
		...(settings.venueConsensus === undefined
			? {}
			: {
					venueConsensus: {
						allowSingleGroupFallback: settings.venueConsensus.allowSingleGroupFallback,
						dexProbeDepthEth: formatFixed(settings.venueConsensus.dexProbeDepthAttoEth),
						dexSources: settings.venueConsensus.dexSources,
						maximumGroupDeviationBps: bigintToSafeNumber(settings.venueConsensus.maximumGroupDeviationBps, 'Maximum group deviation basis points'),
						minimumDexAskDepthEth: formatFixed(settings.venueConsensus.minimumDexAskDepthAttoEth),
						minimumDexBidDepthEth: formatFixed(settings.venueConsensus.minimumDexBidDepthAttoEth),
						minimumDexSourceCount: settings.venueConsensus.minimumDexSourceCount,
						minimumSourceObservationCount: settings.venueConsensus.minimumSourceObservationCount,
						minimumSourceObservationSpanMilliseconds: settings.venueConsensus.minimumSourceObservationSpanMilliseconds,
						minimumTotalSourceCount: settings.venueConsensus.minimumTotalSourceCount,
					},
				}),
	}
}

export function marketConsensusSettings(settings: CentralizedMarketSettings): MarketConsensusSettings {
	return {
		allowSingleGroupFallback: settings.venueConsensus?.allowSingleGroupFallback ?? false,
		maximumGroupDeviationBps: settings.venueConsensus?.maximumGroupDeviationBps ?? settings.maximumDexDeviationBps,
		maximumObservationAgeMilliseconds: settings.maximumObservationAgeMilliseconds,
		maximumVenueDispersionBps: settings.maximumVenueDispersionBps,
		minimumAskDepthAttoEthPerSource: settings.venueConsensus?.minimumDexAskDepthAttoEth ?? 0n,
		minimumBidDepthAttoEthPerSource: settings.venueConsensus?.minimumDexBidDepthAttoEth ?? 0n,
		minimumCexAskDepthAttoEth: settings.minimumAskDepthAttoEth,
		minimumCexBidDepthAttoEth: settings.minimumBidDepthAttoEth,
		minimumCexSourceCount: settings.minimumSourceCount,
		minimumDexSourceCount: settings.venueConsensus?.minimumDexSourceCount ?? 2,
		minimumSourceObservationCount: settings.venueConsensus?.minimumSourceObservationCount ?? 1,
		minimumSourceObservationSpanMilliseconds: settings.venueConsensus?.minimumSourceObservationSpanMilliseconds ?? 0,
		minimumTotalSourceCount: settings.venueConsensus?.minimumTotalSourceCount ?? 3,
	}
}

export function centralizedMarketConsensusObservations(estimate: CentralizedMarketEstimate | undefined): MarketConsensusObservation[] {
	if (estimate === undefined) return []
	return estimate.observations.flatMap(observation => {
		if (observation.orderBookTimestamp === undefined || (observation.usesEthTicker && observation.ethTickerTimestamp === undefined)) return []
		return [
			{
				assetId: observation.assetId,
				askDepthAttoEth: observation.askDepthAttoEth,
				bidDepthAttoEth: observation.bidDepthAttoEth,
				chainId: observation.chainId,
				kind: 'cex' as const,
				observationId: `${observation.exchangeId}:${observation.orderBookTimestamp.toString()}:${(observation.ethTickerTimestamp ?? observation.orderBookTimestamp).toString()}`,
				observedAt: Math.min(observation.orderBookTimestamp, observation.ethTickerTimestamp ?? observation.orderBookTimestamp),
				priceRepPerEth: observation.priceRepPerEth,
				sourceId: observation.exchangeId,
			},
		]
	})
}

function formatFixed(value: bigint) {
	const whole = value / FIXED_UNIT
	const fraction = (value % FIXED_UNIT).toString().padStart(18, '0').replace(/0+$/, '')
	return fraction === '' ? whole.toString() : `${whole.toString()}.${fraction}`
}

export function serializeCentralizedMarketEstimate(estimate: CentralizedMarketEstimate | undefined) {
	if (estimate === undefined) return undefined
	return {
		assetId: estimate.assetId,
		askDepthEth: formatFixed(estimate.askDepthAttoEth),
		bidDepthEth: formatFixed(estimate.bidDepthAttoEth),
		chainId: estimate.chainId,
		maximumPriceRepPerEth: formatFixed(estimate.maximumPriceRepPerEth),
		minimumPriceRepPerEth: formatFixed(estimate.minimumPriceRepPerEth),
		observations: estimate.observations.map(observation => ({
			askDepthEth: formatFixed(observation.askDepthAttoEth),
			bestAskQuote: observation.bestAskQuote,
			bestBidQuote: observation.bestBidQuote,
			bidDepthEth: formatFixed(observation.bidDepthAttoEth),
			chainId: observation.chainId,
			exchangeId: observation.exchangeId,
			ethTickerTimestamp: observation.ethTickerTimestamp === undefined ? undefined : new Date(observation.ethTickerTimestamp).toISOString(),
			observedAt: new Date(observation.observedAt).toISOString(),
			orderBookTimestamp: observation.orderBookTimestamp === undefined ? undefined : new Date(observation.orderBookTimestamp).toISOString(),
			priceRepPerEth: formatFixed(observation.priceRepPerEth),
			repMarket: observation.repMarket,
			usesEthTicker: observation.usesEthTicker,
		})),
		priceRepPerEth: formatFixed(estimate.priceRepPerEth),
		reasons: estimate.reasons,
		reliable: estimate.reliable,
	}
}

function requiredPositiveNumber(value: unknown, label: string) {
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`${label} is missing or invalid`)
	return value
}

function optionalTimestamp(value: unknown) {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined
}

function fixed(value: number, label: string) {
	if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} is not positive`)
	const roundedEightDecimals = Math.round(value * 1e8)
	if (!Number.isSafeInteger(roundedEightDecimals)) throw new Error(`${label} exceeds the supported market-data range`)
	return BigInt(roundedEightDecimals) * 10n ** 10n
}

function quoteDepth(levels: MarketOrderBook['bids'], midpoint: number, depthBps: bigint, side: 'ask' | 'bid') {
	const depth = bigintToSafeNumber(depthBps, 'Order-book depth basis points')
	const boundary = side === 'bid' ? midpoint * (1 - depth / 10_000) : midpoint * (1 + depth / 10_000)
	let quoteDepth = 0
	for (const [rawPrice, rawAmount] of levels) {
		const price = requiredPositiveNumber(rawPrice, `${side} price`)
		const amount = requiredPositiveNumber(rawAmount, `${side} amount`)
		if ((side === 'bid' && price < boundary) || (side === 'ask' && price > boundary)) continue
		quoteDepth += price * amount
	}
	return quoteDepth
}

function tickerPrice(ticker: MarketTicker) {
	const bid = typeof ticker.bid === 'number' && ticker.bid > 0 ? ticker.bid : undefined
	const ask = typeof ticker.ask === 'number' && ticker.ask > 0 ? ticker.ask : undefined
	if (bid !== undefined && ask !== undefined) return (bid + ask) / 2
	return requiredPositiveNumber(ticker.last, 'ETH reference ticker')
}

function ccxtExchangeFactory(exchangeId: string, timeoutMilliseconds: number): MarketExchange {
	const cacheKey = `${exchangeId}:${timeoutMilliseconds.toString()}`
	const cached = exchangeCache.get(cacheKey)
	if (cached !== undefined) return cached
	const candidate = Reflect.get(ccxt, exchangeId)
	if (typeof candidate !== 'function') throw new Error(`CCXT exchange ${exchangeId} is not supported`)
	const ExchangeConstructor = candidate as new (options: { enableRateLimit: boolean; timeout: number }) => Exchange
	const exchange = new ExchangeConstructor({ enableRateLimit: true, timeout: timeoutMilliseconds })
	const wrapped: MarketExchange = {
		fetchOrderBook: async (symbol, limit) => {
			const orderBook = await exchange.fetchOrderBook(symbol, limit)
			return {
				asks: orderBook.asks,
				bids: orderBook.bids,
				timestamp: optionalTimestamp(orderBook.timestamp),
			}
		},
		fetchTicker: async symbol => {
			const ticker = await exchange.fetchTicker(symbol)
			return {
				ask: ticker.ask,
				bid: ticker.bid,
				last: ticker.last,
				timestamp: optionalTimestamp(ticker.timestamp),
			}
		},
		loadMarkets: () => exchange.loadMarkets(),
	}
	exchangeCache.set(cacheKey, wrapped)
	return wrapped
}

async function observeSource(source: CentralizedMarketSource, settings: CentralizedMarketSettings, assetId: string, chainId: number, factory: CentralizedExchangeFactory, observedAt: number): Promise<CentralizedMarketObservation> {
	const exchange = factory(source.exchangeId, settings.requestTimeoutMilliseconds)
	await exchange.loadMarkets()
	const [orderBook, ethTicker] = await Promise.all([exchange.fetchOrderBook(source.repMarket, settings.orderBookLimit), source.ethMarket === undefined ? Promise.resolve(undefined) : exchange.fetchTicker(source.ethMarket)])
	const bestBid = requiredPositiveNumber(orderBook.bids[0]?.[0], `${source.exchangeId} best bid`)
	const bestAsk = requiredPositiveNumber(orderBook.asks[0]?.[0], `${source.exchangeId} best ask`)
	if (bestBid > bestAsk) throw new Error(`${source.exchangeId} order book is crossed`)
	const midpoint = (bestBid + bestAsk) / 2
	const quotePerEth = ethTicker === undefined ? 1 : tickerPrice(ethTicker)
	const bidDepthAttoEth = quoteDepth(orderBook.bids, midpoint, settings.depthBps, 'bid') / quotePerEth
	const askDepthAttoEth = quoteDepth(orderBook.asks, midpoint, settings.depthBps, 'ask') / quotePerEth
	return {
		assetId,
		askDepthAttoEth: fixed(askDepthAttoEth, `${source.exchangeId} ask depth`),
		bestAskQuote: bestAsk.toString(),
		bestBidQuote: bestBid.toString(),
		bidDepthAttoEth: fixed(bidDepthAttoEth, `${source.exchangeId} bid depth`),
		chainId,
		exchangeId: source.exchangeId,
		ethTickerTimestamp: optionalTimestamp(ethTicker?.timestamp),
		observedAt,
		orderBookTimestamp: optionalTimestamp(orderBook.timestamp),
		priceRepPerEth: fixed(quotePerEth / midpoint, `${source.exchangeId} REP/ETH price`),
		repMarket: source.repMarket,
		usesEthTicker: ethTicker !== undefined,
	}
}

function median(values: readonly bigint[]) {
	if (values.length === 0) throw new Error('Cannot calculate a median without observations')
	const sorted = [...values].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
	const middle = Math.floor(sorted.length / 2)
	const upper = sorted[middle]
	if (upper === undefined) throw new Error('Median observation disappeared')
	if (sorted.length % 2 === 1) return upper
	const lower = sorted[middle - 1]
	if (lower === undefined) throw new Error('Median observation disappeared')
	return (lower + upper) / 2n
}

export function aggregateCentralizedMarketObservations(observations: readonly CentralizedMarketObservation[], settings: CentralizedMarketSettings, assetId: string, now = Date.now()): CentralizedMarketEstimate | undefined {
	if (settings.sources.length === 0 && observations.length === 0) return undefined
	if (settings.assetAddress.toLowerCase() !== assetId.toLowerCase() || observations.some(observation => observation.assetId.toLowerCase() !== assetId.toLowerCase() || observation.chainId !== settings.assetChainId)) {
		throw new Error('Centralized market observations must describe one exact REP asset and chain')
	}
	const fresh = observations.filter(observation => {
		if (settings.requiredForExecution && (observation.orderBookTimestamp === undefined || (observation.usesEthTicker && observation.ethTickerTimestamp === undefined))) return false
		const timestamps = [observation.orderBookTimestamp ?? observation.observedAt, ...(observation.usesEthTicker ? [observation.ethTickerTimestamp ?? observation.observedAt] : [])]
		return timestamps.every(timestamp => timestamp <= now && now - timestamp <= settings.maximumObservationAgeMilliseconds)
	})
	const reasons: string[] = []
	if (fresh.length < settings.minimumSourceCount) reasons.push(`Only ${fresh.length.toString()} fresh CEX source(s); ${settings.minimumSourceCount.toString()} required`)
	if (fresh.length === 0) {
		return {
			assetId,
			askDepthAttoEth: 0n,
			bidDepthAttoEth: 0n,
			chainId: settings.assetChainId,
			maximumPriceRepPerEth: 0n,
			minimumPriceRepPerEth: 0n,
			observations: fresh,
			priceRepPerEth: 0n,
			reliable: false,
			reasons,
		}
	}
	const prices = fresh.map(observation => observation.priceRepPerEth)
	const minimumPriceRepPerEth = prices.reduce((minimum, price) => (price < minimum ? price : minimum))
	const maximumPriceRepPerEth = prices.reduce((maximum, price) => (price > maximum ? price : maximum))
	const priceRepPerEth = median(prices)
	const dispersionBps = priceRepPerEth === 0n ? BPS : ((maximumPriceRepPerEth - minimumPriceRepPerEth) * BPS) / priceRepPerEth
	if (dispersionBps > settings.maximumVenueDispersionBps) reasons.push(`CEX venue dispersion is ${dispersionBps.toString()} bps`)
	const bidDepthAttoEth = fresh.reduce((total, observation) => total + observation.bidDepthAttoEth, 0n)
	const askDepthAttoEth = fresh.reduce((total, observation) => total + observation.askDepthAttoEth, 0n)
	if (bidDepthAttoEth < settings.minimumBidDepthAttoEth) reasons.push('CEX bid depth is below the configured minimum')
	if (askDepthAttoEth < settings.minimumAskDepthAttoEth) reasons.push('CEX ask depth is below the configured minimum')
	return {
		assetId,
		askDepthAttoEth,
		bidDepthAttoEth,
		chainId: settings.assetChainId,
		maximumPriceRepPerEth,
		minimumPriceRepPerEth,
		observations: fresh,
		priceRepPerEth,
		reliable: reasons.length === 0,
		reasons,
	}
}

export async function observeCentralizedMarkets(settings: CentralizedMarketSettings, assetId: string, chainId: number, factory: CentralizedExchangeFactory = ccxtExchangeFactory, now?: number): Promise<CentralizedMarketEstimate | undefined> {
	if (settings.sources.length === 0) return undefined
	if (settings.assetAddress.toLowerCase() !== assetId.toLowerCase() || settings.assetChainId !== chainId) throw new Error('Centralized market configuration does not match the exact REP asset and chain')
	const observedAt = now ?? Date.now()
	const settled = await Promise.allSettled(settings.sources.map(source => observeSource(source, settings, assetId, chainId, factory, observedAt)))
	const observations = settled.flatMap(result => (result.status === 'fulfilled' ? [result.value] : []))
	const estimate = aggregateCentralizedMarketObservations(observations, settings, assetId, now ?? Date.now())
	if (estimate === undefined) return undefined
	const errors = settled.flatMap((result, index) => {
		if (result.status === 'fulfilled') return []
		const source = settings.sources[index]
		return [`${source?.exchangeId ?? 'Unknown exchange'} observation unavailable`]
	})
	return errors.length === 0 ? estimate : { ...estimate, reasons: [...estimate.reasons, ...errors] }
}

export function centralizedPriceDeviationBps(priceRepPerEth: bigint, estimate: CentralizedMarketEstimate, assetId: string) {
	if (estimate.assetId.toLowerCase() !== assetId.toLowerCase()) return undefined
	if (priceRepPerEth <= 0n || estimate.priceRepPerEth <= 0n) return undefined
	const distance = priceRepPerEth > estimate.priceRepPerEth ? priceRepPerEth - estimate.priceRepPerEth : estimate.priceRepPerEth - priceRepPerEth
	return (distance * BPS) / estimate.priceRepPerEth
}

export function centralizedPriceAllowsExecution(priceRepPerEth: bigint, estimate: CentralizedMarketEstimate | undefined, settings: CentralizedMarketSettings, assetId: string, now = Date.now()) {
	if (!centralizedMarketConfigurationAllowsExecution(settings)) return false
	if (estimate === undefined) return !settings.requiredForExecution
	if (estimate.assetId.toLowerCase() !== assetId.toLowerCase() || estimate.chainId !== settings.assetChainId) return !settings.requiredForExecution
	if (!estimate.reliable) return !settings.requiredForExecution
	if (
		estimate.observations.some(observation => {
			if (settings.requiredForExecution && (observation.orderBookTimestamp === undefined || (observation.usesEthTicker && observation.ethTickerTimestamp === undefined))) return true
			const timestamps = [observation.orderBookTimestamp ?? observation.observedAt, ...(observation.usesEthTicker ? [observation.ethTickerTimestamp ?? observation.observedAt] : [])]
			return timestamps.some(timestamp => timestamp > now || now - timestamp > settings.maximumObservationAgeMilliseconds)
		})
	) {
		return !settings.requiredForExecution
	}
	const deviationBps = centralizedPriceDeviationBps(priceRepPerEth, estimate, assetId)
	if (deviationBps === undefined) return !settings.requiredForExecution
	return deviationBps <= settings.maximumDexDeviationBps
}
