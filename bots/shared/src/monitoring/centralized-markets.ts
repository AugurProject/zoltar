import ccxt, { type Exchange } from 'ccxt'

const FIXED_UNIT = 10n ** 18n
const BPS = 10_000n

export type CentralizedMarketSource = {
	ethMarket: string | undefined
	exchangeId: string
	repMarket: string
}

export type CentralizedMarketSettings = {
	depthBps: bigint
	maximumDexDeviationBps: bigint
	maximumObservationAgeMilliseconds: number
	maximumVenueDispersionBps: bigint
	minimumAskDepthEth: bigint
	minimumBidDepthEth: bigint
	minimumSourceCount: number
	orderBookLimit: number
	requestTimeoutMilliseconds: number
	requiredForExecution: boolean
	sources: readonly CentralizedMarketSource[]
}

export type CentralizedMarketObservation = {
	askDepthEth: bigint
	bestAskQuote: string
	bestBidQuote: string
	bidDepthEth: bigint
	exchangeId: string
	observedAt: number
	priceRepPerEth: bigint
	repMarket: string
	sourceTimestamp: number | undefined
}

export type CentralizedMarketEstimate = {
	askDepthEth: bigint
	bidDepthEth: bigint
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

export function parseCentralizedMarketSettings(value: unknown): CentralizedMarketSettings {
	const settings = record(value, 'centralizedMarkets')
	const allowed = new Set(['depthBps', 'maximumDexDeviationBps', 'maximumObservationAgeMilliseconds', 'maximumVenueDispersionBps', 'minimumAskDepthEth', 'minimumBidDepthEth', 'minimumSourceCount', 'orderBookLimit', 'requestTimeoutMilliseconds', 'requiredForExecution', 'sources'])
	for (const key of Object.keys(settings)) {
		if (!allowed.has(key)) throw new Error(`Unknown centralizedMarkets field: ${key}`)
	}
	for (const key of allowed) {
		if (!(key in settings)) throw new Error(`centralizedMarkets is missing ${key}`)
	}
	if (!Array.isArray(settings['sources'])) throw new Error('centralizedMarkets.sources must be an array')
	const sources = settings['sources'].map((rawSource, index) => {
		const source = record(rawSource, `centralizedMarkets.sources[${index.toString()}]`)
		if (Object.keys(source).some(key => key !== 'exchangeId' && key !== 'repMarket' && key !== 'ethMarket')) {
			throw new Error(`centralizedMarkets.sources[${index.toString()}] has an unknown field`)
		}
		if (typeof source['exchangeId'] !== 'string' || !/^[a-z0-9]+$/.test(source['exchangeId'])) {
			throw new Error(`centralizedMarkets.sources[${index.toString()}].exchangeId must be a lowercase CCXT exchange id`)
		}
		const repMarket = market(source['repMarket'], `centralizedMarkets.sources[${index.toString()}].repMarket`)
		const quoteAsset = repMarket.split('/')[1]
		const ethMarket = source['ethMarket'] === null || source['ethMarket'] === undefined ? undefined : market(source['ethMarket'], `centralizedMarkets.sources[${index.toString()}].ethMarket`)
		if (quoteAsset !== 'ETH' && ethMarket === undefined) {
			throw new Error(`centralizedMarkets.sources[${index.toString()}].ethMarket is required unless REP is quoted in ETH`)
		}
		if (ethMarket !== undefined && ethMarket.split('/')[1] !== quoteAsset) {
			throw new Error(`centralizedMarkets.sources[${index.toString()}] markets must share a quote asset`)
		}
		return { ethMarket, exchangeId: source['exchangeId'], repMarket }
	})
	const uniqueSources = new Set(sources.map(source => `${source.exchangeId}:${source.repMarket}:${source.ethMarket ?? ''}`))
	if (uniqueSources.size !== sources.length) throw new Error('centralizedMarkets.sources must not contain duplicates')
	const uniqueExchanges = new Set(sources.map(source => source.exchangeId))
	if (uniqueExchanges.size !== sources.length) throw new Error('centralizedMarkets.sources must use distinct exchanges')
	const depthBps = BigInt(integer(settings['depthBps'], 'centralizedMarkets.depthBps', 1, 5_000))
	const maximumDexDeviationBps = BigInt(integer(settings['maximumDexDeviationBps'], 'centralizedMarkets.maximumDexDeviationBps', 1, 10_000))
	const maximumVenueDispersionBps = BigInt(integer(settings['maximumVenueDispersionBps'], 'centralizedMarkets.maximumVenueDispersionBps', 1, 10_000))
	const minimumSourceCount = integer(settings['minimumSourceCount'], 'centralizedMarkets.minimumSourceCount', 1, 100)
	if (sources.length > 0 && minimumSourceCount > sources.length) throw new Error('centralizedMarkets.minimumSourceCount cannot exceed the configured source count')
	if (typeof settings['requiredForExecution'] !== 'boolean') throw new Error('centralizedMarkets.requiredForExecution must be a boolean')
	if (settings['requiredForExecution'] && sources.length === 0) throw new Error('centralizedMarkets.requiredForExecution needs at least one source')
	if (settings['requiredForExecution'] && minimumSourceCount < 2) throw new Error('centralizedMarkets.requiredForExecution needs at least two independent sources')
	return {
		depthBps,
		maximumDexDeviationBps,
		maximumObservationAgeMilliseconds: integer(settings['maximumObservationAgeMilliseconds'], 'centralizedMarkets.maximumObservationAgeMilliseconds', 1_000, 3_600_000),
		maximumVenueDispersionBps,
		minimumAskDepthEth: decimalEth(settings['minimumAskDepthEth'], 'centralizedMarkets.minimumAskDepthEth'),
		minimumBidDepthEth: decimalEth(settings['minimumBidDepthEth'], 'centralizedMarkets.minimumBidDepthEth'),
		minimumSourceCount,
		orderBookLimit: integer(settings['orderBookLimit'], 'centralizedMarkets.orderBookLimit', 1, 1_000),
		requestTimeoutMilliseconds: integer(settings['requestTimeoutMilliseconds'], 'centralizedMarkets.requestTimeoutMilliseconds', 250, 60_000),
		requiredForExecution: settings['requiredForExecution'],
		sources,
	}
}

export function serializeCentralizedMarketSettings(settings: CentralizedMarketSettings) {
	return {
		depthBps: Number(settings.depthBps),
		maximumDexDeviationBps: Number(settings.maximumDexDeviationBps),
		maximumObservationAgeMilliseconds: settings.maximumObservationAgeMilliseconds,
		maximumVenueDispersionBps: Number(settings.maximumVenueDispersionBps),
		minimumAskDepthEth: formatFixed(settings.minimumAskDepthEth),
		minimumBidDepthEth: formatFixed(settings.minimumBidDepthEth),
		minimumSourceCount: settings.minimumSourceCount,
		orderBookLimit: settings.orderBookLimit,
		requestTimeoutMilliseconds: settings.requestTimeoutMilliseconds,
		requiredForExecution: settings.requiredForExecution,
		sources: settings.sources.map(source => ({
			ethMarket: source.ethMarket ?? null,
			exchangeId: source.exchangeId,
			repMarket: source.repMarket,
		})),
	}
}

function formatFixed(value: bigint) {
	const whole = value / FIXED_UNIT
	const fraction = (value % FIXED_UNIT).toString().padStart(18, '0').replace(/0+$/, '')
	return fraction === '' ? whole.toString() : `${whole.toString()}.${fraction}`
}

export function serializeCentralizedMarketEstimate(estimate: CentralizedMarketEstimate | undefined) {
	if (estimate === undefined) return undefined
	return {
		askDepthEth: formatFixed(estimate.askDepthEth),
		bidDepthEth: formatFixed(estimate.bidDepthEth),
		maximumPriceRepPerEth: formatFixed(estimate.maximumPriceRepPerEth),
		minimumPriceRepPerEth: formatFixed(estimate.minimumPriceRepPerEth),
		observations: estimate.observations.map(observation => ({
			askDepthEth: formatFixed(observation.askDepthEth),
			bestAskQuote: observation.bestAskQuote,
			bestBidQuote: observation.bestBidQuote,
			bidDepthEth: formatFixed(observation.bidDepthEth),
			exchangeId: observation.exchangeId,
			observedAt: new Date(observation.observedAt).toISOString(),
			priceRepPerEth: formatFixed(observation.priceRepPerEth),
			repMarket: observation.repMarket,
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
	const boundary = side === 'bid' ? midpoint * (1 - Number(depthBps) / 10_000) : midpoint * (1 + Number(depthBps) / 10_000)
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
			}
		},
		loadMarkets: () => exchange.loadMarkets(),
	}
	exchangeCache.set(cacheKey, wrapped)
	return wrapped
}

async function observeSource(source: CentralizedMarketSource, settings: CentralizedMarketSettings, factory: CentralizedExchangeFactory, observedAt: number): Promise<CentralizedMarketObservation> {
	const exchange = factory(source.exchangeId, settings.requestTimeoutMilliseconds)
	await exchange.loadMarkets()
	const [orderBook, ethTicker] = await Promise.all([exchange.fetchOrderBook(source.repMarket, settings.orderBookLimit), source.ethMarket === undefined ? Promise.resolve(undefined) : exchange.fetchTicker(source.ethMarket)])
	const bestBid = requiredPositiveNumber(orderBook.bids[0]?.[0], `${source.exchangeId} best bid`)
	const bestAsk = requiredPositiveNumber(orderBook.asks[0]?.[0], `${source.exchangeId} best ask`)
	if (bestBid > bestAsk) throw new Error(`${source.exchangeId} order book is crossed`)
	const midpoint = (bestBid + bestAsk) / 2
	const quotePerEth = ethTicker === undefined ? 1 : tickerPrice(ethTicker)
	const bidDepthEth = quoteDepth(orderBook.bids, midpoint, settings.depthBps, 'bid') / quotePerEth
	const askDepthEth = quoteDepth(orderBook.asks, midpoint, settings.depthBps, 'ask') / quotePerEth
	return {
		askDepthEth: fixed(askDepthEth, `${source.exchangeId} ask depth`),
		bestAskQuote: bestAsk.toString(),
		bestBidQuote: bestBid.toString(),
		bidDepthEth: fixed(bidDepthEth, `${source.exchangeId} bid depth`),
		exchangeId: source.exchangeId,
		observedAt,
		priceRepPerEth: fixed(quotePerEth / midpoint, `${source.exchangeId} REP/ETH price`),
		repMarket: source.repMarket,
		sourceTimestamp: optionalTimestamp(orderBook.timestamp),
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

export function aggregateCentralizedMarketObservations(observations: readonly CentralizedMarketObservation[], settings: CentralizedMarketSettings, now = Date.now()): CentralizedMarketEstimate | undefined {
	if (settings.sources.length === 0 && observations.length === 0) return undefined
	const fresh = observations.filter(observation => {
		const timestamp = observation.sourceTimestamp ?? observation.observedAt
		return timestamp <= now && now - timestamp <= settings.maximumObservationAgeMilliseconds
	})
	const reasons: string[] = []
	if (fresh.length < settings.minimumSourceCount) reasons.push(`Only ${fresh.length.toString()} fresh CEX source(s); ${settings.minimumSourceCount.toString()} required`)
	if (fresh.length === 0) {
		return {
			askDepthEth: 0n,
			bidDepthEth: 0n,
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
	const bidDepthEth = fresh.reduce((total, observation) => total + observation.bidDepthEth, 0n)
	const askDepthEth = fresh.reduce((total, observation) => total + observation.askDepthEth, 0n)
	if (bidDepthEth < settings.minimumBidDepthEth) reasons.push('CEX bid depth is below the configured minimum')
	if (askDepthEth < settings.minimumAskDepthEth) reasons.push('CEX ask depth is below the configured minimum')
	return {
		askDepthEth,
		bidDepthEth,
		maximumPriceRepPerEth,
		minimumPriceRepPerEth,
		observations: fresh,
		priceRepPerEth,
		reliable: reasons.length === 0,
		reasons,
	}
}

export async function observeCentralizedMarkets(settings: CentralizedMarketSettings, factory: CentralizedExchangeFactory = ccxtExchangeFactory, now = Date.now()): Promise<CentralizedMarketEstimate | undefined> {
	if (settings.sources.length === 0) return undefined
	const settled = await Promise.allSettled(settings.sources.map(source => observeSource(source, settings, factory, now)))
	const observations = settled.flatMap(result => (result.status === 'fulfilled' ? [result.value] : []))
	const estimate = aggregateCentralizedMarketObservations(observations, settings, now)
	if (estimate === undefined) return undefined
	const errors = settled.flatMap((result, index) => {
		if (result.status === 'fulfilled') return []
		const source = settings.sources[index]
		return [`${source?.exchangeId ?? 'unknown'}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`]
	})
	return errors.length === 0 ? estimate : { ...estimate, reasons: [...estimate.reasons, ...errors] }
}

export function centralizedPriceDeviationBps(priceRepPerEth: bigint, estimate: CentralizedMarketEstimate) {
	if (priceRepPerEth <= 0n || estimate.priceRepPerEth <= 0n) return undefined
	const distance = priceRepPerEth > estimate.priceRepPerEth ? priceRepPerEth - estimate.priceRepPerEth : estimate.priceRepPerEth - priceRepPerEth
	return (distance * BPS) / estimate.priceRepPerEth
}

export function centralizedPriceAllowsExecution(priceRepPerEth: bigint, estimate: CentralizedMarketEstimate | undefined, settings: CentralizedMarketSettings, now = Date.now()) {
	if (estimate === undefined) return !settings.requiredForExecution
	if (!estimate.reliable) return !settings.requiredForExecution
	if (
		estimate.observations.some(observation => {
			const timestamp = observation.sourceTimestamp ?? observation.observedAt
			return timestamp > now || now - timestamp > settings.maximumObservationAgeMilliseconds
		})
	) {
		return !settings.requiredForExecution
	}
	const deviationBps = centralizedPriceDeviationBps(priceRepPerEth, estimate)
	if (deviationBps === undefined) return !settings.requiredForExecution
	return deviationBps <= settings.maximumDexDeviationBps
}
