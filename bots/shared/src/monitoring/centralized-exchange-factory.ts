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

export function createCentralizedExchangeFactory(constructors: Readonly<Record<string, ExchangeConstructor>>): CentralizedExchangeFactory {
	const cache = new Map<string, MarketExchange>()
	return (exchangeId, timeoutMilliseconds) => {
		const cacheKey = `${exchangeId}:${timeoutMilliseconds.toString()}`
		const cached = cache.get(cacheKey)
		if (cached !== undefined) return cached
		const Constructor = Object.hasOwn(constructors, exchangeId) ? constructors[exchangeId] : undefined
		if (Constructor === undefined) throw new Error(`Exchange ${exchangeId} is not supported`)
		const exchange = new Constructor({ enableRateLimit: true, timeout: timeoutMilliseconds })
		const wrapped: MarketExchange = {
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
