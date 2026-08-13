import { RpcError } from '../ethereum.ts'
import { RpcEndpointPoolFailure } from '../ethereum/rpc-resilience.ts'

export type OperationalFailureDisposition = 'connectivity-degraded' | 'safety-paused'

export class ConnectivityDegradedError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'ConnectivityDegradedError'
	}
}

export function operationalFailureDisposition(error: unknown): OperationalFailureDisposition {
	if (error instanceof ConnectivityDegradedError || error instanceof RpcEndpointPoolFailure) return 'connectivity-degraded'
	if (error instanceof RpcError) {
		if (error.code !== undefined) return 'safety-paused'
		const message = error.message.toLowerCase()
		if (message.includes('timed out') || message.includes('fetch failed') || /^http (408|425|429|5\d\d)\b/.test(message)) return 'connectivity-degraded'
	}
	if (error instanceof Error) {
		const message = error.message.toLowerCase()
		if (
			error.name === 'AbortError' ||
			error.name === 'HttpRequestError' ||
			error.name === 'NetworkError' ||
			error.name === 'TimeoutError' ||
			message.includes('http request failed') ||
			message.includes('timed out') ||
			message.includes('connection refused') ||
			message.includes('unable to connect') ||
			message.includes('fetch failed') ||
			/\bhttp (408|425|429|5\d\d)\b/.test(message)
		)
			return 'connectivity-degraded'
		if (error.cause !== error && operationalFailureDisposition(error.cause) === 'connectivity-degraded') return 'connectivity-degraded'
	}
	return 'safety-paused'
}

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

export function retryDelayMilliseconds(baseMilliseconds: number, consecutiveFailures: number, random: () => number = Math.random) {
	if (!Number.isSafeInteger(baseMilliseconds) || baseMilliseconds < 1) throw new Error('Retry base delay must be a positive integer')
	if (!Number.isSafeInteger(consecutiveFailures) || consecutiveFailures < 0) throw new Error('Consecutive failures must be a non-negative integer')
	if (consecutiveFailures === 0) return baseMilliseconds
	const exponential = Math.min(300_000, baseMilliseconds * 2 ** Math.min(consecutiveFailures - 1, 20))
	return Math.min(300_000, Math.round(exponential * (1 + Math.max(0, Math.min(1, random())) * 0.2)))
}

export async function pollUntilStopped(poll: () => Promise<boolean>, wait: (consecutiveFailures: number) => Promise<void>, once: boolean, onError: (error: unknown) => void) {
	let consecutiveFailures = 0
	for (;;) {
		try {
			if (await poll()) return
			consecutiveFailures = 0
		} catch (error) {
			if (once) throw error
			consecutiveFailures += 1
			onError(error)
		}
		await wait(consecutiveFailures)
	}
}
