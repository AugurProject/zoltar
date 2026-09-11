import { type Address, type Chain, type PublicClient, type Transport } from '@zoltar/bot-shared/ethereum'

export function requirePositiveLimit(value: unknown, label: string) {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer`)
}

export type ChaosReadClient = PublicClient<Transport, Chain>

export const DISCOVERY_RPC_CONCURRENCY = 12

export const DISCOVERY_RPC_QUEUE_LIMIT = DISCOVERY_RPC_CONCURRENCY * 4

export function limitDiscoveryConcurrency(client: ChaosReadClient, maximum = DISCOVERY_RPC_CONCURRENCY): ChaosReadClient {
	if (!Number.isSafeInteger(maximum) || maximum <= 0) throw new Error('Discovery RPC concurrency must be a positive safe integer')
	let active = 0
	const waiting: Array<() => void> = []
	const schedule = async <T>(work: () => Promise<T>) => {
		if (active >= maximum) {
			if (waiting.length >= DISCOVERY_RPC_QUEUE_LIMIT) throw new Error(`Discovery RPC queue exceeded its ${DISCOVERY_RPC_QUEUE_LIMIT.toString()}-request safety limit`)
			await new Promise<void>(resolve => waiting.push(resolve))
		}
		active += 1
		try {
			return await work()
		} finally {
			active -= 1
			waiting.shift()?.()
		}
	}
	const limitedMethods = new Set<PropertyKey>(['getBalance', 'getBlock', 'getBlockNumber', 'getChainId', 'getLogs', 'readContract', 'request', 'simulateContract'])
	return new Proxy(client, {
		get(target, property, receiver) {
			const value = Reflect.get(target, property, receiver)
			if (typeof value !== 'function') return value
			if (!limitedMethods.has(property)) return value.bind(target)
			const invoke = value.bind(target)
			return (...args: unknown[]) => schedule(async () => await invoke(...args))
		},
	})
}

export async function drainConcurrent<T extends readonly unknown[] | []>(values: T) {
	const settled = await Promise.allSettled(values)
	for (const result of settled) if (result.status === 'rejected') throw result.reason
	return await Promise.all(values)
}

export async function mapWithConcurrency<T, R>(values: readonly T[], maximum: number, mapper: (value: T, index: number) => Promise<R>): Promise<R[]> {
	requirePositiveLimit(maximum, 'Mapping concurrency')
	const results: Array<{ value: R } | undefined> = Array.from({ length: values.length })
	let nextIndex = 0
	let failure: { error: unknown } | undefined
	const worker = async () => {
		for (;;) {
			if (failure !== undefined) return
			const index = nextIndex
			if (index >= values.length) return
			nextIndex += 1
			const value = values[index]
			if (value === undefined) {
				failure ??= { error: new Error(`Bounded mapping lost value ${index.toString()}`) }
				return
			}
			try {
				results[index] = { value: await mapper(value, index) }
			} catch (error) {
				failure ??= { error }
				return
			}
		}
	}
	await drainConcurrent(Array.from({ length: Math.min(maximum, values.length) }, worker))
	if (failure !== undefined) throw failure.error
	return results.map((value, index) => {
		if (value === undefined) throw new Error(`Bounded mapping lost result ${index.toString()}`)
		return value.value
	})
}

export function sameAddress(left: Address, right: Address) {
	return left.toLowerCase() === right.toLowerCase()
}

const CONTRACT_REVERT_MESSAGE = /(?:execution reverted|\brevert(?:ed|ing)?\b|always failing transaction)/i

export function contractSimulationReverted(error: unknown) {
	const visited = new Set<Error>()
	let current = error
	while (current instanceof Error && !visited.has(current)) {
		if (current.name === 'ContractFunctionRevertedError' || CONTRACT_REVERT_MESSAGE.test(current.message)) return true
		visited.add(current)
		current = current.cause
	}
	return false
}
