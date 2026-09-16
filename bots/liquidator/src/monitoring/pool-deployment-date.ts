import { requestWithTimeout } from '@zoltar/bot-shared/dashboard/polling'
import { deploySecurityPoolEvent } from '@zoltar/bot-shared/contracts/abi'
import type { Address } from '@zoltar/bot-shared/ethereum'
import type { ReadClient } from './vault-positions.ts'

type VerifiedDate = { blockNumber: bigint; blockHash: string; timestamp: string }
const caches = new WeakMap<ReadClient, ReturnType<typeof createPoolDeploymentDateCache>>()

export function createPoolDeploymentDateCache() {
	return { verified: new Map<string, VerifiedDate>(), pending: new Map<string, Promise<string | undefined>>() }
}
const DEADLINE_MS = 1500
const CACHE_LIMIT = 512

export async function loadPoolDeploymentDate(client: ReadClient, factory: Address, pool: Address, snapshotBlock: bigint, chainId: number, dateCache = caches.get(client) ?? createPoolDeploymentDateCache()) {
	caches.set(client, dateCache)
	const cache = dateCache.verified
	const requests = dateCache.pending
	const key = `${chainId}:${factory.toLowerCase()}:${pool.toLowerCase()}`
	const requestKey = `${key}:${snapshotBlock}`
	const existing = requests.get(requestKey)
	if (existing !== undefined) return await existing
	const request = requestWithTimeout(
		async signal => {
			const read = async <T>(operation: () => Promise<T>) => {
				signal.throwIfAborted()
				const result = await operation()
				signal.throwIfAborted()
				return result
			}
			const cached = cache.get(key)
			if (cached !== undefined && cached.blockNumber <= snapshotBlock) {
				const block = await read(() => client.getBlock({ blockNumber: cached.blockNumber }))
				if (block.hash?.toLowerCase() !== cached.blockHash.toLowerCase()) {
					cache.delete(key)
					throw new Error('Pool deployment block changed during discovery')
				}
				return cached.timestamp
			}
			const verified = await discoverDeploymentDate(client, factory, pool, snapshotBlock, read)
			if (verified === undefined) return undefined
			if (cache.size >= CACHE_LIMIT) {
				const oldest = cache.keys().next().value
				if (oldest !== undefined) cache.delete(oldest)
			}
			cache.set(key, verified)
			return verified.timestamp
		},
		DEADLINE_MS,
		'Pool deployment date discovery timed out',
	)
	requests.set(requestKey, request)
	try {
		return await request
	} finally {
		requests.delete(requestKey)
	}
}

async function discoverDeploymentDate(client: ReadClient, factory: Address, pool: Address, snapshotBlock: bigint, read: <T>(operation: () => Promise<T>) => Promise<T>) {
	const deploymentLogs = (fromBlock: bigint, toBlock: bigint) => read(() => client.getLogs({ address: factory, event: deploySecurityPoolEvent, args: { securityPool: pool }, fromBlock, toBlock }))
	const logs = await (async () => {
		try {
			return await deploymentLogs(0n, snapshotBlock)
		} catch (error) {
			// Providers with log-range limits can instead query the first block containing this pool's code.
			// Historical-state failures propagate to the catalog's unavailable-date state.
			const code = await read(() => client.getCode({ address: pool, blockNumber: snapshotBlock }))
			if (code === undefined || code === '0x') throw new Error('Pool code is unavailable at the catalog snapshot', { cause: error })
			let first = 0n
			let last = snapshotBlock
			while (first < last) {
				const middle = (first + last) / 2n
				const historicalCode = await read(() => client.getCode({ address: pool, blockNumber: middle }))
				if (historicalCode === undefined || historicalCode === '0x') first = middle + 1n
				else last = middle
			}
			return await deploymentLogs(first, first)
		}
	})()
	const log = logs.find(candidate => candidate.blockNumber !== undefined && candidate.blockNumber <= snapshotBlock)
	if (log?.blockNumber === undefined || log.blockHash === undefined) return undefined
	const block = await read(() => client.getBlock({ blockNumber: log.blockNumber }))
	if (block.hash?.toLowerCase() !== log.blockHash.toLowerCase()) throw new Error('Pool deployment block changed during discovery')
	return { blockNumber: log.blockNumber, blockHash: log.blockHash, timestamp: block.timestamp.toString() }
}
