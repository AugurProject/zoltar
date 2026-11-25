import { createPublicClient, custom, encodeFunctionData, isAddress, isHex, parseAbi, requestRpc, toHex, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { withTimeout } from '@zoltar/ui-core-shared/lib/promise.js'
import { getBrowserStorage } from '@zoltar/ui-core-shared/lib/browserStorage.js'
import { parseStoredValue, serializeStoredValue } from '@zoltar/ui-core-shared/lib/localEntityStore.js'
import { isStoredRecord } from '@zoltar/ui-core-shared/lib/storedValueReader.js'
import type { ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { poolBatchResponseInvalid, poolNeedsMinedBlock, poolReadTimeout, poolRefreshChainChanged, poolRpcNetworkChanged } from '../copy/securityPoolTransactions.js'
import type { NetworkProfile } from '@zoltar/ui-core-shared/wallet/networkProfile.js'

const version = 1
const maximumBytes = 5_000_000
const readMethods = new Set(['eth_call', 'eth_getBalance', 'eth_getBlockByNumber', 'eth_chainId', 'eth_getCode'])
type RpcRead = { method: string; params?: unknown }
type CachedRead = { request: RpcRead; response: unknown }
type PageCache = { key: string; block: string; timestamp: string; accessed: number; updated: number; reads: CachedRead[]; display?: unknown }
const aggregateAbi = parseAbi(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)', 'function getEthBalance(address addr) view returns (uint256 balance)'])

function isCachedRead(value: unknown): value is CachedRead {
	return isStoredRecord(value) && 'response' in value && isStoredRecord(value['request']) && typeof value['request']['method'] === 'string' && readMethods.has(value['request']['method'])
}

function isPageCache(value: unknown): value is PageCache {
	return (
		isStoredRecord(value) &&
		typeof value['key'] === 'string' &&
		typeof value['block'] === 'string' &&
		/^\d+$/u.test(value['block']) &&
		typeof value['timestamp'] === 'string' &&
		/^\d+$/u.test(value['timestamp']) &&
		typeof value['accessed'] === 'number' &&
		typeof value['updated'] === 'number' &&
		Array.isArray(value['reads']) &&
		value['reads'].every(isCachedRead)
	)
}

function pageStorage(profile: NetworkProfile) {
	const storage = getBrowserStorage(profile.id === 'simulation' ? 'sessionStorage' : 'localStorage')
	const key = `zoltar-ui:statoblast:reads:${profile.id}:${profile.chainIdHex}:${profile.genesisRepTokenAddress.toLowerCase()}`
	const read = (): PageCache[] => {
		try {
			const text = storage?.getItem(key)
			if (text === undefined || text === null) return []
			const value = parseStoredValue(text)
			return isStoredRecord(value) && value['version'] === version && Array.isArray(value['pages']) ? value['pages'].filter(isPageCache) : []
		} catch (error) {
			if (error instanceof SyntaxError || error instanceof DOMException) return []
			throw error
		}
	}
	const write = (page: PageCache) => {
		const pages = [
			page,
			...read()
				.filter(item => item.key !== page.key)
				.sort((a, b) => b.accessed - a.accessed),
		]
		for (;;) {
			const text = serializeStoredValue({ version, pages })
			if (pages.length === 0) return
			if (text.length * 2 <= maximumBytes) {
				try {
					storage?.setItem(key, text)
					return
				} catch (error) {
					if (!(error instanceof DOMException)) throw error
				}
			}
			pages.pop()
		}
	}
	return { read, write }
}

/** Display data shares the same eviction and network boundaries as the Capital read cache. */
export function statoblastDisplayCache<T>(profile: NetworkProfile, identity: { universeId: bigint; owner: Address | undefined; page: string }, decode: (value: unknown) => T | undefined) {
	const storage = pageStorage(profile)
	const pageKey = (page: string) => `display:${identity.universeId}:${identity.owner?.toLowerCase() ?? ''}:${page}`
	const key = pageKey(identity.page)
	return {
		universePageSuffixes(prefix: string) {
			const universePrefix = `display:${identity.universeId}:`
			return storage.read().flatMap(item => {
				if (!item.key.startsWith(universePrefix)) return []
				const separator = item.key.indexOf(':', universePrefix.length)
				if (separator === -1) return []
				const page = item.key.slice(separator + 1)
				return page.startsWith(prefix) ? [page.slice(prefix.length)] : []
			})
		},
		read() {
			const page = storage.read().find(item => item.key === key)
			if (page === undefined) return undefined
			const value = decode(page.display)
			if (value === undefined) return undefined
			storage.write({ ...page, accessed: Date.now() })
			return { value, savedAt: page.updated, timestamp: BigInt(page.timestamp) }
		},
		/** Read only explicitly requested display pages, without changing their eviction order. */
		readMany(pages: readonly string[]) {
			const keys = new Map(pages.map(page => [pageKey(page), page]))
			const result = new Map<string, { value: T; savedAt: number }>()
			for (const saved of storage.read()) {
				const page = keys.get(saved.key)
				if (page === undefined) continue
				const value = decode(saved.display)
				if (value !== undefined) result.set(page, { value, savedAt: saved.updated })
			}
			return result
		},
		write(value: T, block: { number: bigint; timestamp: bigint }, observedAt = Date.now()) {
			storage.write({ key, updated: observedAt, accessed: Date.now(), block: String(block.number), timestamp: String(block.timestamp), reads: [], display: value })
		},
	}
}

function keyForRead({ method, params }: RpcRead) {
	return JSON.stringify([method, params])
}

function address(value: unknown): Address | undefined {
	return typeof value === 'string' && value.startsWith('0x') && isAddress(value) ? `0x${value.slice(2)}` : undefined
}

function calldata(value: unknown): Hex | undefined {
	return typeof value === 'string' && value.startsWith('0x') && isHex(value, { strict: true }) ? `0x${value.slice(2)}` : undefined
}

function replaceBlock(request: RpcRead, block: bigint) {
	if (!Array.isArray(request.params)) return request
	const [first, second] = request.params
	const tag = toHex(block)
	if (request.method === 'eth_getBlockByNumber') return first === 'latest' ? request : { ...request, params: [tag, second] }
	return { ...request, params: [first, tag] }
}

function readCall(request: RpcRead) {
	if (request.method !== 'eth_call' || !Array.isArray(request.params)) return undefined
	const call: unknown = request.params[0]
	if (!isStoredRecord(call) || Object.keys(call).some(key => key !== 'to' && key !== 'data')) return undefined
	const target = address(call['to'])
	const callData = calldata(call['data'])
	return target === undefined || callData === undefined ? undefined : { target, callData, allowFailure: true }
}

export function statoblastPageCache(profile: NetworkProfile, identity: { pool: Address; universeId: bigint; owner: Address; page: string }) {
	const storage = pageStorage(profile)
	const key = `${identity.pool.toLowerCase()}:${identity.universeId}:${identity.owner.toLowerCase()}:${identity.page}`
	let livePlan: PageCache | undefined
	const loadCached = async <T>(client: ReadClient, load: (client: ReadClient) => Promise<T>) => {
		const cached = storage.read().find(page => page.key === key)
		if (cached === undefined) return undefined
		const reads = new Map(cached.reads.map(read => [keyForRead(read.request), read]))
		const result = await load(
			createPublicClient({
				chain: client.chain,
				transport: custom(
					{
						request: async request => {
							const found = reads.get(keyForRead(request))
							if (found === undefined) throw new Error('Saved page is incomplete.')
							return found.response
						},
					},
					{ retryCount: 0 },
				),
			}),
		).catch(() => undefined)
		if (result !== undefined && !storage.read().some(page => page.key === key && page.updated > cached.updated)) storage.write({ ...cached, accessed: Date.now() })
		return result === undefined ? undefined : { value: result, savedAt: cached.updated }
	}
	const refresh = async <T>(client: ReadClient, multicall: Address, load: (client: ReadClient) => Promise<T>, isCurrent: () => boolean = () => true) => {
		const request = (read: RpcRead) => withTimeout(requestRpc<unknown>(client.transport, read), 15_000, poolReadTimeout)
		const latest = { method: 'eth_getBlockByNumber', params: ['latest', false] }
		const chainRead = { method: 'eth_chainId' }
		const [rawHead, rawChain] = await Promise.all([request(latest), request(chainRead)])
		if (typeof rawChain !== 'string' || !/^0x[0-9a-f]+$/iu.test(rawChain) || BigInt(rawChain) !== BigInt(profile.chainIdHex)) throw new Error(poolRpcNetworkChanged)
		if (!isStoredRecord(rawHead) || typeof rawHead['number'] !== 'string' || typeof rawHead['timestamp'] !== 'string' || typeof rawHead['hash'] !== 'string') throw new Error(poolNeedsMinedBlock)
		const block = BigInt(rawHead['number'])
		const timestamp = BigInt(rawHead['timestamp'])
		const current = new Map<string, CachedRead>()
		const record = (read: RpcRead, response: unknown) => current.set(keyForRead(read), { request: read, response })
		const pinned = replaceBlock({ method: latest.method, params: [toHex(block), false] }, block)
		record(latest, rawHead)
		record(pinned, rawHead)
		record(chainRead, rawChain)
		// Persisted reads can only render a saved view. A live plan is built after
		// the current session has read and verified the network and runtime codes.
		const plan = livePlan
		if (plan !== undefined) {
			try {
				const reusable = plan.reads.flatMap(entry => {
					const first = Array.isArray(entry.request.params) ? entry.request.params[0] : undefined
					const balanceOwner = entry.request.method === 'eth_getBalance' ? address(first) : undefined
					const call =
						balanceOwner === undefined
							? readCall(entry.request)
							: {
									target: multicall,
									callData: encodeFunctionData({ abi: aggregateAbi, functionName: 'getEthBalance', args: [balanceOwner] }),
									allowFailure: true,
								}
					return call === undefined ? [] : [{ read: replaceBlock(entry.request, block), call, balance: balanceOwner !== undefined }]
				})
				if (reusable.length > 0) {
					const responses = await withTimeout(client.readContract({ abi: aggregateAbi, address: multicall, functionName: 'aggregate3', args: [reusable.map(item => item.call)], blockNumber: block }), 15_000, poolReadTimeout)
					if (responses.length !== reusable.length) throw new Error(poolBatchResponseInvalid)
					const results = responses.flatMap((response, index) => {
						const entry = reusable[index]
						if (entry === undefined || !response.success) return []
						const result = response.returnData
						return [{ read: entry.read, value: entry.balance ? toHex(BigInt(result)) : result }]
					})
					for (const result of results) record(result.read, result.value)
				}
				for (const entry of plan.reads) {
					if (entry.request.method === 'eth_getCode') record(replaceBlock(entry.request, block), entry.response)
				}
			} catch {
				if (livePlan === plan) livePlan = undefined
				// The normal read below verifies fresh runtime codes and rebuilds the plan.
			}
		}
		const captured = new Map<string, CachedRead>()
		const jobs = new Map<string, Promise<unknown>>()
		const scopedClient = createPublicClient({
			chain: client.chain,
			transport: custom(
				{
					request: async read => {
						if (!readMethods.has(read.method)) throw new Error('Unexpected page read.')
						const readKey = keyForRead(read)
						let job = jobs.get(readKey)
						if (job === undefined) {
							const prefetched = current.get(readKey)
							job = prefetched === undefined ? request(read) : Promise.resolve(prefetched.response)
							jobs.set(readKey, job)
						}
						const response = await job
						captured.set(readKey, { request: read, response })
						return response
					},
				},
				{ retryCount: 0 },
			),
		})
		const value = await load(scopedClient)
		const checked = await request(pinned)
		if (!isStoredRecord(checked) || checked['hash'] !== rawHead['hash']) throw new Error(poolRefreshChainChanged)
		if (!isCurrent()) return value
		const now = Date.now()
		livePlan = { key, block: block.toString(), timestamp: timestamp.toString(), accessed: now, updated: now, reads: [...captured.values()] }
		storage.write(livePlan)
		return value
	}
	return { loadCached, refresh }
}
