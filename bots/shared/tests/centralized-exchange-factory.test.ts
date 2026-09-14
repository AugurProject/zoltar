import { expect, test } from 'bun:test'
import { createCentralizedExchangeFactory } from '../src/monitoring/centralized-exchange-factory.ts'

test('exchange adapters cache per venue and timeout while preserving method receivers and missing timestamps', async () => {
	const constructed: { enableRateLimit: boolean; timeout: number }[] = []
	class Exchange {
		constructor(readonly options: { enableRateLimit: boolean; timeout: number }) {
			constructed.push(options)
		}
		async loadMarkets() {
			return this.options.timeout
		}
		async fetchOrderBook(symbol: string, limit: number) {
			expect(symbol).toBe('REP/ETH')
			expect(limit).toBe(20)
			return { asks: [[2, 3] satisfies [number, number]], bids: [[1, 4] satisfies [number, number]], timestamp: this.options.timeout }
		}
		async fetchTicker(symbol: string) {
			expect(symbol).toBe('ETH/USD')
			return { last: this.options.timeout }
		}
	}
	const factory = createCentralizedExchangeFactory({ first: Exchange, second: Exchange })
	const first = factory('first', 100)
	expect(factory('first', 100)).toBe(first)
	expect(factory('first', 200)).not.toBe(first)
	expect(factory('second', 100)).not.toBe(first)
	expect(constructed).toEqual([
		{ enableRateLimit: true, timeout: 100 },
		{ enableRateLimit: true, timeout: 200 },
		{ enableRateLimit: true, timeout: 100 },
	])
	expect(await first.loadMarkets()).toBe(100)
	expect(await first.fetchOrderBook('REP/ETH', 20)).toEqual({ asks: [[2, 3]], bids: [[1, 4]], timestamp: 100 })
	expect(await first.fetchTicker('ETH/USD')).toEqual({ ask: undefined, bid: undefined, last: 100, timestamp: undefined })
	for (const id of ['missing', 'constructor', 'toString']) expect(() => factory(id, 100)).toThrow(`Exchange ${id} is not supported`)
})

test('exchange construction and request failures propagate to the observation layer', async () => {
	class Exchange {
		async loadMarkets(): Promise<never> {
			throw new Error('markets unavailable')
		}
		async fetchOrderBook(): Promise<never> {
			throw new Error('book unavailable')
		}
		async fetchTicker(): Promise<never> {
			throw new Error('ticker unavailable')
		}
	}
	const exchange = createCentralizedExchangeFactory({ example: Exchange })('example', 100)
	await expect(exchange.loadMarkets()).rejects.toThrow('markets unavailable')
	await expect(exchange.fetchOrderBook('REP/ETH', 20)).rejects.toThrow('book unavailable')
	await expect(exchange.fetchTicker('ETH/USD')).rejects.toThrow('ticker unavailable')
})
