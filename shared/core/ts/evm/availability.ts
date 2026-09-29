type EarliestAvailableBlockOptions = {
	/** Skip probing the start block when the caller already observed it to be unavailable. */
	readonly startKnownUnavailable?: boolean
	/** Builds the error thrown when the observed head is unavailable; without it, the head probe's own error propagates. */
	readonly headUnavailableError?: (observedHead: bigint) => Error
}

/**
 * Locates the first block of a monotonic available suffix with single-block probes.
 * `isUnavailable` classifies the probe failures that mean the block is pruned; every
 * other failure propagates unchanged.
 */
export async function findEarliestAvailableBlock(startBlock: bigint, observedHead: bigint, probe: (blockNumber: bigint) => Promise<unknown>, isUnavailable: (error: unknown) => boolean, options: EarliestAvailableBlockOptions = {}): Promise<bigint> {
	if (startBlock < 0n || startBlock > observedHead) throw new Error('The availability search start must not exceed the observed head or be negative')
	const isAvailable = async (blockNumber: bigint) => {
		try {
			await probe(blockNumber)
			return true
		} catch (error) {
			if (isUnavailable(error)) return false
			throw error
		}
	}
	if (options.startKnownUnavailable !== true && (await isAvailable(startBlock))) return startBlock
	const { headUnavailableError } = options
	if (headUnavailableError === undefined) await probe(observedHead)
	else if (!(await isAvailable(observedHead))) throw headUnavailableError(observedHead)
	let lower = startBlock
	let upper = observedHead
	while (lower + 1n < upper) {
		const middle = lower + (upper - lower) / 2n
		if (await isAvailable(middle)) upper = middle
		else lower = middle
	}
	return upper
}
