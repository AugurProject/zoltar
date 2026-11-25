import { describe, expect, test } from 'bun:test'
import { createPublicClient, http, parseAbi } from '../../src/ethereum.ts'
import { createLogClient, isLocalIndexerFailure, isPermanentHistoricalLogError, safeIndexerFailure, safeIndexerFailureReason, withVerifiedProvider } from '../../src/indexer-runtime.ts'
import { createRpcRequestQueue, RpcQueueSaturatedError, withRpcRequestQueue } from '../../src/rpc-request-queue.ts'
import { parseRpcRequestBody } from '../support/rpc-request-body.ts'

const address = '0x1000000000000000000000000000000000000001'
const metadataAbi = parseAbi(['function decimals() view returns (uint8)'])

describe('RPC request queue and transport retries', () => {
	test('queues RPC work above the configured concurrency limit', async () => {
		const queue = createRpcRequestQueue(5)
		let active = 0
		let maximumActive = 0
		const releases: Array<() => void> = []
		const operations = Array.from({ length: 12 }, (_, index) =>
			queue.run(
				() =>
					new Promise<number>(resolve => {
						active++
						maximumActive = Math.max(maximumActive, active)
						releases.push(() => {
							active--
							resolve(index)
						})
					}),
			),
		)

		await Promise.resolve()
		expect(active).toBe(5)
		expect(releases).toHaveLength(5)
		for (let index = 0; index < 5; index++) releases[index]?.()
		await Promise.all(operations.slice(0, 5))
		await Promise.resolve()
		expect(active).toBe(5)
		expect(releases).toHaveLength(10)
		for (let index = 5; index < 10; index++) releases[index]?.()
		await Promise.all(operations.slice(5, 10))
		await Promise.resolve()
		expect(active).toBe(2)
		expect(releases).toHaveLength(12)
		for (let index = 10; index < 12; index++) releases[index]?.()

		expect(await Promise.all(operations)).toEqual(Array.from({ length: 12 }, (_, index) => index))
		expect(maximumActive).toBe(5)
	})

	test('rejects RPC work above the bounded pending capacity and preserves queued FIFO work', async () => {
		const queue = createRpcRequestQueue(1, 2)
		const started: number[] = []
		let releaseActive: (() => void) | undefined
		const active = queue.run(
			() =>
				new Promise<number>(resolve => {
					started.push(0)
					releaseActive = () => resolve(0)
				}),
		)
		const firstQueued = queue.run(async () => {
			started.push(1)
			return 1
		})
		const secondQueued = queue.run(async () => {
			started.push(2)
			return 2
		})

		await expect(queue.run(async () => 3)).rejects.toBeInstanceOf(RpcQueueSaturatedError)
		expect(started).toEqual([0])
		releaseActive?.()
		expect(await Promise.all([active, firstQueued, secondQueued])).toEqual([0, 1, 2])
		expect(started).toEqual([0, 1, 2])
	})

	test('treats RPC queue saturation as local backpressure without provider failover', async () => {
		const providers = [
			{ getChainId: async () => 1, id: 'first' },
			{ getChainId: async () => 1, id: 'second' },
		]
		const attempts: string[] = []
		const saturation = new RpcQueueSaturatedError({ active: 5, highWaterMark: 100, maximumPending: 100, pending: 100, saturationCount: 1 })

		await expect(
			withVerifiedProvider(
				providers,
				1,
				async provider => {
					attempts.push(provider.id)
					throw saturation
				},
				isLocalIndexerFailure,
			),
		).rejects.toBe(saturation)
		expect(attempts).toEqual(['first'])
		expect(safeIndexerFailure(saturation)).toBe('RPC queue saturated; retrying')
		expect(safeIndexerFailureReason(saturation)).toBe('RpcQueueSaturatedError; active 5; queued 100; maximum queued 100; high-water mark 100; saturation count 1')
	})

	test('recognizes adapter-wrapped queue saturation from a contract read without provider failover', async () => {
		const queue = createRpcRequestQueue(1, 0)
		let releaseActive: (() => void) | undefined
		const active = queue.run(
			() =>
				new Promise<void>(resolve => {
					releaseActive = resolve
				}),
		)
		let fetches = 0
		const client = createPublicClient({
			transport: withRpcRequestQueue(
				http('https://rpc.example', {
					fetchFn: async () => {
						fetches++
						return Response.json({ id: 1, jsonrpc: '2.0', result: '0x' })
					},
					retryCount: 0,
				}),
				queue,
			),
		})
		const providers = [
			{ getChainId: async () => 1, id: 'first' },
			{ getChainId: async () => 1, id: 'second' },
		]
		const verified = new WeakSet(providers)
		const attempts: string[] = []
		let wrapped: unknown

		try {
			await withVerifiedProvider(
				providers,
				1,
				async provider => {
					attempts.push(provider.id)
					return await client.readContract({ address, abi: metadataAbi, functionName: 'decimals' })
				},
				isLocalIndexerFailure,
				() => {},
				verified,
			)
		} catch (error) {
			wrapped = error
		}
		expect(wrapped).toBeDefined()
		expect(attempts).toEqual(['first'])
		expect(fetches).toBe(0)
		expect(safeIndexerFailure(wrapped)).toBe('RPC queue saturated; retrying')
		expect(safeIndexerFailureReason(wrapped)).toContain('RpcQueueSaturatedError; active 1; queued 0; maximum queued 0')
		releaseActive?.()
		await active
	})

	test('starts transport timeouts after dequeue and releases rejected operations', async () => {
		const queue = createRpcRequestQueue(1)
		const requestedMethods: string[] = []
		const transport = withRpcRequestQueue(
			http('https://rpc.example', {
				fetchFn: async (_input, init) => {
					const body = parseRpcRequestBody(JSON.parse(String(init?.body)))
					requestedMethods.push(body.method)
					if (body.method === 'eth_getLogs') throw new Error('expected transport failure')
					return Response.json({ id: body.id, jsonrpc: '2.0', result: body.method === 'eth_chainId' ? '0x1' : '0x2' })
				},
				retryCount: 0,
				requestTimeout: 5,
			}),
			queue,
		)
		const client = createPublicClient({ transport })
		let releaseBlocker: (() => void) | undefined
		const blocker = queue.run(
			() =>
				new Promise<void>(resolve => {
					releaseBlocker = resolve
				}),
		)
		const delayed = client.getChainId()

		await Bun.sleep(15)
		expect(requestedMethods).toEqual([])
		releaseBlocker?.()
		await blocker
		expect(await delayed).toBe(1)

		const failed = client.getLogs({})
		const afterFailure = client.getBlockNumber()
		let transportFailure: unknown
		try {
			await failed
		} catch (error) {
			transportFailure = error
		}
		expect(safeIndexerFailureReason(transportFailure)).toContain('method eth_getLogs')
		expect(await afterFailure).toBe(2n)
		expect(requestedMethods).toEqual(['eth_chainId', 'eth_getLogs', 'eth_blockNumber'])
	})

	test('does not batch unrelated RPC methods and attributes failures independently', async () => {
		let fetches = 0
		const transport = withRpcRequestQueue(
			http('https://rpc.example', {
				fetchFn: async () => {
					fetches++
					throw new Error('shared batch failure')
				},
				retryCount: 0,
			}),
			createRpcRequestQueue(5),
		)
		const client = createPublicClient({ transport })
		const results = await Promise.allSettled([client.getLogs({}), client.getChainId()])
		const reasonFrom = (result: PromiseSettledResult<unknown>): string => {
			if (result.status !== 'rejected') throw new Error('Expected the RPC batch request to fail')
			return safeIndexerFailureReason(result.reason)
		}

		expect(fetches).toBe(2)
		expect(reasonFrom(results[0])).toContain('method eth_getLogs')
		expect(reasonFrom(results[1])).toContain('method eth_chainId')
	})

	test('sends a pruned historical log request only once', async () => {
		let fetches = 0
		const filters: unknown[] = []
		const client = createLogClient('https://rpc.example', '#1 https://rpc.example', createRpcRequestQueue(5), async (_input, init) => {
			fetches++
			const request = parseRpcRequestBody(JSON.parse(String(init?.body)))
			filters.push(request.params?.[0])
			return Response.json({ error: { code: 4444, message: 'pruned history unavailable' }, id: request.id, jsonrpc: '2.0' })
		})

		const failure = await client.getLogs({ fromBlock: 1n, toBlock: 1n }).catch(error => error)
		expect(isPermanentHistoricalLogError(failure)).toBe(true)
		expect(fetches).toBe(1)
		expect(filters).toEqual([{ fromBlock: '0x1', toBlock: '0x1' }])
	})

	test('retains rate-limit retries for log requests', async () => {
		for (const responseFrom of [(_id: string | number | null) => new Response(undefined, { status: 429 }), (id: string | number | null) => Response.json({ error: { code: -32_005, message: 'request rate exceeded' }, id, jsonrpc: '2.0' })]) {
			let fetches = 0
			const client = createLogClient(
				'https://rpc.example',
				'#1 https://rpc.example',
				createRpcRequestQueue(5),
				async (_input, init) => {
					fetches++
					const request = parseRpcRequestBody(JSON.parse(String(init?.body)))
					return fetches === 1 ? responseFrom(request.id) : Response.json({ id: request.id, jsonrpc: '2.0', result: [] })
				},
				0,
			)
			expect(await client.getLogs({ fromBlock: 1n, toBlock: 1n })).toEqual([])
			expect(fetches).toBe(2)
		}
	})

	test('schedules concurrent adapter requests independently through the RPC queue', async () => {
		const queue = createRpcRequestQueue(5)
		let fetches = 0
		const releaseFetches: Array<() => void> = []
		const transport = withRpcRequestQueue(
			http('https://rpc.example', {
				fetchFn: async (_input, init) => {
					fetches++
					const body = parseRpcRequestBody(JSON.parse(String(init?.body)))
					await new Promise<void>(resolve => {
						releaseFetches.push(resolve)
					})
					return Response.json({ id: body.id, jsonrpc: '2.0', result: '0x1' })
				},
				retryCount: 0,
			}),
			queue,
		)
		const client = createPublicClient({ transport })
		const first = client.getChainId()
		const second = client.getChainId()

		while (fetches < 2) await Promise.resolve()
		expect(fetches).toBe(2)
		for (const release of releaseFetches) release()
		expect(await Promise.all([first, second])).toEqual([1, 1])
	})

	test('retries queued HTTP and JSON-RPC provider throttling responses', async () => {
		for (const throttled of [new Response(undefined, { status: 429 }), Response.json({ error: { code: -32_005, message: 'request rate exceeded' }, id: 1, jsonrpc: '2.0' })]) {
			const responses = [throttled, Response.json({ id: 1, jsonrpc: '2.0', result: '0x1' })]
			const transport = withRpcRequestQueue(
				http('https://rpc.example', {
					fetchFn: async () => {
						const response = responses.shift()
						if (response === undefined) throw new Error('Unexpected RPC request')
						return response
					},
					retryCount: 1,
					retryDelay: 0,
				}),
				createRpcRequestQueue(1),
			)

			expect(await createPublicClient({ transport }).getChainId()).toBe(1)
			expect(responses).toHaveLength(0)
		}
	})
})
