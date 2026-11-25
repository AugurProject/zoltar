import { withTimeout } from '@zoltar/ui-core-shared/lib/promise.js'
import type { ReadClient, WriteClient } from '@zoltar/ui-core-shared/types/contracts.js'

const reads = new Set<PropertyKey>(['call', 'estimateContractGas', 'estimateGas', 'getBalance', 'getBlock', 'getBlockNumber', 'getChainId', 'getCode', 'getGasPrice', 'getTransactionCount', 'multicall', 'readContract', 'simulateContract'] satisfies (keyof (ReadClient & WriteClient))[])

export function withStatoblastRequestTimeout<T extends object>(client: T, message: string, signal?: AbortSignal, singleFlight?: { pending: boolean }): T {
	return new Proxy(client, {
		get(target, property, receiver) {
			const value: unknown = Reflect.get(target, property, receiver)
			if (typeof value !== 'function' || !reads.has(property)) return value
			return async (...args: unknown[]) => {
				signal?.throwIfAborted()
				if (singleFlight?.pending) throw new Error(message)
				if (singleFlight !== undefined) singleFlight.pending = true
				const request = Promise.resolve()
					.then((): Promise<unknown> => Reflect.apply(value, target, args))
					.finally(() => {
						// An RPC that exceeded our deadline can still be pending in the provider.
						if (singleFlight !== undefined) singleFlight.pending = false
					})
				const result = await withTimeout(request, 15_000, message)
				signal?.throwIfAborted()
				return result
			}
		},
	})
}
