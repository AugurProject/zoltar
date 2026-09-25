/**
 * One block watcher per application. A single poller reads the latest block on an interval that suits the
 * environment, pauses while the page is hidden, and polls immediately when the page becomes visible again.
 * Subscribers hear about each new block, and about explicit invalidations such as a finished transaction or a
 * simulation control, so they can refresh their data in place instead of running timers of their own.
 */

export type BlockWatcherEvent = { blockNumber: bigint | undefined; reason: 'block' | 'invalidate' }

export type BlockWatcherEnvironment = {
	isHidden: () => boolean
	/** Schedules a callback and returns a function that cancels it. */
	schedule: (callback: () => void, milliseconds: number) => () => void
	subscribeVisibility: (listener: () => void) => () => void
}

/** Reads the latest block number; `undefined` means the chain is not readable yet. */
type BlockPoller = () => Promise<bigint | undefined>

export function createBlockWatcher(environment: BlockWatcherEnvironment) {
	const listeners = new Set<(event: BlockWatcherEvent) => void>()
	let active: { intervalMilliseconds: number; poll: BlockPoller } | undefined
	let latestBlockNumber: bigint | undefined
	let inFlight: { owner: object; promise: Promise<void> } | undefined
	let cancelTimer: (() => void) | undefined
	let unsubscribeVisibility: (() => void) | undefined

	const emit = (event: BlockWatcherEvent) => {
		for (const listener of [...listeners]) listener(event)
	}
	const clearTimer = () => {
		cancelTimer?.()
		cancelTimer = undefined
	}
	const reportBlock = (blockNumber: bigint | undefined) => {
		if (blockNumber === undefined || blockNumber === latestBlockNumber) return
		const previous = latestBlockNumber
		latestBlockNumber = blockNumber
		// The first observed block only establishes the baseline; the data it describes was loaded on mount.
		if (previous !== undefined) emit({ blockNumber, reason: 'block' })
	}
	const poll = () => {
		const current = active
		if (current === undefined) return Promise.resolve()
		if (inFlight !== undefined && inFlight.owner === current) return inFlight.promise
		const promise = (async () => {
			try {
				const blockNumber = await current.poll()
				if (active === current) reportBlock(blockNumber)
			} catch (error) {
				// A failed read keeps the last block; the owner of the poller surfaces its own read errors.
				void error
			}
		})()
		const request = { owner: current, promise }
		inFlight = request
		void promise.finally(() => {
			if (inFlight === request) inFlight = undefined
		})
		return promise
	}
	const scheduleNext = () => {
		clearTimer()
		const current = active
		if (current === undefined || environment.isHidden()) return
		cancelTimer = environment.schedule(() => {
			cancelTimer = undefined
			void poll().then(() => {
				if (active === current && cancelTimer === undefined) scheduleNext()
			})
		}, current.intervalMilliseconds)
	}
	const refresh = async () => {
		clearTimer()
		await poll()
		scheduleNext()
	}
	const handleVisibilityChange = () => {
		if (environment.isHidden()) {
			clearTimer()
			return
		}
		void refresh()
	}

	return {
		/** Replaces the active poller, polls immediately, and returns a function that stops it. */
		start(pollBlock: BlockPoller, intervalMilliseconds: number) {
			const current = { intervalMilliseconds, poll: pollBlock }
			active = current
			latestBlockNumber = undefined
			unsubscribeVisibility?.()
			unsubscribeVisibility = environment.subscribeVisibility(handleVisibilityChange)
			if (!environment.isHidden()) void refresh()
			return () => {
				if (active !== current) return
				active = undefined
				latestBlockNumber = undefined
				clearTimer()
				unsubscribeVisibility?.()
				unsubscribeVisibility = undefined
			}
		},
		/** Polls now, for example after a simulation control or a transaction changed the chain. */
		refresh,
		/** Tells subscribers to reload even when the block number did not change. */
		invalidate() {
			emit({ blockNumber: latestBlockNumber, reason: 'invalidate' })
		},
		/** Records a block number observed elsewhere, such as a chain clock read. */
		reportBlock,
		subscribe(listener: (event: BlockWatcherEvent) => void) {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		},
		getLatestBlockNumber: () => latestBlockNumber,
		isRunning: () => active !== undefined,
	}
}

export function createDocumentBlockWatcherEnvironment(): BlockWatcherEnvironment {
	return {
		isHidden: () => typeof document !== 'undefined' && document.hidden,
		schedule: (callback, milliseconds) => {
			const handle = setTimeout(callback, milliseconds)
			return () => clearTimeout(handle)
		},
		subscribeVisibility: listener => {
			if (typeof document === 'undefined') return () => undefined
			document.addEventListener('visibilitychange', listener)
			return () => document.removeEventListener('visibilitychange', listener)
		},
	}
}
