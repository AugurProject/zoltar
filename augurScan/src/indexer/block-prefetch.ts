type ReadOutcome<T> = { readonly value: T } | { readonly error: unknown }

/** Fetch a bounded window independently of ordered discovery and persistence. */
export const createBlockPrefetch = <T>(fromBlock: bigint, toBlock: bigint, read: (number: bigint) => Promise<T>, signal: AbortSignal, windowSize = 4) => {
	if (!Number.isSafeInteger(windowSize) || windowSize < 1) throw new Error('Block prefetch window must be a positive safe integer')
	const pending = new Map<bigint, Promise<ReadOutcome<T>>>()
	let nextRead = fromBlock
	let nextTake = fromBlock
	return async (number: bigint): Promise<T> => {
		signal.throwIfAborted()
		if (number !== nextTake || number > toBlock) throw new Error('Prefetched blocks must be consumed in order within the scan range')
		while (pending.size < windowSize && nextRead <= toBlock) {
			const candidate = nextRead++
			// Observe speculative failures immediately; surface them at their ordered boundary.
			pending.set(
				candidate,
				Promise.resolve()
					.then(() => {
						signal.throwIfAborted()
						return read(candidate)
					})
					.then(
						value => ({ value }),
						error => ({ error }),
					),
			)
		}
		const result = pending.get(number)
		if (result === undefined) throw new Error(`Missing prefetched block ${number}`)
		const outcome = await result
		signal.throwIfAborted()
		if ('error' in outcome) throw outcome.error
		pending.delete(number)
		nextTake++
		return outcome.value
	}
}
