export type ObservedHead = {
	hash: `0x${string}`
	number: bigint
	timestamp: bigint
}

export type HeadWatcherOptions = {
	intervalMilliseconds: number
	isStopping?: (() => boolean) | undefined
	onError: (error: unknown) => void
	onHead: (head: ObservedHead, previous: ObservedHead | undefined) => void
	readBlock: (blockNumber: bigint) => Promise<ObservedHead>
	readBlockNumber: () => Promise<bigint | undefined>
}

export type HeadWaitResult = 'head' | 'stopped' | 'timeout'

function validatedInterval(value: number) {
	if (!Number.isSafeInteger(value) || value < 1) throw new Error('Head watcher interval must be a positive integer')
	return value
}

/**
 * Follows the chain head on a short interval so every new block is observed and reported promptly,
 * independently of how long the scan that consumes the head takes. Only `eth_blockNumber` is issued
 * on every tick; the block itself is read once per new height.
 */
export function createHeadWatcher(options: HeadWatcherOptions) {
	const intervalMilliseconds = validatedInterval(options.intervalMilliseconds)
	let latest: ObservedHead | undefined
	let stopped = false
	let running: Promise<void> | undefined
	let interruptSleep: (() => void) | undefined
	const waiters = new Set<(result: HeadWaitResult) => void>()
	const notify = (result: HeadWaitResult) => {
		for (const waiter of [...waiters]) waiter(result)
	}
	// A watcher that still trails the scanned head must not wake the scan; only a taller head or a replaced block does.
	const headIsNewer = (head: ObservedHead, scanned: Pick<ObservedHead, 'hash' | 'number'> | undefined) => scanned === undefined || head.number > scanned.number || (head.number === scanned.number && head.hash !== scanned.hash)
	const stopping = () => stopped || options.isStopping?.() === true
	const sleep = () =>
		new Promise<void>(resolve => {
			const timer = setTimeout(() => {
				interruptSleep = undefined
				resolve()
			}, intervalMilliseconds)
			interruptSleep = () => {
				clearTimeout(timer)
				interruptSleep = undefined
				resolve()
			}
		})
	const tick = async () => {
		try {
			const blockNumber = await options.readBlockNumber()
			if (blockNumber === undefined || stopping()) return
			// A failover to a lagging endpoint can report a lower height; the watcher only ever moves forward.
			if (latest !== undefined && blockNumber <= latest.number) return
			const head = await options.readBlock(blockNumber)
			if (stopping()) return
			if (latest !== undefined && head.number <= latest.number) return
			const previous = latest
			latest = head
			options.onHead(head, previous)
			notify('head')
		} catch (error) {
			if (!stopping()) options.onError(error)
		}
	}
	return {
		latest: () => latest,
		start: () => {
			if (running !== undefined) return
			running = (async () => {
				while (!stopping()) {
					await tick()
					if (stopping()) break
					await sleep()
				}
				notify('stopped')
			})()
		},
		stop: async () => {
			stopped = true
			interruptSleep?.()
			notify('stopped')
			await running
		},
		/**
		 * Resolves as soon as the watcher has observed a head that differs from `scanned`, or after
		 * `timeoutMilliseconds` when the chain is idle so callers can still run periodic bookkeeping.
		 */
		waitForNewHead: (scanned: Pick<ObservedHead, 'hash' | 'number'> | undefined, timeoutMilliseconds: number) => {
			if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 0) throw new Error('Head wait timeout must be a non-negative integer')
			if (stopping()) return Promise.resolve<HeadWaitResult>('stopped')
			if (latest !== undefined && headIsNewer(latest, scanned)) return Promise.resolve<HeadWaitResult>('head')
			return new Promise<HeadWaitResult>(resolve => {
				let timer: ReturnType<typeof setTimeout> | undefined
				const finish = (result: HeadWaitResult) => {
					if (result === 'head' && latest !== undefined && !headIsNewer(latest, scanned)) return
					if (timer !== undefined) clearTimeout(timer)
					waiters.delete(finish)
					resolve(result)
				}
				timer = setTimeout(() => finish('timeout'), timeoutMilliseconds)
				waiters.add(finish)
			})
		},
	}
}

export type HeadWatcher = ReturnType<typeof createHeadWatcher>
