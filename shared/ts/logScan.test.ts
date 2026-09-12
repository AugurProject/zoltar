/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { createCanonicalLogIndex, createCanonicalLogLoader, findContractDeploymentBlock, refreshCanonicalLogIndex } from './logScan.js'

describe('canonical log indexes', () => {
	test('splits provider-limited ranges, reuses the cache, and resets after a reorg', async () => {
		const index = createCanonicalLogIndex<bigint>()
		let head = 5n
		let chain = 'a'
		const ranges: Array<readonly [bigint, bigint]> = []
		const loadBlockAnchor = async (blockNumber = head) => ({ blockHash: `${chain}:${blockNumber.toString()}`, blockNumber })
		const fetchRange = async ({ fromBlock, toBlock }: Readonly<{ fromBlock: bigint; toBlock: bigint }>) => {
			ranges.push([fromBlock, toBlock])
			if (toBlock - fromBlock + 1n > 2n) throw new Error('block range is too large')
			return Array.from({ length: Number(toBlock - fromBlock + 1n) }, (_, offset) => fromBlock + BigInt(offset))
		}

		expect(await refreshCanonicalLogIndex(index, { fetchRange, key: 'questions', loadBlockAnchor, maximumItems: 10, maximumRange: 8n, startBlock: 0n })).toEqual([0n, 1n, 2n, 3n, 4n, 5n])
		expect(ranges).toEqual([
			[0n, 5n],
			[0n, 2n],
			[0n, 1n],
			[2n, 5n],
			[2n, 3n],
			[4n, 5n],
		])
		ranges.length = 0
		expect(await refreshCanonicalLogIndex(index, { fetchRange, key: 'questions', loadBlockAnchor, maximumItems: 10, maximumRange: 8n, startBlock: 0n })).toHaveLength(6)
		expect(ranges).toEqual([])

		head = 7n
		expect(await refreshCanonicalLogIndex(index, { fetchRange, key: 'questions', loadBlockAnchor, maximumItems: 10, maximumRange: 8n, startBlock: 0n })).toEqual([0n, 1n, 2n, 3n, 4n, 5n, 6n, 7n])
		expect(ranges).toEqual([[6n, 7n]])

		chain = 'b'
		ranges.length = 0
		expect(await refreshCanonicalLogIndex(index, { fetchRange, key: 'questions', loadBlockAnchor, maximumItems: 10, maximumRange: 8n, startBlock: 0n })).toHaveLength(8)
		expect(ranges[0]).toEqual([0n, 7n])
	})

	test('reuses an index across transient clients for the same chain', async () => {
		type Client = Readonly<{ chainId: number; head: bigint }>
		const ranges: Array<readonly [bigint, bigint]> = []
		const load = createCanonicalLogLoader<Client, string, bigint>({
			fetchRange: async (_client, _key, { fromBlock, toBlock }) => {
				ranges.push([fromBlock, toBlock])
				return [toBlock]
			},
			loadBlockAnchor: async (client, blockNumber = client.head) => ({ blockHash: `chain:${blockNumber.toString()}`, blockNumber }),
			loadCacheIdentity: async client => client.chainId.toString(),
			maximumItems: 10,
			maximumRange: 10_000n,
			startBlock: 0n,
		})

		expect(await load({ chainId: 1, head: 4n }, 'questions')).toEqual([4n])
		expect(await load({ chainId: 1, head: 6n }, 'questions')).toEqual([4n, 6n])
		expect(ranges).toEqual([
			[0n, 4n],
			[5n, 6n],
		])
	})

	test('recomputes a dynamic deployment start after a canonical reset', async () => {
		type Client = Readonly<{ chain: string; deploymentBlock: bigint; head: bigint }>
		const ranges: Array<readonly [bigint, bigint]> = []
		const deploymentSearches: bigint[] = []
		const load = createCanonicalLogLoader<Client, string, bigint>({
			fetchRange: async (client, _key, { fromBlock, toBlock }) => {
				ranges.push([fromBlock, toBlock])
				return Array.from({ length: Number(toBlock - fromBlock + 1n) }, (_, offset) => fromBlock + BigInt(offset)).filter(block => block >= client.deploymentBlock)
			},
			loadBlockAnchor: async (client, blockNumber = client.head) => ({ blockHash: `${client.chain}:${blockNumber.toString()}`, blockNumber }),
			loadCacheIdentity: async () => 'chain',
			loadStartBlock: async client => {
				deploymentSearches.push(client.deploymentBlock)
				return client.deploymentBlock
			},
			maximumItems: 20,
			maximumRange: 20n,
		})

		expect(await load({ chain: 'a', deploymentBlock: 5n, head: 8n }, 'questions')).toEqual([5n, 6n, 7n, 8n])
		ranges.length = 0
		expect(await load({ chain: 'b', deploymentBlock: 3n, head: 8n }, 'questions')).toEqual([3n, 4n, 5n, 6n, 7n, 8n])
		expect(ranges).toEqual([[3n, 8n]])
		expect(deploymentSearches).toEqual([5n, 3n])
	})

	test('rebuilds a cached index when a requested canonical head regresses', async () => {
		const index = createCanonicalLogIndex<bigint>()
		let head = 8n
		const ranges: Array<readonly [bigint, bigint]> = []
		const parameters = {
			fetchRange: async ({ fromBlock, toBlock }: Readonly<{ fromBlock: bigint; toBlock: bigint }>) => {
				ranges.push([fromBlock, toBlock])
				return Array.from({ length: Number(toBlock - fromBlock + 1n) }, (_, offset) => fromBlock + BigInt(offset))
			},
			key: 'questions',
			loadBlockAnchor: async (blockNumber = head) => ({ blockHash: `chain:${blockNumber.toString()}`, blockNumber }),
			maximumItems: 20,
			maximumRange: 20n,
			startBlock: 3n,
		}

		expect(await refreshCanonicalLogIndex(index, parameters)).toEqual([3n, 4n, 5n, 6n, 7n, 8n])
		head = 5n
		expect(await refreshCanonicalLogIndex(index, parameters)).toEqual([3n, 4n, 5n])
		expect(ranges).toEqual([
			[3n, 8n],
			[3n, 5n],
		])
	})

	test('does not anchor or fetch before a configured start block', async () => {
		const index = createCanonicalLogIndex<bigint>()
		let head = 3n
		const ranges: Array<readonly [bigint, bigint]> = []
		const parameters = {
			fetchRange: async ({ fromBlock, toBlock }: Readonly<{ fromBlock: bigint; toBlock: bigint }>) => {
				ranges.push([fromBlock, toBlock])
				return [fromBlock]
			},
			key: 'questions',
			loadBlockAnchor: async (blockNumber = head) => ({ blockHash: `chain:${blockNumber.toString()}`, blockNumber }),
			maximumRange: 10_000n,
			maximumItems: 10,
			startBlock: 5n,
		}

		expect(await refreshCanonicalLogIndex(index, parameters)).toEqual([])
		head = 4n
		expect(await refreshCanonicalLogIndex(index, parameters)).toEqual([])
		head = 6n
		expect(await refreshCanonicalLogIndex(index, parameters)).toEqual([5n])
		expect(ranges).toEqual([[5n, 6n]])
	})

	test('finds the first code-bearing block and never scans pre-deployment history', async () => {
		const reads: bigint[] = []
		const deploymentBlock = await findContractDeploymentBlock(
			{
				getBlock: async () => ({ number: 1_000_000n }),
				getCode: async ({ blockNumber = 1_000_000n }) => {
					reads.push(blockNumber)
					return blockNumber < 900_000n ? '0x' : '0x01'
				},
			},
			'0x0000000000000000000000000000000000000001',
		)
		expect(deploymentBlock).toBe(900_000n)
		expect(reads.every(block => block >= 0n && block <= 1_000_000n)).toBeTrue()
	})

	test.each([
		{ maximumItems: 2, maximumBytes: 100 },
		{ maximumItems: 100, maximumBytes: 2 },
	])('continues initial replay, incremental refresh, and reorg replay beyond a page budget: %j', async limits => {
		const index = createCanonicalLogIndex<bigint>()
		let head = 5n
		let chain = 'a'
		const parameters = {
			fetchRange: async ({ fromBlock, toBlock }: Readonly<{ fromBlock: bigint; toBlock: bigint }>) => Array.from({ length: Number(toBlock - fromBlock + 1n) }, (_, offset) => fromBlock + BigInt(offset)),
			key: 'questions',
			loadBlockAnchor: async (blockNumber = head) => ({ blockHash: `${chain}:${blockNumber.toString()}`, blockNumber }),
			...limits,
			maximumRange: 10_000n,
			measureItem: () => 1,
			startBlock: 1n,
		}
		expect(await refreshCanonicalLogIndex(index, parameters)).toEqual([1n, 2n, 3n, 4n, 5n])
		head = 7n
		expect(await refreshCanonicalLogIndex(index, parameters)).toEqual([1n, 2n, 3n, 4n, 5n, 6n, 7n])
		chain = 'b'
		expect(await refreshCanonicalLogIndex(index, parameters)).toEqual([1n, 2n, 3n, 4n, 5n, 6n, 7n])
	})

	test('rejects a single block exceeding the page item limit without committing it', async () => {
		const index = createCanonicalLogIndex<bigint>()
		await expect(
			refreshCanonicalLogIndex(index, {
				fetchRange: async () => [1n, 2n, 3n],
				key: 'questions',
				loadBlockAnchor: async (blockNumber = 1n) => ({ blockHash: `chain:${blockNumber.toString()}`, blockNumber }),
				maximumItems: 2,
				maximumRange: 10_000n,
				startBlock: 1n,
			}),
		).rejects.toThrow('exceeds the configured 2-item limit')
		expect(index.items).toEqual([])
		expect(index.anchor).toBeUndefined()
	})

	test('refetches a range after fetched log validation fails', async () => {
		const index = createCanonicalLogIndex<string>()
		let fetchCount = 0
		let corrected = false
		const parameters = {
			fetchRange: async () => {
				fetchCount += 1
				return [corrected ? 'authenticated' : 'malformed']
			},
			key: 'questions',
			loadBlockAnchor: async (blockNumber = 1n) => ({ blockHash: `chain:${blockNumber.toString()}`, blockNumber }),
			maximumItems: 10,
			maximumRange: 10_000n,
			startBlock: 1n,
			validateItem: (item: string) => {
				if (item !== 'authenticated') throw new Error('Fetched log failed authentication')
			},
		}

		await expect(refreshCanonicalLogIndex(index, parameters)).rejects.toThrow('Fetched log failed authentication')
		expect(index.items).toEqual([])
		expect(index.anchor).toBeUndefined()
		corrected = true
		expect(await refreshCanonicalLogIndex(index, parameters)).toEqual(['authenticated'])
		expect(fetchCount).toBe(2)
	})

	test('fails closed before retaining a log history beyond its byte limit', async () => {
		const index = createCanonicalLogIndex<string>()
		await expect(
			refreshCanonicalLogIndex(index, {
				fetchRange: async () => ['oversized'],
				key: 'questions',
				loadBlockAnchor: async (blockNumber = 1n) => ({ blockHash: `chain:${blockNumber.toString()}`, blockNumber }),
				maximumBytes: 8,
				maximumItems: 10,
				maximumRange: 10_000n,
				measureItem: item => item.length,
				startBlock: 1n,
			}),
		).rejects.toThrow('exceeds the configured 8-byte limit')
		expect(index.items).toEqual([])
		expect(index.anchor).toBeUndefined()
	})
})
