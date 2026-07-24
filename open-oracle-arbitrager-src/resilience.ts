export async function bestSuccessful<T>(attempts: readonly (() => Promise<T>)[], score: (value: T) => bigint, onError: (error: unknown) => void) {
	let best: T | undefined
	for (const attempt of attempts) {
		try {
			const value = await attempt()
			if (best === undefined || score(value) > score(best)) best = value
		} catch (error) {
			onError(error)
		}
	}
	return best
}

export function replaceOverlap<T>(cached: readonly T[], fetched: readonly T[], fromBlock: bigint, blockNumber: (value: T) => bigint, compare: (left: T, right: T) => number) {
	return [...cached.filter(value => blockNumber(value) < fromBlock), ...fetched].sort(compare)
}

export async function pollUntilStopped(poll: () => Promise<boolean>, wait: () => Promise<void>, once: boolean, onError: (error: unknown) => void) {
	for (;;) {
		try {
			if (await poll()) return
		} catch (error) {
			if (once) throw error
			onError(error)
		}
		await wait()
	}
}
