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

export function compactFinalityWindow<T, K>(values: readonly T[], head: bigint, overlapBlocks: bigint, key: (value: T) => K, blockNumber: (value: T) => bigint, isTerminal: (value: T) => boolean) {
	const nextBlock = head + 1n
	const overlapStart = nextBlock > overlapBlocks ? nextBlock - overlapBlocks : 0n
	const groups = new Map<K, T[]>()
	for (const value of values) {
		const groupKey = key(value)
		const group = groups.get(groupKey)
		if (group === undefined) groups.set(groupKey, [value])
		else group.push(value)
	}
	const retained = new Set<T>()
	for (const group of groups.values()) {
		let anchor: T | undefined
		for (const value of group) {
			if (blockNumber(value) >= overlapStart) {
				retained.add(value)
			} else if (anchor === undefined || blockNumber(value) >= blockNumber(anchor)) {
				anchor = value
			}
		}
		if (anchor !== undefined && !isTerminal(anchor)) retained.add(anchor)
	}
	return values.filter(value => retained.has(value))
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
