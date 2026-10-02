import type { LiveMarket } from '../../protocol/live.js'

/** One wallet read at a time. Repeated partial discovery snapshots reuse the same work for an unchanged pool. */
export function createPortfolioReadQueue<T>(read: (market: LiveMarket) => Promise<T>) {
	const reads = new WeakMap<LiveMarket, Promise<T>>()
	let tail = Promise.resolve()
	return (market: LiveMarket) => {
		const existing = reads.get(market)
		if (existing !== undefined) return existing
		const pending = tail.then(() => read(market))
		reads.set(market, pending)
		tail = pending.then(
			() => undefined,
			() => undefined,
		)
		return pending
	}
}
