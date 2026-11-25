import type { CentralizedExchangeFactory, MarketExchange } from './centralized-markets.ts'

type ExchangeClient = {
	fetchOrderBook: (
		symbol: string,
		limit: number,
	) => Promise<{
		asks: [number | undefined, number | undefined][]
		bids: [number | undefined, number | undefined][]
		timestamp?: number | undefined
	}>
	fetchTicker: (symbol: string) => Promise<{
		ask?: number | undefined
		bid?: number | undefined
		last?: number | undefined
		timestamp?: number | undefined
	}>
	loadMarkets: () => Promise<unknown>
}

type ExchangeConstructor = new (options: { enableRateLimit: boolean; timeout: number }) => ExchangeClient

export function createCentralizedExchangeFactory(constructors: Readonly<Record<string, ExchangeConstructor>>, mappings = ''): CentralizedExchangeFactory {
	// A venue book has exactly one settlement identity, even when several universes use REP.
	const verified = new Map<string, string>()
	for (const entry of mappings
		.split(',')
		.map(value => value.trim())
		.filter(Boolean)) {
		const match = /^([a-z0-9]+:[A-Z0-9._-]+\/[A-Z0-9._-]+)=([1-9]\d*):(0x[0-9a-fA-F]{40})$/.exec(entry)
		if (!match || !match[1] || !match[3] || verified.has(match[1])) throw new Error('Invalid or duplicate venue mapping in ZOLTAR_BOT_VERIFIED_MARKETS')
		verified.set(match[1], `${match[2]}:${match[3].toLowerCase()}`)
	}
	const cache = new Map<string, MarketExchange>()
	return (exchangeId, timeoutMilliseconds) => {
		const cacheKey = `${exchangeId}:${timeoutMilliseconds.toString()}`
		const cached = cache.get(cacheKey)
		if (cached !== undefined) return cached
		const Constructor = Object.hasOwn(constructors, exchangeId) ? constructors[exchangeId] : undefined
		if (Constructor === undefined) throw new Error(`Exchange ${exchangeId} is not supported`)
		const exchange = new Constructor({ enableRateLimit: true, timeout: timeoutMilliseconds })
		const wrapped: MarketExchange = {
			settlesAsset: (market, assetId, chainId) => verified.get(`${exchangeId}:${market}`) === `${chainId.toString()}:${assetId.toLowerCase()}`,
			fetchOrderBook: async (symbol, limit) => {
				const book = await exchange.fetchOrderBook(symbol, limit)
				return { asks: book.asks, bids: book.bids, timestamp: book.timestamp }
			},
			fetchTicker: async symbol => {
				const ticker = await exchange.fetchTicker(symbol)
				return { ask: ticker.ask, bid: ticker.bid, last: ticker.last, timestamp: ticker.timestamp }
			},
			loadMarkets: () => exchange.loadMarkets(),
		}
		cache.set(cacheKey, wrapped)
		return wrapped
	}
}
