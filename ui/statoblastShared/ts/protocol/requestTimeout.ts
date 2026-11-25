import { withTimeout } from '@zoltar/ui-core-shared/lib/promise.js'
import type { ReadClient, WriteClient } from '@zoltar/ui-core-shared/types/contracts.js'

const reads = new Set<PropertyKey>(['call', 'estimateContractGas', 'estimateGas', 'getBalance', 'getBlock', 'getBlockNumber', 'getChainId', 'getCode', 'getGasPrice', 'getTransactionCount', 'getTransactionReceipt', 'multicall', 'readContract', 'simulateContract'] satisfies (keyof (ReadClient & WriteClient))[])

export function withStatoblastRequestTimeout<T extends object>(client: T, message: string, signal?: AbortSignal, singleFlight?: { pending: boolean }): T {
	return new Proxy(client, {
		get(target, property, receiver) {
			const value: unknown = Reflect.get(target, property, receiver)
			if (typeof value !== 'function' || !reads.has(property)) return value
			return async (...args: unknown[]) => {
				signal?.throwIfAborted()
				if (singleFlight?.pending) throw new Error(message)
				if (singleFlight !== undefined) singleFlight.pending = true
				let released = false
				const release = () => {
					if (released) return
					released = true
					if (singleFlight !== undefined) singleFlight.pending = false
				}
				let onAbort: (() => void) | undefined
				const request = Promise.resolve()
					.then((): Promise<unknown> => {
						signal?.throwIfAborted()
						return Reflect.apply(value, target, args)
					})
					.finally(() => {
						release()
						if (onAbort !== undefined) signal?.removeEventListener('abort', onAbort)
					})
				const work =
					signal === undefined
						? request
						: Promise.race([
								request,
								new Promise<never>((_resolve, reject) => {
									onAbort = () => {
										release()
										reject(signal.reason)
									}
									signal.addEventListener('abort', onAbort, { once: true })
								}),
							])
				try {
					return await withTimeout(work, 15_000, message)
				} finally {
					// A timeout leaves the underlying RPC in flight; an abort releases
					// the lane immediately even when that provider never settles it.
					if (onAbort !== undefined && (released || singleFlight === undefined)) signal?.removeEventListener('abort', onAbort)
				}
			}
		},
	})
}
