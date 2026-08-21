import type { Transport } from './ethereum.ts'

export type RpcRequestQueue = {
	readonly run: <T>(operation: () => Promise<T>) => Promise<T>
}

export class RpcRequestMethodError extends Error {
	override name = 'RpcRequestMethodError'

	constructor(
		readonly method: string,
		cause: unknown,
		readonly endpoint?: string,
	) {
		super('RPC method failed', { cause })
	}
}

type RpcQueueSaturation = {
	readonly active: number
	readonly pending: number
	readonly maximumPending: number
	readonly highWaterMark: number
	readonly saturationCount: number
}

export class RpcQueueSaturatedError extends Error {
	readonly active: number
	readonly pending: number
	readonly maximumPending: number
	readonly highWaterMark: number
	readonly saturationCount: number

	constructor(status: RpcQueueSaturation) {
		super('RPC queue reached its pending capacity')
		this.name = 'RpcQueueSaturatedError'
		this.active = status.active
		this.pending = status.pending
		this.maximumPending = status.maximumPending
		this.highWaterMark = status.highWaterMark
		this.saturationCount = status.saturationCount
	}
}

export const rpcQueueSaturationFrom = (error: unknown): RpcQueueSaturatedError | undefined => {
	const seen = new Set<unknown>()
	let current: unknown = error
	while (typeof current === 'object' && current !== null && !seen.has(current)) {
		seen.add(current)
		if (current instanceof RpcQueueSaturatedError) return current
		current = 'cause' in current ? current.cause : undefined
	}
	return undefined
}

export const createRpcRequestQueue = (concurrency: number, maximumPending = 100): RpcRequestQueue => {
	if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error('RPC concurrency must be a positive safe integer')
	if (!Number.isSafeInteger(maximumPending) || maximumPending < 0) throw new Error('RPC maximum pending count must be a non-negative safe integer')
	let active = 0
	let highWaterMark = 0
	let saturationCount = 0
	const pending: Array<() => void> = []
	const drain = (): void => {
		while (active < concurrency) {
			const start = pending.shift()
			if (start === undefined) return
			active++
			start()
		}
	}
	return {
		run: <T>(operation: () => Promise<T>) => {
			if (active >= concurrency && pending.length >= maximumPending) {
				saturationCount++
				return Promise.reject(new RpcQueueSaturatedError({ active, pending: pending.length, maximumPending, highWaterMark, saturationCount }))
			}
			return new Promise<T>((resolve, reject) => {
				pending.push(() => {
					void Promise.resolve()
						.then(operation)
						.then(resolve, reject)
						.finally(() => {
							active--
							drain()
						})
				})
				drain()
				highWaterMark = Math.max(highWaterMark, pending.length)
			})
		},
	}
}

export const withRpcRequestQueue = (transport: Transport, queue: RpcRequestQueue, endpoint?: string): Transport => ({
	...transport,
	requestScheduler: async <TValue>(method: string, operation: () => Promise<TValue>): Promise<TValue> => {
		try {
			return await queue.run(() => (transport.requestScheduler === undefined ? operation() : transport.requestScheduler(method, operation)))
		} catch (error) {
			throw new RpcRequestMethodError(method, error, endpoint)
		}
	},
})
