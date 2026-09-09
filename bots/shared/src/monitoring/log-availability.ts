function prunedLogMessage(message: string) {
	const normalized = message.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')
	return normalized.includes('pruned history unavailable') || normalized.includes('historical logs unavailable')
}

/** Only classify failures from eth_getLogs, never state reads or generic connectivity errors. */
export function permanentHistoricalLogError(error: unknown): boolean {
	const seen = new Set<unknown>()
	let current = error
	while (typeof current === 'object' && current !== null && !seen.has(current)) {
		seen.add(current)
		if ('failures' in current && Array.isArray(current.failures)) {
			return current.failures.length > 0 && current.failures.every(failure => typeof failure === 'object' && failure !== null && (('historicalLogsUnavailable' in failure && failure.historicalLogsUnavailable === true) || ('error' in failure && typeof failure.error === 'string' && prunedLogMessage(failure.error))))
		}
		// Inspect the underlying cause before wrapper messages, which may combine
		// pruning with an unrelated timeout from another provider.
		if ('cause' in current && current.cause !== undefined) {
			current = current.cause
			continue
		}
		if ('code' in current && current.code === 4444) return true
		return 'message' in current && typeof current.message === 'string' && prunedLogMessage(current.message)
	}
	return false
}

/** Like AugurScan, locate a monotonic pruned prefix using single-block probes. */
export async function findEarliestAvailableLogBlock(startBlock: bigint, observedHead: bigint, logsAt: (blockNumber: bigint) => Promise<unknown>): Promise<bigint> {
	if (startBlock < 0n || startBlock > observedHead) throw new Error('The log availability search start must not exceed the observed head or be negative')
	const isAvailable = async (blockNumber: bigint) => {
		try {
			await logsAt(blockNumber)
			return true
		} catch (error) {
			if (!permanentHistoricalLogError(error)) throw error
			return false
		}
	}
	if (await isAvailable(startBlock)) return startBlock
	// Preserve the actual RPC error if even the head is unavailable.
	await logsAt(observedHead)
	let lower = startBlock
	let upper = observedHead
	while (lower + 1n < upper) {
		const middle = lower + (upper - lower) / 2n
		if (await isAvailable(middle)) upper = middle
		else lower = middle
	}
	return upper
}
