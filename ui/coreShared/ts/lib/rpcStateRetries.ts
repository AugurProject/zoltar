const RPC_STATE_RETRY_DELAYS_MILLISECONDS = [250, 500, 1_000, 2_000, 4_000] as const

export type RpcStateRetryWait = (milliseconds: number) => Promise<void>

async function waitForMilliseconds(milliseconds: number) {
	await new Promise(resolve => setTimeout(resolve, milliseconds))
}

/** Re-reads until `isReady` accepts the value or the retry schedule is exhausted, so freshly mined state can propagate through RPC caches. */
export async function readWithRpcStateRetries<T>(read: () => Promise<T>, isReady: (value: T) => boolean, wait: RpcStateRetryWait = waitForMilliseconds) {
	let value = await read()
	for (const delayMilliseconds of RPC_STATE_RETRY_DELAYS_MILLISECONDS) {
		if (isReady(value)) return value
		await wait(delayMilliseconds)
		value = await read()
	}
	return value
}
