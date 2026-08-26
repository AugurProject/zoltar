import { describe, expect, mock, spyOn, test } from 'bun:test'
import { getEventListeners } from 'node:events'
import {
	assertIndexerLeaseObservation,
	assertIndexerLeaseReleaseObservation,
	DatabaseConsistencyError,
	type IndexedBlock,
	type IndexerLease,
	manifestContractSetChanged,
	ScannerDatabase,
	type StoredTransaction,
} from '../src/database.ts'
import {
	type Address,
	createPublicClient,
	decodeFunctionResult,
	encodeAbiParameters,
	encodeEventTopics,
	getAddress,
	http,
	type Log,
	parseAbi,
	RpcError,
	toHex,
} from '../src/ethereum.ts'
import {
	addressActivityFrom,
	boundedDeploymentRead,
	commitCanonicalRead,
	compactIndexerDuration,
	confirmCanonicalBlock,
	contractDeploymentScanDue,
	createRpcDiagnosticContext,
	createRpcRequestQueue,
	deploymentReadBudget,
	findContractDeploymentBlock,
	findManifestContractDeployment,
	indexerOperationFailureReason,
	indexerProgressMessage,
	indexerWaitingMessage,
	indexingCompletion,
	initialIndexStartBlock,
	isLocalIndexerFailure,
	isProtocolActivitySource,
	isProtocolEvidenceEmitter,
	isSplittableLogRangeError,
	logScanCursorUpdates,
	manifestChangeRequiresFullReplay,
	manifestReplayAncestor,
	nextIndexerOwnershipStatus,
	ownershipFailureLogMessage,
	planDeploymentAwareLogScan,
	planManifestBackfill,
	queryAdaptiveLogRange,
	queryCanonicalLogRange,
	RpcQueueSaturatedError,
	readTokenMetadata,
	reorgSearchFloor,
	requiresParentLookup,
	retryDelayMs,
	rpcFailureLogMessage,
	rpcIndexerFailureReason,
	rpcLogAddressGroups,
	rpcLogQueryGroups,
	rpcProviderLabel,
	runIndexerOwnershipLifecycle,
	runIndexerTask,
	runNetworkLifecycle,
	runOwnedNetworkLifecycle,
	safeIndexerFailure,
	safeIndexerFailureReason,
	startIndexers,
	tokenMetadataNeedsRead,
	uniswapV4PoolIds,
	waitForIndexerDelay,
	withRpcRequestQueue,
	withVerifiedProvider,
} from '../src/indexer.ts'
import {
	ChainConfigurationError,
	contractDeploymentCandidateFrom,
	createLogClient,
	discoveryLogAddresses,
	findEarliestAvailableLogBlock,
	findEarliestAvailableLogProvider,
	indexerLogSources,
	isPermanentHistoricalLogError,
	isPrunedHistoricalStateError,
	readHistoricalCodeWithPermanentFallback,
	readWithPrunedStateFallback,
	scanDiscoveredLogCoverage,
} from '../src/indexer-runtime.ts'
import { RpcRequestMethodError } from '../src/rpc-request-queue.ts'
import { unixSecondsToDate } from '../src/time.ts'
import type { ContractMetadata, StoredLog, TokenMetadata } from '../src/types.ts'
import { isSupportedUniswapV4Market, uniswapV2V3TokenPairs, uniswapV4PoolId } from '../src/uniswap.ts'

const tokenMetadata: TokenMetadata = {
	address: '0x1000000000000000000000000000000000000001',
	readError: 'ERC-20 metadata unavailable',
	readBlock: 10n,
}

const address = '0x1000000000000000000000000000000000000001' as const
const metadataAbi = parseAbi(['function decimals() view returns (uint8)', 'function name() view returns (string)', 'function symbol() view returns (string)'])

class BaseError extends Error {
	constructor(message: string, options: { cause?: unknown; name?: string } = {}) {
		super(message, options.cause === undefined ? undefined : { cause: options.cause })
		this.name = options.name ?? 'BaseError'
	}
}

class ContractFunctionExecutionError extends Error {
	constructor(cause: Error, _options?: unknown) {
		super('Contract function execution failed', { cause })
		this.name = 'ContractFunctionExecutionError'
	}
}

class HttpRequestError extends Error {
	readonly details: string
	override readonly status: number

	constructor(options: { details: string; status: number; url: string }) {
		super(options.details)
		this.name = 'HttpRequestError'
		this.details = options.details
		this.status = options.status
	}
}

class RpcRequestError extends Error {
	readonly code: number
	readonly details: string

	constructor(options: { body: unknown; error: { code: number; message: string }; url: string }) {
		super(options.error.message)
		this.name = 'RpcRequestError'
		this.code = options.error.code
		this.details = options.error.message
	}
}

class TimeoutError extends Error {
	constructor(_options?: unknown) {
		super('The request took too long to respond.')
		this.name = 'TimeoutError'
	}
}

const malformedMetadataResult = (functionName: 'name' | 'symbol', data: `0x${string}`): Error => {
	try {
		decodeFunctionResult({ abi: metadataAbi, functionName, data })
		throw new Error(`Malformed ${functionName} result unexpectedly decoded`)
	} catch (error) {
		if (!(error instanceof Error) || error.name !== 'AbiDecodingError') throw error
		return new ContractFunctionExecutionError(error)
	}
}

const malformedDecimalsResult = (): Error => {
	try {
		decodeFunctionResult({ abi: metadataAbi, functionName: 'decimals', data: toHex(256n, { size: 32 }) })
		throw new Error('Malformed decimals result unexpectedly decoded')
	} catch (error) {
		if (!(error instanceof Error) || error.name !== 'AbiDecodingError') throw error
		return error
	}
}

const parseRpcRequestBody = (value: unknown): { readonly id: number | string | null; readonly method: string; readonly params?: readonly unknown[] } => {
	if (typeof value !== 'object' || value === null || Array.isArray(value) || !('method' in value) || typeof value.method !== 'string' || !('id' in value))
		throw new Error('Unexpected RPC request')
	if (value.id !== null && typeof value.id !== 'number' && typeof value.id !== 'string') throw new Error('Unexpected RPC request ID')
	if ('params' in value && value.params !== undefined && !Array.isArray(value.params)) throw new Error('Unexpected RPC request parameters')
	return { id: value.id, method: value.method, ...('params' in value && Array.isArray(value.params) ? { params: value.params } : {}) }
}

describe('network indexer lifecycle', () => {
	test('keeps extracted internals out of the public indexer facade', async () => {
		const indexerFacade = await import('../src/indexer.ts')
		expect(Object.keys(indexerFacade).sort()).toEqual(
			[
				'IndexerOwnershipStageError',
				'RpcQueueSaturatedError',
				'addressActivityFrom',
				'boundedDeploymentRead',
				'commitCanonicalRead',
				'compactIndexerDuration',
				'confirmCanonicalBlock',
				'contractDeploymentScanDue',
				'createRpcDiagnosticContext',
				'createRpcRequestQueue',
				'deploymentReadBudget',
				'findContractDeploymentBlock',
				'findManifestContractDeployment',
				'indexerOperationFailureReason',
				'indexerOwnershipStatuses',
				'indexerProgressMessage',
				'indexerWaitingMessage',
				'indexingCompletion',
				'initialIndexStartBlock',
				'isLocalIndexerFailure',
				'isProtocolActivitySource',
				'isProtocolEvidenceEmitter',
				'isSplittableLogRangeError',
				'logScanCursorUpdates',
				'manifestChangeRequiresFullReplay',
				'manifestReplayAncestor',
				'nextIndexerOwnershipStatus',
				'ownershipFailureLogMessage',
				'planDeploymentAwareLogScan',
				'planManifestBackfill',
				'queryAdaptiveLogRange',
				'queryCanonicalLogRange',
				'readTokenMetadata',
				'reorgSearchFloor',
				'requiresManifestHistoryCoverage',
				'requiresParentLookup',
				'retryDelayMs',
				'rpcEndpointLabel',
				'rpcFailureLogMessage',
				'rpcIndexerFailureReason',
				'rpcLogAddressGroups',
				'rpcLogQueryGroups',
				'rpcProviderLabel',
				'runIndexerOwnershipLifecycle',
				'runIndexerTask',
				'runNetworkLifecycle',
				'runOwnedNetworkLifecycle',
				'safeIndexerFailure',
				'safeIndexerFailureReason',
				'startIndexers',
				'tokenMetadataNeedsRead',
				'uniswapV4PoolIds',
				'waitForIndexerDelay',
				'withRpcRequestQueue',
				'withVerifiedProvider',
			].sort(),
		)
	})

	test('detects manifest contract replacements independently of ordering and address casing', () => {
		const replacement = '0x2000000000000000000000000000000000000002' as const
		expect(
			manifestContractSetChanged(
				[
					[address, 'Zoltar', 'zoltar'],
					[replacement, 'Oracle', 'openOracle'],
				],
				[
					{ address: replacement.toUpperCase(), label: 'Oracle', kind: 'openOracle' },
					{ address, label: 'Zoltar', kind: 'zoltar' },
				],
			),
		).toBe(false)
		expect(manifestContractSetChanged([[replacement, 'Zoltar', 'zoltar']], [{ address, label: 'Zoltar', kind: 'zoltar' }])).toBe(true)
		expect(manifestContractSetChanged([[address, 'Zoltar v2', 'zoltar']], [{ address, label: 'Zoltar', kind: 'zoltar' }])).toBe(true)
	})

	test('queues RPC work above the configured concurrency limit', async () => {
		const queue = createRpcRequestQueue(5)
		let active = 0
		let maximumActive = 0
		const releases: Array<() => void> = []
		const operations = Array.from({ length: 12 }, (_, index) =>
			queue.run(
				() =>
					new Promise<number>((resolve) => {
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
				new Promise<number>((resolve) => {
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
				async (provider) => {
					attempts.push(provider.id)
					throw saturation
				},
				isLocalIndexerFailure,
			),
		).rejects.toBe(saturation)
		expect(attempts).toEqual(['first'])
		expect(safeIndexerFailure(saturation)).toBe('RPC queue saturated; retrying')
		expect(safeIndexerFailureReason(saturation)).toBe(
			'RpcQueueSaturatedError; active 5; queued 100; maximum queued 100; high-water mark 100; saturation count 1',
		)
	})

	test('recognizes adapter-wrapped queue saturation from a contract read without provider failover', async () => {
		const queue = createRpcRequestQueue(1, 0)
		let releaseActive: (() => void) | undefined
		const active = queue.run(
			() =>
				new Promise<void>((resolve) => {
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
				async (provider) => {
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
				new Promise<void>((resolve) => {
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

		const failure = await client.getLogs({ fromBlock: 1n, toBlock: 1n }).catch((error) => error)
		expect(isPermanentHistoricalLogError(failure)).toBe(true)
		expect(fetches).toBe(1)
		expect(filters).toEqual([{ fromBlock: '0x1', toBlock: '0x1' }])
	})

	test('retains rate-limit retries for log requests', async () => {
		for (const responseFrom of [
			(_id: string | number | null) => new Response(undefined, { status: 429 }),
			(id: string | number | null) => Response.json({ error: { code: -32_005, message: 'request rate exceeded' }, id, jsonrpc: '2.0' }),
		]) {
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
					await new Promise<void>((resolve) => {
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
		for (const throttled of [
			new Response(undefined, { status: 429 }),
			Response.json({ error: { code: -32_005, message: 'request rate exceeded' }, id: 1, jsonrpc: '2.0' }),
		]) {
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

	test('derives V2/V3 and V4 filters for WETH, USDC, and native ETH quotes', () => {
		const usdc = '0x3000000000000000000000000000000000000003'
		const contracts = new Map<string, ContractMetadata>([
			[address, { address, kind: 'reputationToken', label: 'REP', provenance: 'manifest' }],
			[
				'0x2000000000000000000000000000000000000002',
				{
					address: '0x2000000000000000000000000000000000000002',
					kind: 'weth',
					label: 'WETH',
					provenance: 'manifest',
				},
			],
			[usdc, { address: usdc, kind: 'usdc', label: 'USDC', provenance: 'manifest' }],
		])
		expect(uniswapV2V3TokenPairs(contracts.values())).toEqual([
			{ token0: address, token1: '0x2000000000000000000000000000000000000002' },
			{ token0: '0x2000000000000000000000000000000000000002', token1: address },
			{ token0: address, token1: usdc },
			{ token0: usdc, token1: address },
		])
		const ids = uniswapV4PoolIds(contracts)
		expect(ids).toHaveLength(8)
		expect(new Set(ids).size).toBe(8)
		expect(ids).toContain(uniswapV4PoolId(address, 3_000, 60, usdc))
		expect(ids.every((id) => /^0x[0-9a-f]{64}$/.test(id))).toBeTrue()
	})

	test('accepts only canonical supported V4 native ETH and REP market identities', () => {
		const standard = {
			marketId: uniswapV4PoolId(address, 3_000, 60),
			token0Address: '0x0000000000000000000000000000000000000000',
			token1Address: address,
			feeHundredthsBip: '3000',
			tickSpacing: '60',
			hooksAddress: '0x0000000000000000000000000000000000000000',
		}
		expect(isSupportedUniswapV4Market(standard)).toBeTrue()
		const usdc = '0x3000000000000000000000000000000000000003'
		const [currency0, currency1] = BigInt(address) < BigInt(usdc) ? [address, usdc] : [usdc, address]
		expect(
			isSupportedUniswapV4Market({
				...standard,
				marketId: uniswapV4PoolId(address, 3_000, 60, usdc),
				token0Address: currency0,
				token1Address: currency1,
			}),
		).toBeTrue()
		expect(
			isSupportedUniswapV4Market({
				...standard,
				marketId: uniswapV4PoolId(address, 250, 5),
				feeHundredthsBip: '250',
				tickSpacing: '5',
			}),
		).toBeFalse()
		expect(isSupportedUniswapV4Market({ ...standard, marketId: `0x${'ab'.repeat(32)}` })).toBeFalse()
		expect(isSupportedUniswapV4Market({ ...standard, hooksAddress: '0x2000000000000000000000000000000000000002' })).toBeFalse()
	})

	test('splits oversized inclusive log ranges without gaps or duplicate boundary blocks', async () => {
		const attempts: Array<readonly [bigint, bigint]> = []
		const query = async (fromBlock: bigint, toBlock: bigint): Promise<readonly bigint[]> => {
			attempts.push([fromBlock, toBlock])
			if (toBlock - fromBlock + 1n > 26n) throw new Error('query returned more than 10000 results')
			return [fromBlock, toBlock]
		}

		const first = await queryAdaptiveLogRange(0n, 200n, 101, query)
		expect(first).toEqual({ fromBlock: 0n, toBlock: 25n, items: [0n, 25n] })
		expect(attempts).toEqual([
			[0n, 100n],
			[0n, 50n],
			[0n, 25n],
		])

		const second = await queryAdaptiveLogRange(first.toBlock + 1n, 200n, 101, query)
		expect(second.fromBlock).toBe(26n)
		expect(second.toBlock).toBe(51n)
		expect(attempts.slice(3)).toEqual([
			[26n, 126n],
			[26n, 76n],
			[26n, 51n],
		])
	})

	test('does not hide an RPC failure when even one block cannot be queried', async () => {
		const attempts: Array<readonly [bigint, bigint]> = []
		await expect(
			queryAdaptiveLogRange(9n, 9n, 100, async (fromBlock, toBlock) => {
				attempts.push([fromBlock, toBlock])
				throw new Error('RPC unavailable')
			}),
		).rejects.toThrow('RPC unavailable')
		expect(attempts).toEqual([[9n, 9n]])
	})

	test('splits provider result-limit failures but preserves unrelated failures for failover', () => {
		expect(isSplittableLogRangeError(new Error('query returned more than 10000 results'))).toBe(true)
		expect(isSplittableLogRangeError({ cause: { code: -32005, message: 'limit exceeded' } })).toBe(true)
		expect(isSplittableLogRangeError(new Error('401 Unauthorized'))).toBe(false)
		expect(isSplittableLogRangeError(new Error('connection reset'))).toBe(false)
	})

	test('locates the earliest retrievable log block without retrying the pruned range', async () => {
		const attempts: bigint[] = []
		const availableStart = await findEarliestAvailableLogBlock(
			10n,
			100n,
			async (blockNumber) => {
				attempts.push(blockNumber)
				if (blockNumber < 42n)
					throw new RpcRequestMethodError(
						'eth_getLogs',
						new RpcError('pruned history unavailable', { code: 4444, shortMessage: 'pruned history unavailable' }),
						'#1 http://reth:8545',
					)
			},
			true,
		)
		expect(availableStart).toBe(42n)
		expect(attempts).not.toContain(10n)
		expect(attempts.length).toBeLessThanOrEqual(8)
	})

	test('only treats pruned eth_getLogs history as a recoverable availability boundary', () => {
		const prunedLogs = new RpcRequestMethodError(
			'eth_getLogs',
			new RpcError('pruned history unavailable', { code: 4444, shortMessage: 'pruned history unavailable' }),
			'#1 http://reth:8545',
		)
		expect(isPermanentHistoricalLogError(prunedLogs)).toBe(true)
		expect(isSplittableLogRangeError(prunedLogs)).toBe(false)
		expect(
			isPermanentHistoricalLogError(
				new RpcRequestMethodError('eth_getCode', new RpcError('pruned history unavailable', { code: 4444 }), '#1 http://reth:8545'),
			),
		).toBe(false)
		expect(isPermanentHistoricalLogError(new RpcRequestMethodError('eth_getLogs', new RpcError('temporary failure'), '#1 http://reth:8545'))).toBe(false)
	})

	test('chooses the earliest complete log boundary across providers', async () => {
		const prunedLogs = new RpcRequestMethodError(
			'eth_getLogs',
			new RpcError('pruned history unavailable', { code: 4444, shortMessage: 'pruned history unavailable' }),
			'#1 http://reth:8545',
		)
		const providers = [
			{ id: 'earlier', floor: 42n },
			{ id: 'later', floor: 75n },
		]
		const availability = await findEarliestAvailableLogProvider(
			providers,
			10n,
			async () => 100n,
			async (provider, blockNumber) => {
				if (blockNumber < provider.floor) throw prunedLogs
			},
		)
		const earlierProvider = providers[0]
		if (earlierProvider === undefined) throw new Error('Expected an earlier provider fixture')
		expect(availability).toEqual({ provider: earlierProvider, startBlock: 42n })
	})

	test('keeps the existing coverage floor when a recovered provider can serve it', async () => {
		const prunedLogs = new RpcRequestMethodError(
			'eth_getLogs',
			new RpcError('pruned history unavailable', { code: 4444, shortMessage: 'pruned history unavailable' }),
			'#2 http://reth:8545',
		)
		const providers = [
			{ id: 'temporarily unavailable during polling', floor: 10n },
			{ id: 'pruned', floor: 75n },
		]
		const availability = await findEarliestAvailableLogProvider(
			providers,
			10n,
			async () => 100n,
			async (provider, blockNumber) => {
				if (blockNumber < provider.floor) throw prunedLogs
			},
		)
		const recoveredProvider = providers[0]
		if (recoveredProvider === undefined) throw new Error('Expected a recovered provider fixture')
		expect(availability).toEqual({ provider: recoveredProvider, startBlock: 10n })
	})

	test('excludes wrong-chain providers from log boundary discovery', async () => {
		const prunedLogs = new RpcRequestMethodError(
			'eth_getLogs',
			new RpcError('pruned history unavailable', { code: 4444, shortMessage: 'pruned history unavailable' }),
			'#2 http://reth:8545',
		)
		const providers = [
			{ chainId: 2, floor: 10n },
			{ chainId: 1, floor: 42n },
		]
		const availability = await findEarliestAvailableLogProvider(
			providers,
			10n,
			async (provider) => {
				if (provider.chainId !== 1) throw new ChainConfigurationError('RPC chain mismatch')
				return 100n
			},
			async (provider, blockNumber) => {
				if (blockNumber < provider.floor) throw prunedLogs
			},
		)
		const correctProvider = providers[1]
		if (correctProvider === undefined) throw new Error('Expected a correct-chain provider fixture')
		expect(availability).toEqual({ provider: correctProvider, startBlock: 42n })
	})

	test('does not hide unexpected provider failures during log boundary discovery', async () => {
		const unexpectedFailure = new Error('unexpected provider failure')
		await expect(
			findEarliestAvailableLogProvider(
				[{ id: 'broken' }, { id: 'unused' }],
				10n,
				async (provider) => {
					if (provider.id === 'broken') throw unexpectedFailure
					return 100n
				},
				async () => {},
			),
		).rejects.toBe(unexpectedFailure)
	})

	test('recovers pruned log coverage without recording a lifecycle failure', async () => {
		const controller = new AbortController()
		const prunedLogs = new RpcRequestMethodError(
			'eth_getLogs',
			new RpcError('pruned history unavailable', { code: 4444, shortMessage: 'pruned history unavailable' }),
			'#1 http://reth:8545',
		)
		let polls = 0
		let recoveries = 0
		let failures = 0
		let recoveredStart: bigint | undefined
		await runNetworkLifecycle({
			verify: async () => {},
			poll: async () => {
				polls++
				throw prunedLogs
			},
			recover: async (error) => {
				expect(error).toBe(prunedLogs)
				recoveries++
				const providers = [{ floor: 42n }, { floor: 75n }]
				const availability = await findEarliestAvailableLogProvider(
					providers,
					10n,
					async () => 100n,
					async (provider, blockNumber) => {
						if (blockNumber < provider.floor) throw prunedLogs
					},
				)
				recoveredStart = availability?.startBlock
				controller.abort()
				return availability !== undefined
			},
			failure: async () => {
				failures++
			},
			intervalMs: 1,
			signal: controller.signal,
		})
		expect({ polls, recoveries, failures, recoveredStart }).toEqual({ polls: 1, recoveries: 1, failures: 0, recoveredStart: 42n })
	})

	test('recovers when any failed provider reports pruned logs regardless of failure order', async () => {
		const prunedLogs = new RpcRequestMethodError(
			'eth_getLogs',
			new RpcError('pruned history unavailable', { code: 4444, shortMessage: 'pruned history unavailable' }),
			'#1 http://reth:8545',
		)
		for (const errors of [
			[prunedLogs, new Error('timeout')],
			[new Error('timeout'), prunedLogs],
		]) {
			const controller = new AbortController()
			let sawPrunedLogs = false
			let failures = 0
			await runNetworkLifecycle({
				verify: async () => {},
				poll: async () => {
					sawPrunedLogs = false
					await withVerifiedProvider(
						errors.map((error) => ({ getChainId: async () => 1, read: async () => Promise.reject(error) })),
						1,
						(provider) => provider.read(),
						() => false,
						() => {},
						undefined,
						(_provider, error) => {
							if (isPermanentHistoricalLogError(error)) sawPrunedLogs = true
						},
					)
					return false
				},
				recover: async (error) => {
					if (!isPermanentHistoricalLogError(error) && !sawPrunedLogs) return false
					controller.abort()
					return true
				},
				failure: async () => {
					failures++
				},
				intervalMs: 1,
				signal: controller.signal,
			})
			expect(failures).toBe(0)
		}
	})

	test('does not split HTTP rate-limit failures', async () => {
		for (const details of ['rate limit exceeded', 'Too Many Requests']) {
			const attempts: Array<readonly [bigint, bigint]> = []
			const failure = new HttpRequestError({ details, status: 429, url: 'https://rpc.example' })
			await expect(
				queryAdaptiveLogRange(
					0n,
					100n,
					101,
					async (fromBlock, toBlock) => {
						attempts.push([fromBlock, toBlock])
						throw failure
					},
					undefined,
					isSplittableLogRangeError,
				),
			).rejects.toBe(failure)
			expect(attempts).toEqual([[0n, 100n]])
		}
	})

	test('uses the same provider category for range splitting and diagnostics', async () => {
		const plainTimeout = new Error('query timed out')
		expect(isSplittableLogRangeError(plainTimeout)).toBe(true)
		expect(safeIndexerFailureReason(plainTimeout)).toBe('Error; message: provider request timed out')
		const httpRateLimit = new HttpRequestError({ details: 'request quota exceeded', status: 429, url: 'https://rpc.example' })
		expect(isSplittableLogRangeError(httpRateLimit)).toBe(false)
		expect(safeIndexerFailureReason(httpRateLimit)).toBe('HttpRequestError; HTTP 429; message: provider rate limit exceeded')

		const structuredRangeFailure = new RpcRequestError({
			body: { method: 'eth_getLogs', params: ['response-size'] },
			error: { code: -32600, message: 'block range is too wide' },
			url: 'https://rpc.example/rate-limit/',
		})
		expect(isSplittableLogRangeError(structuredRangeFailure)).toBe(true)
		expect(safeIndexerFailureReason(structuredRangeFailure)).toBe(
			'RpcRequestError; code -32600 (Invalid Request); message: provider rejected the requested block range',
		)
		const unrelatedStructuredFailure = new RpcRequestError({
			body: { method: 'eth_getLogs', params: ['request timed out'] },
			error: { code: -32600, message: 'upstream rejected query' },
			url: 'https://rpc.example/response-size/',
		})
		expect(isSplittableLogRangeError(unrelatedStructuredFailure)).toBe(false)
		expect(safeIndexerFailureReason(unrelatedStructuredFailure)).toBe('RpcRequestError; code -32600 (Invalid Request)')
		const conflictingCause = new Error('request rate exceeded', { cause: structuredRangeFailure })
		expect(isSplittableLogRangeError(conflictingCause)).toBe(false)
		expect(safeIndexerFailureReason(conflictingCause)).toBe(
			'Error caused by RpcRequestError; code -32600 (Invalid Request); message: provider rate limit exceeded',
		)

		for (const details of ['more than 10 requests per second', 'request limit exceeded', 'please reduce your request rate']) {
			const attempts: Array<readonly [bigint, bigint]> = []
			const failure = new RpcRequestError({ body: { method: 'eth_getLogs' }, error: { code: -32600, message: details }, url: 'https://rpc.example' })
			await expect(
				queryAdaptiveLogRange(
					0n,
					100n,
					101,
					async (fromBlock, toBlock) => {
						attempts.push([fromBlock, toBlock])
						throw failure
					},
					undefined,
					isSplittableLogRangeError,
				),
			).rejects.toBe(failure)
			expect(attempts).toEqual([[0n, 100n]])
			expect(safeIndexerFailureReason(failure)).toBe('RpcRequestError; code -32600 (Invalid Request); message: provider rate limit exceeded')
		}

		for (const [details, expectedMessage] of [
			['response too large', 'provider response size limit exceeded'],
			['request timed out', 'provider request timed out'],
		] as const) {
			const attempts: Array<readonly [bigint, bigint]> = []
			const failure = new RpcRequestError({ body: { method: 'eth_getLogs' }, error: { code: -32600, message: details }, url: 'https://rpc.example' })
			await queryAdaptiveLogRange(
				0n,
				100n,
				101,
				async (fromBlock, toBlock) => {
					attempts.push([fromBlock, toBlock])
					if (toBlock - fromBlock + 1n > 26n) throw failure
					return []
				},
				undefined,
				isSplittableLogRangeError,
			)
			expect(attempts).toEqual([
				[0n, 100n],
				[0n, 50n],
				[0n, 25n],
			])
			expect(safeIndexerFailureReason(failure)).toBe(`RpcRequestError; code -32600 (Invalid Request); message: ${expectedMessage}`)
		}
	})

	test('rejects an empty log range when its canonical endpoint changes before commit', async () => {
		const oldHash = `0x${'1'.repeat(64)}` as const
		const replacementHash = `0x${'2'.repeat(64)}` as const
		const hashes = [oldHash, replacementHash]
		let commits = 0
		let failure: unknown
		try {
			await queryCanonicalLogRange(
				100n,
				async () => {
					const hash = hashes.shift()
					if (hash === undefined) throw new Error('Unexpected endpoint hash read')
					return hash
				},
				async () => [],
			)
			commits++
		} catch (error) {
			failure = error
		}
		expect(String(failure)).toContain('changed while querying logs through block 100')
		expect(commits).toBe(0)
	})

	test('splits timeout and oversized-response failures at exact inclusive boundaries', async () => {
		const oversizedFailure = new BaseError('HTTP response body exceeded the size limit and contained provider-key-sentinel.', {
			name: 'ResponseBodyTooLargeError',
		})
		const failures = [new TimeoutError({ body: { method: 'eth_getLogs' }, url: 'https://rpc.example' }), oversizedFailure]
		for (const failure of failures) {
			const attempts: Array<readonly [bigint, bigint]> = []
			const warnings: string[] = []
			const result = await queryAdaptiveLogRange(
				0n,
				100n,
				101,
				async (fromBlock, toBlock) => {
					attempts.push([fromBlock, toBlock])
					if (toBlock - fromBlock + 1n > 26n) throw failure
					return [fromBlock, toBlock]
				},
				(failedFrom, failedTo, retryTo, error) =>
					warnings.push(`RPC log range #${failedFrom}-#${failedTo} failed (${safeIndexerFailureReason(error)}); retrying #${failedFrom}-#${retryTo}`),
				isSplittableLogRangeError,
			)
			expect(result).toEqual({ fromBlock: 0n, toBlock: 25n, items: [0n, 25n] })
			expect(attempts).toEqual([
				[0n, 100n],
				[0n, 50n],
				[0n, 25n],
			])
			if (failure === oversizedFailure) {
				expect(safeIndexerFailureReason(failure)).toBe('ResponseBodyTooLargeError; message: provider response size limit exceeded')
				expect(warnings).toEqual([
					'RPC log range #0-#100 failed (ResponseBodyTooLargeError; message: provider response size limit exceeded); retrying #0-#50',
					'RPC log range #0-#50 failed (ResponseBodyTooLargeError; message: provider response size limit exceeded); retrying #0-#25',
				])
				expect(warnings.join(' ')).not.toContain('provider-key-sentinel')
			}
		}
	})

	test('does not bisect an unrelated provider failure', async () => {
		const attempts: Array<readonly [bigint, bigint]> = []
		await expect(
			queryAdaptiveLogRange(
				0n,
				100n,
				101,
				async (fromBlock, toBlock) => {
					attempts.push([fromBlock, toBlock])
					throw new Error('401 Unauthorized')
				},
				undefined,
				isSplittableLogRangeError,
			),
		).rejects.toThrow('401 Unauthorized')
		expect(attempts).toEqual([[0n, 100n]])
	})

	test('attributes senders and referenced vaults to every security pool touched by a transaction', () => {
		const sender = '0x2000000000000000000000000000000000000002'
		const pool = '0x3000000000000000000000000000000000000003'
		const vault = '0x4000000000000000000000000000000000000004'
		const addressShapedTitle = '0x5000000000000000000000000000000000000005'
		const hash = `0x${'11'.repeat(32)}` as const
		const blockHash = `0x${'22'.repeat(32)}` as const
		const transaction: StoredTransaction = {
			hash,
			transactionIndex: 0,
			from: sender,
			to: pool,
			value: 0n,
			input: '0x',
			status: 'success',
			gasUsed: 1n,
			receipt: {},
			decoded: {
				status: 'decoded',
				name: 'depositRepToVault',
				arguments: { nested: { vault }, title: addressShapedTitle },
				referencedAddresses: [vault],
				summary: 'deposit',
			},
		}
		const log: StoredLog = {
			transactionHash: hash,
			blockHash,
			blockNumber: 1n,
			transactionIndex: 0,
			logIndex: 0,
			address: pool,
			topics: [],
			data: '0x',
			decoded: { status: 'decoded', name: 'VaultAccountingCheckpoint', arguments: { vault }, referencedAddresses: [vault], summary: 'checkpoint' },
		}
		const contracts = new Map<string, ContractMetadata>([[pool.toLowerCase(), { address: pool, label: 'Pool', kind: 'securityPool', provenance: 'test' }]])
		expect(addressActivityFrom([transaction], [log], contracts)).toEqual([
			{ transactionHash: hash, address: sender, poolAddress: pool, role: 'sender' },
			{ transactionHash: hash, address: vault, poolAddress: pool, role: 'referenced' },
		])
	})

	test('backs off exponentially with bounded jitter and a five-minute ceiling', () => {
		expect(retryDelayMs(1, 12_000, () => 0.5)).toBe(12_000)
		expect(retryDelayMs(4, 12_000, () => 0.5)).toBe(96_000)
		expect(retryDelayMs(20, 12_000, () => 0.5)).toBe(300_000)
		expect(retryDelayMs(20, 12_000, () => 1)).toBe(300_000)
		expect(retryDelayMs(1, 12_000, () => 0)).toBe(9_600)
		expect(retryDelayMs(1, 12_000, () => 1)).toBe(14_400)
	})

	test('reports bounded backfill progress and live block completion clearly', () => {
		expect(indexingCompletion(100n, 549n, 999n)).toEqual({ completedBlocks: 450n, percentage: '50.00', remainingBlocks: 450n, totalBlocks: 900n })
		expect(indexingCompletion(100n, 1_005n, 1_000n)).toEqual({ completedBlocks: 901n, percentage: '100.00', remainingBlocks: 0n, totalBlocks: 901n })
		expect(indexingCompletion(100n, 99n, 100n)).toEqual({ completedBlocks: 0n, percentage: '0.00', remainingBlocks: 1n, totalBlocks: 1n })
		expect(indexingCompletion(100n, 99n, 99n)).toEqual({ completedBlocks: 0n, percentage: '100.00', remainingBlocks: 0n, totalBlocks: 0n })
		expect(indexerWaitingMessage('mainnet', 100n, 99n)).toBe(
			'[mainnet] indexer state: live; observed head #99; 100.00% complete; caught up; waiting for configured start block #100',
		)
		expect(indexingCompletion(0n, 99_998n, 99_999n).percentage).toBe('99.99')
		expect(compactIndexerDuration(3_600)).toBe('1h')
		expect(compactIndexerDuration(86_400)).toBe('1d')
		expect(compactIndexerDuration(172_800)).toBe('2d')
		expect(indexerProgressMessage('mainnet', 100n, 119n, 1_000n, 0n, 10)).toBe(
			'[mainnet] indexer state: backfilling; indexed blocks #100–#119; observed head #1000; 11.99% complete; 881 blocks behind; ETA 1m 29s',
		)
		expect(indexerProgressMessage('mainnet', 100n, 119n, 1_000n, 0n)).toEndWith('11.99% complete; 881 blocks behind; estimating ETA')
		expect(indexerProgressMessage('sepolia', 1_000n, 1_000n, 1_000n, 0n)).toBe(
			'[sepolia] indexer state: live; indexed block #1000; observed head #1000; 100.00% complete; caught up',
		)
	})

	test('finds the first block containing contract code and distinguishes a bounded result', async () => {
		expect(await findContractDeploymentBlock(0n, 100n, async (block) => (block >= 42n ? '0x01' : undefined))).toEqual({ block: 42n, exact: true })
		expect(await findContractDeploymentBlock(50n, 100n, async () => '0x01')).toEqual({ block: 50n, exact: false })
		expect(await findContractDeploymentBlock(50n, 100n, async (block) => (block >= 51n ? '0x01' : undefined), true)).toEqual({ block: 51n, exact: true })
		expect(await findContractDeploymentBlock(0n, 100n, async () => undefined)).toBeUndefined()
		expect(await findContractDeploymentBlock(0n, 0n, async () => '0x01')).toBeUndefined()
		expect(await findContractDeploymentBlock(0n, 100n, async () => '0x01')).toBeUndefined()
	})

	test('does not treat pruned historical state as absent contract code', async () => {
		const checkedBlocks: bigint[] = []
		await expect(
			findContractDeploymentBlock(1n, 100n, async (block) => {
				checkedBlocks.push(block)
				if (block <= 50n) throw new RpcRequestError({ body: {}, error: { code: -32603, message: `state at block #${block} is pruned` }, url: '' })
				return block >= 70n ? '0x01' : undefined
			}),
		).rejects.toThrow('state at block #1 is pruned')
		expect(checkedBlocks).toEqual([100n, 1n])
	})

	test('uses the configured coverage boundary when manifest deployment history is pruned', async () => {
		const failures: unknown[] = []
		const deployment = await findManifestContractDeployment(
			address,
			1n,
			100n,
			false,
			async (_candidate, block) => {
				if (block === 1n) throw new RpcError('state at block #1 is pruned', { code: -32603, shortMessage: 'state at block #1 is pruned' })
				return '0x01'
			},
			5_000,
			Date.now,
			(error) => failures.push(error),
		)
		expect(deployment).toEqual({ block: 1n, exact: false })
		expect(failures).toHaveLength(1)
	})

	test('plans log scans from each contract deployment boundary and omits contracts without code', async () => {
		const deployed = { address, label: 'Deployed', kind: 'openOracle', provenance: 'manifest', deploymentCheckedBlock: 49n } satisfies ContractMetadata
		const absent = {
			address: '0x2000000000000000000000000000000000000002',
			label: 'Absent',
			kind: 'zoltar',
			provenance: 'manifest',
		} satisfies ContractMetadata
		const checkedBlocks: bigint[] = []
		const plan = await planDeploymentAwareLogScan(
			[deployed, absent],
			50n,
			100n,
			0n,
			async (candidate, block) => {
				checkedBlocks.push(block)
				return candidate === address && block >= 75n ? '0x01' : undefined
			},
			async (block) => unixSecondsToDate(block),
		)
		expect(plan.inputs).toEqual([{ address, fromBlock: 75n, startBlock: 75n }])
		expect(plan.observations).toEqual([
			{ contractAddress: address, checkedBlock: 100n, deployment: { block: 75n, exact: true, timestamp: new Date(75_000) } },
			{ contractAddress: absent.address, checkedBlock: 100n },
		])
		expect(checkedBlocks).not.toContain(49n)
	})

	test('falls back to complete scanning when historical contract code is unavailable', async () => {
		const contract = { address, label: 'Unresolved', kind: 'openOracle', provenance: 'manifest' } satisfies ContractMetadata
		const failures: unknown[] = []
		const plan = await planDeploymentAwareLogScan(
			[contract],
			50n,
			100n,
			0n,
			async () => {
				throw new Error('archive unavailable')
			},
			async () => new Date(0),
			(_contract, error) => failures.push(error),
		)
		expect(plan).toEqual({ inputs: [{ address, fromBlock: 50n, startBlock: 0n }], observations: [] })
		expect(failures).toHaveLength(1)
	})

	test('reuses a known historical-code limitation without repeating deployment reads', async () => {
		const contract = { address, label: 'Unresolved', kind: 'openOracle', provenance: 'manifest' } satisfies ContractMetadata
		const plan = await planDeploymentAwareLogScan(
			[contract],
			50n,
			100n,
			0n,
			async () => {
				throw new Error('historical code should not be retried')
			},
			async () => new Date(0),
			undefined,
			new Set([address.toLowerCase()]),
		)
		expect(plan).toEqual({ inputs: [{ address, fromBlock: 50n, startBlock: 0n }], observations: [] })
	})

	test('does not claim log coverage before the active retrievable boundary', async () => {
		const contract = {
			address,
			deploymentBlock: 25n,
			deploymentBlockExact: true,
			label: 'Older contract',
			kind: 'openOracle',
			provenance: 'manifest',
		} satisfies ContractMetadata
		const plan = await planDeploymentAwareLogScan(
			[contract],
			50n,
			100n,
			42n,
			async () => {
				throw new Error('Known deployment should not read code')
			},
			async () => new Date(0),
		)
		expect(plan).toEqual({ inputs: [{ address, fromBlock: 50n, startBlock: 42n }], observations: [] })
	})

	test('conservatively scans an unknown contract when only the recovered floor block is available', async () => {
		const contract = { address, label: 'Unknown at floor', kind: 'openOracle', provenance: 'manifest' } satisfies ContractMetadata
		const plan = await planDeploymentAwareLogScan(
			[contract],
			42n,
			42n,
			42n,
			async () => {
				throw new Error('A single floor block should not be used for deployment detection')
			},
			async () => new Date(0),
		)
		expect(plan).toEqual({ inputs: [{ address, fromBlock: 42n, startBlock: 42n }], observations: [] })
		expect(logScanCursorUpdates(new Map([[address.toLowerCase(), contract]]), plan.inputs, 42n, 42n)).toEqual([
			{ contractAddress: address, startBlock: 42n, lastRetrievedBlock: 42n },
		])
	})

	test('stores retained dynamic contract coverage from the active retrievable floor', async () => {
		const contract = {
			address,
			discoveryBlock: 25n,
			discoveryTxHash: `0x${'12'.repeat(32)}`,
			label: 'Retained pool',
			kind: 'securityPool',
			provenance: 'Factory.DeploySecurityPool',
		} satisfies ContractMetadata
		const plan = await planDeploymentAwareLogScan(
			[contract],
			50n,
			100n,
			42n,
			async () => {
				throw new Error('Retained discovery should not read historical code')
			},
			async () => new Date(0),
			undefined,
			new Set([address.toLowerCase()]),
		)
		expect(plan).toEqual({ inputs: [{ address, fromBlock: 50n, startBlock: 42n }], observations: [] })
		expect(logScanCursorUpdates(new Map([[address.toLowerCase(), contract]]), plan.inputs, 100n, 42n)).toEqual([
			{ contractAddress: address, startBlock: 42n, lastRetrievedBlock: 100n },
		])
	})

	test('skips a periodically refreshed pruned candidate without starving later candidates', async () => {
		const availableAddress = '0x2000000000000000000000000000000000000002'
		const unavailable = { address, label: 'Unavailable', kind: 'openOracle', provenance: 'manifest' } satisfies ContractMetadata
		const available = { address: availableAddress, label: 'Available', kind: 'zoltar', provenance: 'manifest' } satisfies ContractMetadata
		const historicalCodeUnavailable = new Set<string>()
		const pruned = new RpcError('state at block #1 is pruned', { code: -32603, shortMessage: 'state at block #1 is pruned' })
		const reads: string[] = []
		const first = contractDeploymentCandidateFrom([unavailable, available], historicalCodeUnavailable)
		expect(first).toBe(unavailable)
		expect(
			await readHistoricalCodeWithPermanentFallback(
				async () => {
					reads.push(first?.address ?? '')
					throw pruned
				},
				() => historicalCodeUnavailable.add(unavailable.address.toLowerCase()),
			),
		).toEqual({ status: 'unavailable' })
		const second = contractDeploymentCandidateFrom([unavailable, available], historicalCodeUnavailable)
		expect(second).toBe(available)
		expect(
			await readHistoricalCodeWithPermanentFallback(
				async () => {
					reads.push(second?.address ?? '')
					return '0x01'
				},
				() => {},
			),
		).toEqual({
			status: 'success',
			value: '0x01',
		})
		expect(reads).toEqual([address, availableAddress])
		expect(contractDeploymentCandidateFrom([unavailable], historicalCodeUnavailable)).toBeUndefined()
		await expect(
			readHistoricalCodeWithPermanentFallback(
				async () => {
					throw new RpcError('temporary transport failure')
				},
				() => historicalCodeUnavailable.add(availableAddress.toLowerCase()),
			),
		).rejects.toThrow('temporary transport failure')
		expect(historicalCodeUnavailable.has(availableAddress.toLowerCase())).toBeFalse()
	})

	test('keeps a periodically refreshed candidate eligible when its deployment timestamp read fails', async () => {
		const candidate = { address, label: 'Available', kind: 'openOracle', provenance: 'manifest' } satisfies ContractMetadata
		const historicalCodeUnavailable = new Set<string>()
		const timestampFailure = new RpcError('archive unavailable', { code: -32601 })
		const historicalRead = await readHistoricalCodeWithPermanentFallback(
			async () => ({ block: 42n, exact: true }),
			() => historicalCodeUnavailable.add(candidate.address.toLowerCase()),
		)

		expect(historicalRead.status).toBe('success')
		await expect(
			(async () => {
				if (historicalRead.status !== 'success') throw new Error('Expected successful bytecode discovery')
				await Promise.reject(timestampFailure)
			})(),
		).rejects.toBe(timestampFailure)
		expect(historicalCodeUnavailable.has(candidate.address.toLowerCase())).toBeFalse()
		expect(contractDeploymentCandidateFrom([candidate], historicalCodeUnavailable)).toBe(candidate)
	})

	test('propagates rate limits instead of broadening the deployment-aware log scan', async () => {
		const contract = { address, label: 'Unresolved', kind: 'openOracle', provenance: 'manifest' } satisfies ContractMetadata
		const rateLimit = new Error('RPC method failed', { cause: new RpcError('HTTP 429 while calling eth_getCode', { code: 429 }) })
		const failures: unknown[] = []

		await expect(
			planDeploymentAwareLogScan(
				[contract],
				50n,
				100n,
				0n,
				async () => {
					throw rateLimit
				},
				async () => new Date(0),
				(_contract, error) => failures.push(error),
			),
		).rejects.toBe(rateLimit)
		expect(failures).toEqual([])
	})

	test('propagates unexpected deployment detection errors instead of hiding them with a broad scan', async () => {
		const contract = { address, label: 'Unresolved', kind: 'openOracle', provenance: 'manifest' } satisfies ContractMetadata
		for (const failure of [new RpcError('Malformed JSON-RPC response while calling eth_getCode'), new RpcError('state data unavailable')]) {
			const failures: unknown[] = []
			await expect(
				planDeploymentAwareLogScan(
					[contract],
					50n,
					100n,
					0n,
					async () => {
						throw failure
					},
					async () => new Date(0),
					(_contract, error) => failures.push(error),
				),
			).rejects.toBe(failure)
			expect(failures).toEqual([])
		}
	})

	test('propagates deployment timestamp failures instead of treating them as code capability failures', async () => {
		const contract = { address, label: 'Unresolved', kind: 'openOracle', provenance: 'manifest' } satisfies ContractMetadata
		const timestampFailure = new Error('archive unavailable')
		const failures: unknown[] = []

		await expect(
			planDeploymentAwareLogScan(
				[contract],
				50n,
				100n,
				0n,
				async (_candidate, block) => (block >= 42n ? '0x01' : undefined),
				async () => {
					throw timestampFailure
				},
				(_contract, error) => failures.push(error),
			),
		).rejects.toBe(timestampFailure)
		expect(failures).toEqual([])
	})

	test('propagates wrapped queue saturation instead of falling back during deployment detection', async () => {
		const contract = { address, label: 'Unresolved', kind: 'openOracle', provenance: 'manifest' } satisfies ContractMetadata
		const saturation = new RpcQueueSaturatedError({ active: 5, highWaterMark: 100, maximumPending: 100, pending: 100, saturationCount: 1 })
		const wrapped = new Error('contract read failed', { cause: saturation })
		const failures: unknown[] = []

		await expect(
			planDeploymentAwareLogScan(
				[contract],
				50n,
				100n,
				0n,
				async () => {
					throw wrapped
				},
				async () => new Date(0),
				(_contract, error) => failures.push(error),
			),
		).rejects.toBe(wrapped)
		expect(failures).toEqual([])

		const controller = new AbortController()
		const messages: string[] = []
		await runNetworkLifecycle({
			verify: async () => {},
			poll: async () => {
				throw wrapped
			},
			failure: async (message) => {
				messages.push(message)
				controller.abort()
			},
			intervalMs: 1,
			signal: controller.signal,
		})
		expect(messages).toEqual(['RPC queue saturated; retrying'])
	})

	test('plans a manifest backfill from a newly added contract deployment', async () => {
		const contract = { address, label: 'New manifest source', kind: 'openOracle', provenance: 'manifest' } satisfies ContractMetadata
		const contracts = new Map([[address.toLowerCase(), contract]])
		const detected: bigint[] = []
		expect(
			await planManifestBackfill([[address, contract.label, contract.kind]], contracts, new Map(), 100n, 0n, async (_address, startBlock, checkpoint) => {
				detected.push(startBlock, checkpoint)
				return { block: 75n, exact: true }
			}),
		).toBe(75n)
		expect(detected).toEqual([0n, 100n])
	})

	test('starts a fresh index at the earliest tracked contract deployment', async () => {
		const secondAddress = '0x2000000000000000000000000000000000000002' as const
		const helperAddress = '0x3000000000000000000000000000000000000003' as const
		const searches: Address[] = []
		expect(
			await initialIndexStartBlock(
				[
					[address, 'OpenOracle', 'openOracle'],
					[secondAddress, 'Zoltar', 'zoltar'],
					[helperAddress, 'Multicall3', 'multicall3'],
				],
				0n,
				1_000n,
				async (candidate) => {
					searches.push(candidate)
					return { block: candidate === address ? 750n : 800n, exact: true }
				},
			),
		).toBe(750n)
		expect(searches).toEqual([address, secondAddress])
	})

	test('does not let an earlier ScalarOutcomes helper widen fresh history', async () => {
		const scalar = '0x2000000000000000000000000000000000000002' as const
		expect(
			await initialIndexStartBlock(
				[
					[scalar, 'Scalar outcomes', 'scalarOutcomes'],
					[address, 'Zoltar', 'zoltar'],
				],
				0n,
				1_000n,
				async (candidate) => ({ block: candidate === scalar ? 100n : 750n, exact: true }),
			),
		).toBe(750n)
	})

	test('waits at the next block when no tracked contract is deployed yet', async () => {
		expect(await initialIndexStartBlock([[address, 'OpenOracle', 'openOracle']], 0n, 1_000n, async () => undefined)).toBe(1_001n)
	})

	test('honors a configured future start without attempting deployment discovery', async () => {
		const detection = mock(async () => ({ block: 750n, exact: true }))
		expect(await initialIndexStartBlock([[address, 'OpenOracle', 'openOracle']], 1_001n, 1_000n, detection)).toBe(1_001n)
		expect(detection).not.toHaveBeenCalled()
	})

	test('uses explicit manifest deployment blocks and resumes partial contract coverage', async () => {
		const contract = { address, label: 'New manifest source', kind: 'openOracle', provenance: 'manifest' } satisfies ContractMetadata
		const contracts = new Map([[address.toLowerCase(), contract]])
		const detection = mock(async () => ({ block: 90n, exact: true }))
		expect(
			await planManifestBackfill(
				[[address, contract.label, contract.kind, 75n]],
				contracts,
				new Map([[address.toLowerCase(), { contractAddress: address, startBlock: 75n, lastRetrievedBlock: 80n }]]),
				100n,
				0n,
				detection,
			),
		).toBe(81n)
		expect(detection).not.toHaveBeenCalled()
	})

	test('resumes a pre-boundary manifest contract from the active retrievable floor', async () => {
		const contract = { address, label: 'Pre-boundary source', kind: 'openOracle', provenance: 'manifest' } satisfies ContractMetadata
		const detection = mock(async () => ({ block: 50n, exact: true }))
		expect(
			await planManifestBackfill(
				[[address, contract.label, contract.kind, 50n]],
				new Map([[address.toLowerCase(), contract]]),
				new Map([[address.toLowerCase(), { contractAddress: address, startBlock: 75n, lastRetrievedBlock: 80n }]]),
				100n,
				0n,
				detection,
				75n,
			),
		).toBe(81n)
		expect(detection).not.toHaveBeenCalled()
	})

	test('backfills when an exact manifest boundary moves earlier than a complete cursor', async () => {
		const contract = { address, label: 'Promoted manifest source', kind: 'openOracle', provenance: 'manifest' } satisfies ContractMetadata
		expect(
			await planManifestBackfill(
				[[address, contract.label, contract.kind, 50n]],
				new Map([[address.toLowerCase(), contract]]),
				new Map([[address.toLowerCase(), { contractAddress: address, startBlock: 75n, lastRetrievedBlock: 100n }]]),
				100n,
				0n,
				mock(async () => undefined),
			),
		).toBe(50n)
	})

	test('backfills a newly configured token because it changes historical market filters', async () => {
		const tokenAddress = '0x3000000000000000000000000000000000000003'
		for (const kind of ['reputationToken', 'usdc'] as const) {
			const contract = { address: tokenAddress, label: kind, kind, provenance: 'manifest' } satisfies ContractMetadata
			expect(
				await planManifestBackfill(
					[[tokenAddress, contract.label, contract.kind, 70n]],
					new Map([[tokenAddress, contract]]),
					new Map(),
					100n,
					0n,
					mock(async () => undefined),
				),
			).toBe(70n)
		}
	})

	test('requires a rebuild when newly tracked history predates the stored index start', () => {
		expect(() => manifestReplayAncestor(50n, 75n)).toThrow('deployment block 50 predates the stored index start 75')
		expect(manifestReplayAncestor(75n, 75n)).toBe(-1n)
		expect(manifestReplayAncestor(80n, 75n)).toBe(79n)
	})

	test('clamps newly added manifest history to the stored coverage floor', async () => {
		const replacement = '0x2000000000000000000000000000000000000002' as const
		const storedContract = { address, label: 'Zoltar', kind: 'zoltar', provenance: 'manifest' } satisfies ContractMetadata
		const storedContracts = new Map([[address.toLowerCase(), storedContract]])
		const cursors = new Map([[address.toLowerCase(), { contractAddress: address, startBlock: 75n, lastRetrievedBlock: 100n }]])
		expect(
			await manifestChangeRequiresFullReplay(
				[
					[address, storedContract.label, storedContract.kind],
					[replacement, 'OpenOracle v2', 'openOracle'],
				],
				storedContracts,
				cursors,
				100n,
				0n,
				75n,
				async (candidate) => ({ block: candidate === replacement ? 50n : 75n, exact: true }),
			),
		).toBe(true)
		expect(
			await manifestChangeRequiresFullReplay(
				[
					[address, storedContract.label, storedContract.kind],
					[replacement, 'OpenOracle v2', 'openOracle'],
				],
				storedContracts,
				cursors,
				100n,
				0n,
				75n,
				async (candidate) => ({ block: candidate === replacement ? 80n : 75n, exact: true }),
			),
		).toBe(true)
		const storedHelper = new Map([
			[address.toLowerCase(), { address, label: 'Multicall3', kind: 'multicall3', provenance: 'manifest' } satisfies ContractMetadata],
		])
		expect(
			await manifestChangeRequiresFullReplay([[address, 'OpenOracle', 'openOracle']], storedHelper, new Map(), 100n, 0n, 75n, async () => ({
				block: 50n,
				exact: true,
			})),
		).toBe(true)
		const inexactStoredHelper = new Map([
			[
				address.toLowerCase(),
				{
					address,
					label: 'Multicall3',
					kind: 'multicall3',
					provenance: 'manifest',
					deploymentBlock: 75n,
					deploymentBlockExact: false,
					deploymentCheckedBlock: 100n,
				} satisfies ContractMetadata,
			],
		])
		const searches: Array<{ start: bigint; knownAbsent: boolean }> = []
		expect(
			await manifestChangeRequiresFullReplay(
				[[address, 'OpenOracle', 'openOracle']],
				inexactStoredHelper,
				new Map(),
				100n,
				0n,
				75n,
				async (_candidate, start, _checkpoint, knownAbsent) => {
					searches.push({ start, knownAbsent })
					return { block: 50n, exact: true }
				},
			),
		).toBe(true)
		expect(searches).toEqual([{ start: 75n, knownAbsent: false }])
		const promotedDiscovery = new Map([
			[
				address.toLowerCase(),
				{
					address,
					label: 'Discovered pool',
					kind: 'securityPool',
					provenance: 'Factory.DeploySecurityPool',
					deploymentBlock: 75n,
					deploymentBlockExact: false,
					deploymentCheckedBlock: 100n,
				} satisfies ContractMetadata,
			],
		])
		const promotionSearches: bigint[] = []
		expect(
			await manifestChangeRequiresFullReplay(
				[[address, 'Promoted pool', 'securityPool']],
				promotedDiscovery,
				new Map([[address.toLowerCase(), { contractAddress: address, startBlock: 75n, lastRetrievedBlock: 100n }]]),
				100n,
				0n,
				75n,
				async (_candidate, start) => {
					promotionSearches.push(start)
					return { block: 50n, exact: true }
				},
			),
		).toBe(true)
		expect(promotionSearches).toEqual([75n])
	})

	test('gives each manifest deployment search an independent read budget', async () => {
		let now = 0
		const codeAt = async (_candidate: Address, block: bigint) => {
			now += 2
			return block === 1n ? '0x01' : undefined
		}
		const first = await findManifestContractDeployment(address, 0n, 1n, false, codeAt, 5, () => now)
		const second = await findManifestContractDeployment('0x2000000000000000000000000000000000000002', 0n, 1n, false, codeAt, 5, () => now)
		expect(first).toEqual({ block: 1n, exact: true })
		expect(second).toEqual({ block: 1n, exact: true })
		expect(now).toBe(8)
	})

	test('tracks filtered token coverage from the replay start', async () => {
		const tokenAddress = '0x3000000000000000000000000000000000000003'
		const helperAddress = '0x4000000000000000000000000000000000000004'
		const contracts = new Map<string, ContractMetadata>([
			[tokenAddress, { address: tokenAddress, label: 'REP', kind: 'reputationToken', provenance: 'manifest' }],
			[helperAddress, { address: helperAddress, label: 'Multicall3', kind: 'multicall3', provenance: 'manifest' }],
		])
		const updates = logScanCursorUpdates(contracts, [], 100n, 0n, 70n)
		expect(updates).toEqual([{ contractAddress: tokenAddress, startBlock: 70n, lastRetrievedBlock: 100n }])
		const cursor = updates[0]
		if (cursor === undefined) throw new Error('Expected REP filter coverage cursor')
		expect(
			await planManifestBackfill(
				[[tokenAddress, 'REP', 'reputationToken', 50n]],
				contracts,
				new Map([[tokenAddress, cursor]]),
				100n,
				0n,
				mock(async () => undefined),
			),
		).toBe(50n)
	})

	test('scans REP history without adding high-volume quote-token histories', () => {
		const repAddress = '0x3000000000000000000000000000000000000003'
		const wethAddress = '0x4000000000000000000000000000000000000004'
		const oracleAddress = '0x5000000000000000000000000000000000000005'
		const contracts = [
			{ address: repAddress, label: 'REP', kind: 'reputationToken', provenance: 'manifest' },
			{ address: wethAddress, label: 'WETH', kind: 'weth', provenance: 'manifest' },
			{ address: oracleAddress, label: 'Oracle', kind: 'openOracle', provenance: 'manifest' },
		] satisfies readonly ContractMetadata[]
		expect(indexerLogSources(contracts).map((contract) => contract.address)).toEqual([repAddress, oracleAddress])
		const contractMap = new Map<string, ContractMetadata>(contracts.map((contract) => [contract.address.toLowerCase(), contract]))
		expect(discoveryLogAddresses([repAddress, wethAddress, oracleAddress], contractMap)).toEqual([repAddress, oracleAddress])
		const factoryAddress = '0x6000000000000000000000000000000000000006'
		contractMap.set(factoryAddress, { address: factoryAddress, label: 'V3 factory', kind: 'uniswapV3Factory', provenance: 'manifest' })
		expect(discoveryLogAddresses([repAddress], contractMap)).toEqual([repAddress, factoryAddress])
	})

	test('covers REP events from the discovery block through the active scan segment', async () => {
		const repAddress = '0x3000000000000000000000000000000000000003'
		const wethAddress = '0x4000000000000000000000000000000000000004'
		const factoryAddress = '0x6000000000000000000000000000000000000006'
		const contracts = new Map<string, ContractMetadata>([
			[repAddress, { address: repAddress, label: 'Child REP', kind: 'reputationToken', provenance: 'REP.DeployChild' }],
			[wethAddress, { address: wethAddress, label: 'WETH', kind: 'weth', provenance: 'manifest' }],
			[factoryAddress, { address: factoryAddress, label: 'V3 factory', kind: 'uniswapV3Factory', provenance: 'manifest' }],
		])
		const logAt = (blockNumber: bigint, digit: string): Log => ({
			address: repAddress,
			blockHash: `0x${digit.repeat(64)}`,
			blockNumber,
			data: '0x',
			logIndex: 0n,
			removed: false,
			topics: [],
			transactionHash: `0x${digit.repeat(64)}`,
			transactionIndex: 0n,
		})
		const currentLog = logAt(10n, '1')
		const laterLog = logAt(12n, '2')
		const currentQueries: Array<readonly Address[]> = []
		const remainingQueries: Array<{ readonly addresses: readonly Address[]; readonly fromBlock: bigint; readonly toBlock: bigint }> = []
		const coverage = await scanDiscoveredLogCoverage(
			10n,
			12n,
			[repAddress, wethAddress],
			contracts,
			async (addresses) => {
				currentQueries.push(addresses)
				return [currentLog]
			},
			async (fromBlock, toBlock, addresses) => {
				remainingQueries.push({ addresses, fromBlock, toBlock })
				return [laterLog]
			},
		)

		expect(currentQueries).toEqual([[repAddress, factoryAddress]])
		expect(remainingQueries).toEqual([{ addresses: [repAddress, factoryAddress], fromBlock: 11n, toBlock: 12n }])
		expect(coverage).toEqual({ currentBlockLogs: [currentLog], remainingLogs: [laterLog] })
	})

	test('stores same-block and later REP activity after discovering the token mid-segment', async () => {
		const zoltarAddress = getAddress('0x7000000000000000000000000000000000000007')
		const repAddress = getAddress('0x8000000000000000000000000000000000000008')
		const wethAddress = getAddress('0x9000000000000000000000000000000000000009')
		const holder = getAddress('0xa00000000000000000000000000000000000000a')
		const sender = getAddress('0xb00000000000000000000000000000000000000b')
		const hash = (digit: string) => `0x${digit.repeat(64)}` as const
		const blockHashes = new Map([
			[10n, hash('a')],
			[11n, hash('b')],
			[12n, hash('c')],
		])
		const deployAbi = parseAbi([
			'event DeployChild(address deployer,uint248 indexed universeId,uint256 indexed outcomeIndex,uint248 indexed childUniverseId,address childReputationToken,uint256 childUniverseTheoreticalSupplyAttoRep)',
		])
		const transferAbi = parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)'])
		const topicsFrom = (topics: readonly (string | readonly string[] | null)[]): readonly string[] =>
			topics.map((topic) => {
				if (typeof topic !== 'string') throw new Error('Expected one topic per indexed event argument')
				return topic
			})
		const rawLog = (
			contractAddress: Address,
			blockNumber: bigint,
			transactionDigit: string,
			transactionIndex: number,
			topics: readonly string[],
			data: string,
		) => ({
			address: contractAddress,
			blockHash: blockHashes.get(blockNumber),
			blockNumber: toHex(blockNumber),
			data,
			logIndex: '0x0',
			removed: false,
			topics,
			transactionHash: hash(transactionDigit),
			transactionIndex: toHex(transactionIndex),
		})
		const deployLog = rawLog(
			zoltarAddress,
			10n,
			'1',
			0,
			topicsFrom(encodeEventTopics({ abi: deployAbi, eventName: 'DeployChild', args: { universeId: 1n, outcomeIndex: 2n, childUniverseId: 3n } })),
			encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'uint256' }], [sender, repAddress, 1_000n]),
		)
		const sameBlockRepLog = rawLog(
			repAddress,
			10n,
			'2',
			1,
			topicsFrom(encodeEventTopics({ abi: transferAbi, eventName: 'Transfer', args: { from: sender, to: holder } })),
			encodeAbiParameters([{ type: 'uint256' }], [100n]),
		)
		const laterRepLog = rawLog(
			repAddress,
			12n,
			'3',
			0,
			topicsFrom(encodeEventTopics({ abi: transferAbi, eventName: 'Transfer', args: { from: sender, to: holder } })),
			encodeAbiParameters([{ type: 'uint256' }], [50n]),
		)
		const allLogs = [deployLog, sameBlockRepLog, laterRepLog]
		const rpcLogQueries: Array<{ readonly addresses: readonly string[]; readonly fromBlock: bigint; readonly toBlock: bigint }> = []
		const rpcServer = Bun.serve({
			port: 0,
			fetch: async (rpcRequest) => {
				const request = parseRpcRequestBody(await rpcRequest.json())
				const result = (() => {
					if (request.method === 'eth_chainId') return '0x7a69'
					if (request.method === 'eth_blockNumber') return '0xc'
					if (request.method === 'eth_getBlockByNumber') {
						const blockNumber = BigInt(String(request.params?.[0]))
						const blockHash = blockHashes.get(blockNumber)
						if (blockHash === undefined) throw new Error(`Unexpected block ${blockNumber}`)
						return {
							hash: blockHash,
							number: toHex(blockNumber),
							parentHash: blockNumber === 10n ? hash('9') : blockHashes.get(blockNumber - 1n),
							timestamp: toHex(1_700_000_000n + blockNumber),
							transactions: [],
						}
					}
					if (request.method === 'eth_getLogs') {
						const filter = request.params?.[0]
						if (typeof filter !== 'object' || filter === null || !('address' in filter) || !('fromBlock' in filter) || !('toBlock' in filter))
							throw new Error('Unexpected log filter')
						const rawAddresses = filter.address
						const addresses = (Array.isArray(rawAddresses) ? rawAddresses : [rawAddresses]).map(String)
						const fromBlock = BigInt(String(filter.fromBlock))
						const toBlock = BigInt(String(filter.toBlock))
						rpcLogQueries.push({ addresses, fromBlock, toBlock })
						return allLogs.filter(
							(log) =>
								addresses.some((candidate) => candidate.toLowerCase() === log.address.toLowerCase()) &&
								BigInt(log.blockNumber) >= fromBlock &&
								BigInt(log.blockNumber) <= toBlock,
						)
					}
					const transactionHash = String(request.params?.[0])
					const sourceLog = allLogs.find((log) => log.transactionHash === transactionHash)
					if (sourceLog === undefined) throw new Error(`Unexpected ${request.method} for ${transactionHash}`)
					if (request.method === 'eth_getTransactionByHash')
						return {
							blockHash: sourceLog.blockHash,
							blockNumber: sourceLog.blockNumber,
							from: sender,
							gas: '0x5208',
							hash: sourceLog.transactionHash,
							input: '0x',
							nonce: '0x0',
							to: sourceLog.address,
							transactionIndex: sourceLog.transactionIndex,
							type: '0x2',
							value: '0x0',
						}
					if (request.method === 'eth_getTransactionReceipt')
						return {
							blockHash: sourceLog.blockHash,
							blockNumber: sourceLog.blockNumber,
							contractAddress: null,
							cumulativeGasUsed: '0x5208',
							from: sender,
							gasUsed: '0x5208',
							logs: [sourceLog],
							status: '0x1',
							to: sourceLog.address,
							transactionHash: sourceLog.transactionHash,
							transactionIndex: sourceLog.transactionIndex,
							type: '0x2',
						}
					throw new Error(`Unexpected RPC method ${request.method}`)
				})()
				return Response.json({ id: request.id, jsonrpc: '2.0', result })
			},
		})
		const controller = new AbortController()
		const database = new ScannerDatabase('postgres://unused')
		const storedBlocks: IndexedBlock[] = []
		const contracts = new Map<string, ContractMetadata>([
			[
				zoltarAddress.toLowerCase(),
				{ address: zoltarAddress, deploymentBlock: 10n, deploymentBlockExact: true, kind: 'zoltar', label: 'Zoltar', provenance: 'manifest' },
			],
			[
				wethAddress.toLowerCase(),
				{ address: wethAddress, deploymentBlock: 10n, deploymentBlockExact: true, kind: 'weth', label: 'WETH', provenance: 'manifest' },
			],
		])
		const lease: IndexerLease = {
			backendPid: 1,
			connection: database.sql as IndexerLease['connection'],
			assertHeld: async () => {},
			release: async () => {},
		}
		spyOn(database, 'tryAcquireIndexerLock').mockResolvedValue(lease)
		spyOn(database, 'checkpoint').mockResolvedValue(undefined)
		spyOn(database, 'networkStartBlock').mockResolvedValue(10n)
		spyOn(database, 'storedBlockTip').mockResolvedValue(undefined)
		spyOn(database, 'contracts').mockResolvedValue(contracts)
		spyOn(database, 'logScanCursors').mockResolvedValue(new Map())
		spyOn(database, 'seedNetwork').mockResolvedValue(false)
		spyOn(database, 'tokenMetadata').mockResolvedValue(
			new Map([
				[repAddress.toLowerCase(), { address: repAddress, decimals: 18, name: 'Reputation', readBlock: 10n, symbol: 'REP' }],
				[wethAddress.toLowerCase(), { address: wethAddress, decimals: 18, name: 'Wrapped Ether', readBlock: 10n, symbol: 'WETH' }],
			]),
		)
		spyOn(database, 'storeBlock').mockImplementation(async (_chainId, block) => {
			storedBlocks.push(block)
			if (block.number === 12n) controller.abort()
		})
		spyOn(database, 'contractDeploymentCandidates').mockResolvedValue([])
		const info = spyOn(console, 'info').mockImplementation(() => {})
		const error = spyOn(console, 'error').mockImplementation(() => {})
		const timeout = setTimeout(() => controller.abort(), 2_000)
		try {
			const network = {
				chainId: 31_337,
				confirmationDepth: 100n,
				contracts: [
					[zoltarAddress, 'Zoltar', 'zoltar', 10n],
					[wethAddress, 'WETH', 'weth', 10n],
				] as const,
				explorerBaseUrl: 'https://example.invalid',
				id: 'rep-lifecycle',
				name: 'REP lifecycle',
				nativeSymbol: 'ETH',
				rpcUrls: [`http://127.0.0.1:${rpcServer.port}`],
				startBlock: 10n,
			}
			await Promise.all(startIndexers([network], database, controller.signal))
			expect(error.mock.calls).toEqual([])
			expect(storedBlocks.map((block) => block.number)).toEqual([10n, 11n, 12n])
			const storedRepLogs = storedBlocks.flatMap((block) => block.logs).filter((log) => log.address === repAddress)
			expect(storedRepLogs.map((log) => log.blockNumber)).toEqual([10n, 12n])
			expect(storedBlocks.flatMap((block) => block.addressActivity).some((activity) => activity.address === holder)).toBe(true)
			expect(rpcLogQueries.some((query) => query.fromBlock === 10n && query.toBlock === 10n && query.addresses.includes(repAddress))).toBe(true)
			expect(rpcLogQueries.some((query) => query.fromBlock === 11n && query.toBlock === 12n && query.addresses.includes(repAddress))).toBe(true)
			expect(rpcLogQueries.every((query) => !query.addresses.includes(wethAddress))).toBe(true)
		} finally {
			clearTimeout(timeout)
			controller.abort()
			await rpcServer.stop(true)
			info.mockRestore()
			error.mockRestore()
		}
	})

	test('does not rewind for covered, future, absent, or non-activity manifest contracts', async () => {
		const absentAddress = '0x2000000000000000000000000000000000000002'
		const helperAddress = '0x3000000000000000000000000000000000000003'
		const contracts = new Map<string, ContractMetadata>([
			[address.toLowerCase(), { address, label: 'Covered', kind: 'openOracle', provenance: 'manifest' }],
			[absentAddress, { address: absentAddress, label: 'Absent', kind: 'zoltar', provenance: 'manifest' }],
			[helperAddress, { address: helperAddress, label: 'Multicall3', kind: 'multicall3', provenance: 'manifest' }],
		])
		const cursors = new Map([[address.toLowerCase(), { contractAddress: address, startBlock: 75n, lastRetrievedBlock: 100n }]])
		const detection = mock(async (candidate: Address) => (candidate.toLowerCase() === absentAddress ? undefined : { block: 75n, exact: true }))
		expect(
			await planManifestBackfill(
				[
					[address, 'Covered', 'openOracle'],
					[absentAddress, 'Absent', 'zoltar'],
					[helperAddress, 'Multicall3', 'multicall3'],
					['0x4000000000000000000000000000000000000004', 'Future', 'zoltar', 101n],
				],
				contracts,
				cursors,
				100n,
				0n,
				detection,
			),
		).toBeUndefined()
		expect(detection).toHaveBeenCalledTimes(1)
	})

	test('bounds a stalled optional contract deployment history read', async () => {
		let deploymentTimeout: unknown
		try {
			await boundedDeploymentRead(() => new Promise(() => {}), 1)
		} catch (error) {
			deploymentTimeout = error
		}
		expect(deploymentTimeout).toMatchObject({ name: 'TimeoutError' })
		expect(safeIndexerFailureReason(deploymentTimeout)).toBe('TimeoutError; message: provider request timed out')
		let now = 0
		const readWithinBudget = deploymentReadBudget(10, () => now)
		expect(
			await readWithinBudget(async () => {
				now += 6
				return 'first'
			}),
		).toBe('first')
		await expect(
			readWithinBudget(async () => {
				now += 5
				return 'second'
			}),
		).rejects.toMatchObject({ name: 'TimeoutError' })
		expect(contractDeploymentScanDue(undefined, 1_000)).toBe(true)
		expect(contractDeploymentScanDue(1_000, 60_999)).toBe(false)
		expect(contractDeploymentScanDue(1_000, 61_000)).toBe(true)
	})

	test('removes completed delay listeners from the shared shutdown signal', async () => {
		const controller = new AbortController()
		for (let index = 0; index < 20; index++) await waitForIndexerDelay(0, controller.signal)
		expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
	})

	test('never runs an indexing operation against a mismatched fallback provider', async () => {
		const operations: string[] = []
		const providers = [
			{ name: 'correct-but-offline', getChainId: async () => 1, read: async () => Promise.reject(new Error('offline')) },
			{ name: 'wrong-chain', getChainId: async () => 11155111, read: async () => 'wrong data' },
		]
		await expect(
			withVerifiedProvider(providers, 1, async (provider) => {
				operations.push(provider.name)
				return await provider.read()
			}),
		).rejects.toThrow('RPC chain mismatch')
		expect(operations).toEqual(['correct-but-offline'])
	})

	test('fails over an entire operation to another verified provider', async () => {
		const providers = [
			{ name: 'primary', getChainId: async () => 1, read: async () => Promise.reject(new Error('offline')) },
			{ name: 'fallback', getChainId: async () => 1, read: async () => 'canonical data' },
		]
		expect(await withVerifiedProvider(providers, 1, (provider) => provider.read())).toBe('canonical data')
	})

	test('caches only successful provider chain verification', async () => {
		let chainIdReads = 0
		let verificationAvailable = false
		const provider = {
			getChainId: async () => {
				chainIdReads++
				if (!verificationAvailable) throw new Error('verification unavailable')
				return 1
			},
			read: async () => 'canonical data',
		}
		const verifiedProviders = new WeakSet<typeof provider>()
		await expect(
			withVerifiedProvider(
				[provider],
				1,
				(candidate) => candidate.read(),
				() => false,
				() => {},
				verifiedProviders,
			),
		).rejects.toThrow('verification unavailable')
		verificationAvailable = true
		expect(
			await withVerifiedProvider(
				[provider],
				1,
				(candidate) => candidate.read(),
				() => false,
				() => {},
				verifiedProviders,
			),
		).toBe('canonical data')
		expect(
			await withVerifiedProvider(
				[provider],
				1,
				(candidate) => candidate.read(),
				() => false,
				() => {},
				verifiedProviders,
			),
		).toBe('canonical data')
		expect(chainIdReads).toBe(2)
	})

	test('keeps RPC log address filters within public-provider limits', () => {
		expect(rpcLogAddressGroups(Array.from({ length: 12 }, (_, index) => index))).toEqual([
			[0, 1, 2, 3, 4],
			[5, 6, 7, 8, 9],
			[10, 11],
		])
		expect(
			rpcLogQueryGroups([
				{ address, fromBlock: 10n, startBlock: 10n },
				{ address: '0x2000000000000000000000000000000000000002', fromBlock: 20n, startBlock: 20n },
			]),
		).toEqual([
			{ addresses: [address], fromBlock: 10n },
			{ addresses: ['0x2000000000000000000000000000000000000002'], fromBlock: 20n },
		])
	})

	test('redacts arbitrary transport failures to a stable public message', () => {
		const secret = 'provider-key-sentinel'
		const message = safeIndexerFailure(new Error(`HTTP request failed at https://rpc.example/${secret}?token=${secret}`))

		expect(message).toBe('RPC request failed; retrying')
		expect(message).not.toContain(secret)
		expect(message).not.toContain('rpc.example')
	})

	test('reports safe transport diagnostics without exposing raw error messages', () => {
		const secret = 'provider-key-sentinel'
		const transportError = Object.assign(new Error(`HTTP request failed at https://rpc.example/${secret}?token=${secret}`), {
			code: 'HTTP_429',
			name: 'HttpRequestError',
			status: 429,
		})
		const error = new Error(`wrapped ${secret}`, { cause: transportError })
		error.name = 'ContractFunctionExecutionError'
		const reason = safeIndexerFailureReason(error)

		expect(reason).toBe('ContractFunctionExecutionError caused by HttpRequestError; HTTP 429; code HTTP_429; message: provider rate limit exceeded')
		expect(rpcFailureLogMessage('RPC request failed; retrying', '#1 https://rpc.example', reason)).toBe(
			'RPC request failed; retrying (RPC: #1 https://rpc.example; reason: ContractFunctionExecutionError caused by HttpRequestError; HTTP 429; code HTTP_429; message: provider rate limit exceeded)',
		)
		expect(reason).not.toContain(secret)
		expect(reason).not.toContain('rpc.example')
		expect(safeIndexerFailureReason(Object.assign(new Error(secret), { code: 'PROVIDER_KEY_SENTINEL', name: `${secret}Error` }))).toBe('UnknownError')
	})

	test('reports the concrete message and cause for generic transport errors', () => {
		const cause = Object.assign(new Error('connection timed out'), { code: 'ETIMEDOUT', name: 'ConnectTimeoutError' })
		const error = new TypeError('fetch failed', { cause })

		expect(rpcIndexerFailureReason(error)).toBe('TypeError: fetch failed caused by ConnectTimeoutError: connection timed out; code ETIMEDOUT')
		expect(rpcIndexerFailureReason({ code: 'ECONNREFUSED', message: 'provider connection refused' })).toBe(
			'UnknownError: provider connection refused; code ECONNREFUSED',
		)
		expect(rpcIndexerFailureReason(new Error('request failed', { cause: 'socket closed' }))).toBe('Error: request failed caused by UnknownError: socket closed')
		expect(rpcIndexerFailureReason(new Error('fetch failed', { cause: new TypeError('fetch failed') }))).toBe('Error: fetch failed caused by TypeError')
		expect(rpcIndexerFailureReason(new TypeError('fetch failed\n\u001b[31mconnection refused\u001b[0m'))).toBe('TypeError: fetch failed connection refused')
	})

	test('retains unknown-node diagnostics for provider RPC failures', () => {
		const secret = 'provider-key-sentinel'
		const error = Object.assign(new Error(`request failed at https://rpc.example/${secret}`), {
			name: 'UnknownNodeError',
			shortMessage: 'request rate exceeded',
		})

		const reason = safeIndexerFailureReason(error)
		expect(reason).toBe('UnknownNodeError; message: provider rate limit exceeded')
		expect(reason).not.toContain(secret)
		expect(reason).not.toContain('rpc.example')
	})

	test('identifies the active RPC number after provider failover', async () => {
		const failure = new RpcRequestError({
			body: { method: 'eth_getLogs' },
			error: { code: -32000, message: 'upstream rejected query' },
			url: 'https://rpc.example',
		})
		const firstProvider = {
			endpoint: '#1 https://rpc-one.example',
			getChainId: async () => 1,
			number: 1,
			read: async () => Promise.reject(new Error('offline')),
		}
		const secondProvider = { endpoint: '#2 https://rpc-two.example', getChainId: async () => 1, number: 2, read: async () => Promise.reject(failure) }
		const providers = [firstProvider, secondProvider]
		const diagnostics = createRpcDiagnosticContext(firstProvider)
		let rejected: unknown
		try {
			await withVerifiedProvider(
				providers,
				1,
				(provider) => provider.read(),
				() => false,
				(provider) => diagnostics.select(provider),
			)
		} catch (error) {
			rejected = error
		}

		expect(rejected).toBe(failure)
		expect(diagnostics.failureReason(rejected)).toBe('RPC #2: RpcRequestError: upstream rejected query; code -32000 (Server error)')
		expect(diagnostics.activeEndpoint()).toBe('#2 https://rpc-two.example')
	})

	test('does not attribute database or lease failures to the active RPC', () => {
		const databaseFailure = new Error('connection closed')
		databaseFailure.name = 'PostgresError'
		const leaseFailure = new Error('lease lost')

		expect(indexerOperationFailureReason(databaseFailure, 2, 'storage')).toBe('PostgresError')
		expect(indexerOperationFailureReason(leaseFailure, 2, 'storage')).toBe('Error')
		expect(indexerOperationFailureReason(leaseFailure, 2, 'storage')).not.toContain('RPC #2')
	})

	test('reports a sanitized JSON-RPC provider message without request or endpoint secrets', async () => {
		const secret = 'provider-key-sentinel'
		const rangeError = new RpcRequestError({
			body: { method: 'eth_getLogs', params: [secret] },
			error: { code: -32600, message: 'block range limit is 10 blocks' },
			url: `https://rpc.example/${secret}?token=${secret}`,
		})
		expect(safeIndexerFailureReason(rangeError)).toBe('RpcRequestError; code -32600 (Invalid Request); message: provider rejected the requested block range')

		const numericCredential = '123456'
		const numericRangeError = new RpcRequestError({
			body: { method: 'eth_getLogs' },
			error: { code: Number(numericCredential), message: `Bearer ${numericCredential}; block range limit is ${numericCredential} blocks` },
			url: 'https://rpc.example',
		})
		const numericWarnings: string[] = []
		await queryAdaptiveLogRange(
			0n,
			1n,
			2,
			async (fromBlock, toBlock) => {
				if (fromBlock !== toBlock) throw numericRangeError
				return []
			},
			(failedFrom, failedTo, retryTo, error) =>
				numericWarnings.push(`RPC log range #${failedFrom}-#${failedTo} failed (${safeIndexerFailureReason(error)}); retrying #${failedFrom}-#${retryTo}`),
			isSplittableLogRangeError,
		)
		expect(numericWarnings).toEqual(['RPC log range #0-#1 failed (RpcRequestError; message: provider rejected the requested block range); retrying #0-#0'])
		expect(numericWarnings.join(' ')).not.toContain(numericCredential)

		const unsafeMessage = new RpcRequestError({
			body: { method: 'eth_getLogs' },
			error: { code: -32600, message: `invalid token=${secret} at https://rpc.example/${secret}` },
			url: 'https://rpc.example',
		})
		const reason = safeIndexerFailureReason(unsafeMessage)
		expect(reason).toBe('RpcRequestError; code -32600 (Invalid Request)')
		expect(reason).not.toContain(secret)
		expect(reason).not.toContain('rpc.example')

		for (const [details, expectedMessage, splittable] of [
			['query returned more than 10000 results', 'provider returned too many results', true],
			['query timed out', 'provider request timed out', true],
			['response size exceeded', 'provider response size limit exceeded', true],
			['rate limit exceeded', 'provider rate limit exceeded', false],
			['rate-limit exceeded', 'provider rate limit exceeded', false],
			['rate_limit.exceeded', 'provider rate limit exceeded', false],
			['rate\tlimit\u001bexceeded', 'provider rate limit exceeded', false],
			['rate\u200blimit exceeded', 'provider rate limit exceeded', false],
		] as const) {
			const diagnosticError = new RpcRequestError({
				body: { method: 'eth_getLogs' },
				error: { code: -32600, message: details },
				url: 'https://rpc.example',
			})
			expect(safeIndexerFailureReason(diagnosticError)).toBe(`RpcRequestError; code -32600 (Invalid Request); message: ${expectedMessage}`)
			expect(isSplittableLogRangeError(diagnosticError)).toBe(splittable)
		}

		const quotedSecrets = new RpcRequestError({
			body: { method: 'eth_getLogs' },
			error: {
				code: -32600,
				message: `credentials {"token":"${secret}", "client_secret":"${secret}"}; password = "provider key ${secret}"; endpoint wss://rpc.example/${secret}`,
			},
			url: 'https://rpc.example',
		})
		const quotedReason = safeIndexerFailureReason(quotedSecrets)
		expect(quotedReason).toBe('RpcRequestError; code -32600 (Invalid Request)')
		expect(quotedReason).not.toContain(secret)
		expect(quotedReason).not.toContain('rpc.example')
		expect(quotedReason).not.toContain('\n')
		expect(quotedReason.length).toBeLessThanOrEqual(360)

		const escapedQuotedPassword = `{"password":"safe${String.fromCodePoint(92)}"${secret}"}`
		const adversarialMessage = new RpcRequestError({
			body: { method: 'eth_getLogs' },
			error: {
				code: -32600,
				message: `password=first ${secret}; ${escapedQuotedPassword}; endpoint wss://[2001:db8::1]/${secret}`,
			},
			url: 'https://rpc.example',
		})
		const adversarialReason = safeIndexerFailureReason(adversarialMessage)
		expect(adversarialReason).not.toContain(secret)
		expect(adversarialReason).not.toContain('2001:db8::1')
		expect(adversarialReason).not.toContain('wss://')

		const apostropheUrl = new RpcRequestError({
			body: { method: 'eth_getLogs' },
			error: { code: -32600, message: `endpoint https://rpc.example/key'${secret} rejected the range` },
			url: 'https://rpc.example',
		})
		const apostropheReason = safeIndexerFailureReason(apostropheUrl)
		expect(apostropheReason).not.toContain(secret)
		expect(apostropheReason).not.toContain('rpc.example')

		const escapedBearer = `Bearer "safe${String.fromCodePoint(92)}"${secret}"`
		const bearerMessage = new RpcRequestError({
			body: { method: 'eth_getLogs' },
			error: {
				code: -32600,
				message: `${escapedBearer}; Bearer first\u001b ${secret}; block range limit is 10 blocks`,
			},
			url: 'https://rpc.example',
		})
		const bearerReason = safeIndexerFailureReason(bearerMessage)
		expect(bearerReason).not.toContain(secret)
		expect(bearerReason).toContain('provider rejected the requested block range')

		for (const unsafeDetails of [
			String.raw`{\"token\":\"${secret}\"}`,
			String.raw`\`token\`=\`${secret}\``,
			String.raw`request https:\/\/rpc.example\/${secret} failed`,
			String.raw`echoed body {\"params\":[\"${secret}\"]}`,
		]) {
			const escapedReason = safeIndexerFailureReason(
				new RpcRequestError({
					body: { method: 'eth_getLogs' },
					error: { code: -32600, message: unsafeDetails },
					url: 'https://rpc.example',
				}),
			)
			expect(escapedReason).toBe('RpcRequestError; code -32600 (Invalid Request)')
			expect(escapedReason).not.toContain(secret)
			expect(escapedReason).not.toContain('rpc.example')
		}

		const controlMessage = new RpcRequestError({
			body: { method: 'eth_getLogs' },
			error: { code: -32600, message: 'range too wide\u001bEfor logs\u0085retry on a smaller range' },
			url: 'https://rpc.example',
		})
		const controlReason = safeIndexerFailureReason(controlMessage)
		expect(
			[...controlReason].some((character) => {
				const codePoint = character.codePointAt(0)
				return codePoint !== undefined && (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
			}),
		).toBe(false)
		expect(controlReason).toContain('message: provider rejected the requested block range')
	})

	test('reports one stopped transition after graceful lifecycle shutdown', async () => {
		const controller = new AbortController()
		const info = spyOn(console, 'info').mockImplementation(() => {})
		try {
			await runIndexerTask('sepolia', () =>
				runNetworkLifecycle({
					verify: async () => {},
					poll: async () => {
						controller.abort()
						return true
					},
					failure: async () => {},
					intervalMs: 1,
					signal: controller.signal,
				}),
			)
			expect(info.mock.calls.filter(([message]) => message === '[sepolia] indexer state: stopped')).toHaveLength(1)
		} finally {
			info.mockRestore()
		}
	})

	test('identifies RPC providers during failover without exposing credentials, paths, or credential subdomains', async () => {
		const secret = 'provider-key-sentinel'
		const providers = [
			`https://rpc-user:${secret}@rpc.example/first`,
			`https://rpc.example/${secret}?token=${secret}`,
			`https://${secret}.rpc.example/third`,
		].map((rpcUrl, index) => ({
			endpoint: rpcProviderLabel(rpcUrl, index),
			getChainId: async () => 1,
			read: async () => Promise.reject(new Error('offline')),
		}))
		let attemptedEndpoint = ''
		await expect(
			withVerifiedProvider(
				providers,
				1,
				(provider) => provider.read(),
				() => false,
				(provider) => {
					attemptedEndpoint = provider.endpoint
				},
			),
		).rejects.toThrow('offline')
		const message = rpcFailureLogMessage('RPC request failed; retrying', attemptedEndpoint)

		expect(message).toBe('RPC request failed; retrying (RPC: #3 https://*.rpc.example)')
		expect(message).not.toContain(secret)
		expect(message).not.toContain('rpc-user')
	})

	test('reports database failures separately without leaking details', () => {
		const error = new Error('postgres://user:secret@database/augurscan')
		error.name = 'PostgresError'
		expect(safeIndexerFailure(error)).toBe('Database request failed; retrying')
	})

	test('reports and retries failed startup deployment reconciliation before polling', async () => {
		const controller = new AbortController()
		const failures: string[] = []
		const reasons: string[] = []
		let reconciliationAttempts = 0
		let polls = 0

		await runOwnedNetworkLifecycle({
			reconcile: async () => {
				reconciliationAttempts++
				if (reconciliationAttempts === 1) throw new Error('temporary deployment lookup timeout\n\u001b[31mwith secret=provider-key-sentinel\u001b[0m')
			},
			poll: async () => {
				polls++
				controller.abort()
				return true
			},
			failure: async (message, _nextRetryAt, reason) => {
				failures.push(message)
				reasons.push(reason)
			},
			runWithProvider: async (operation) => await operation(),
			intervalMs: 1,
			signal: controller.signal,
			random: () => 0.5,
		})

		expect(reconciliationAttempts).toBe(2)
		expect(polls).toBe(1)
		expect(failures).toEqual(['RPC request failed; retrying'])
		expect(reasons).toEqual(['Error: temporary deployment lookup timeout with secret=provider-key-sentinel'])
	})

	test('preserves actionable reconciliation consistency failures without polling', async () => {
		const controller = new AbortController()
		let polls = 0
		let failures = 0
		const error = new DatabaseConsistencyError('unsafe internal ancestor detail', {
			code: 'manifest-backfill-ancestor-missing',
			ancestor: 49n,
		})

		await expect(
			runOwnedNetworkLifecycle({
				reconcile: async () => {
					throw error
				},
				poll: async () => {
					polls++
					return true
				},
				failure: async () => {
					failures++
				},
				runWithProvider: async (operation) => await operation(),
				intervalMs: 1,
				signal: controller.signal,
			}),
		).rejects.toBe(error)
		expect(polls).toBe(0)
		expect(failures).toBe(0)
		const log = ownershipFailureLogMessage('sepolia', 'owned-run', error, 1, 10)
		expect(log).toContain('Manifest backfill cannot find canonical block 49; rebuild the augurScan database from the configured start block')
		expect(log).not.toContain('unsafe internal ancestor detail')
	})

	test('keeps retrying an RPC outage until the network recovers', async () => {
		const controller = new AbortController()
		let attempts = 0
		const failures: string[] = []

		await runNetworkLifecycle({
			verify: async () => {},
			poll: async () => {
				attempts++
				if (attempts < 4) throw new Error('RPC offline')
				controller.abort()
				return true
			},
			failure: async (message) => {
				failures.push(message)
			},
			intervalMs: 1,
			signal: controller.signal,
			random: () => 0.5,
		})

		expect(attempts).toBe(4)
		expect(failures).toEqual(['RPC request failed; retrying', 'RPC request failed; retrying', 'RPC request failed; retrying'])
	})

	test('attributes a network failure-recording error to the ownership recording stage', async () => {
		const controller = new AbortController()
		const events: unknown[] = []
		let recordings = 0
		const logged = spyOn(console, 'error').mockImplementation(() => {})
		try {
			await runIndexerOwnershipLifecycle({
				networkId: 'mainnet',
				acquire: async () => ({ backendPid: 42, assertHeld: async () => {}, release: async () => {} }),
				seed: async () => {},
				runOwned: async () => {
					await runNetworkLifecycle({
						verify: async () => {},
						poll: async () => {
							throw new Error('RPC unavailable')
						},
						failure: async () => {
							throw new Error('first record failed')
						},
						intervalMs: 10,
						signal: controller.signal,
					})
				},
				failure: async () => {
					recordings++
					controller.abort()
				},
				standby: () => {},
				intervalMs: 10,
				onEvent: (event) => events.push(event),
				random: () => 0.5,
				signal: controller.signal,
			})

			expect(recordings).toBe(1)
			expect(events).toContainEqual({ type: 'failure', stage: 'record-failure', consecutiveFailures: 1, retryDelayMs: 10, backendPid: 42 })
			expect(logged).toHaveBeenCalledWith(
				'[mainnet] indexer ownership failed; stage: record-failure; consecutive failures: 1; retry delay: 10ms; backend PID: 42; reason: IndexerOwnershipStageError caused by Error',
			)
		} finally {
			logged.mockRestore()
		}
	})

	test('does not turn token metadata transport failures into committed fallback data', async () => {
		const transportFailure = new Error('provider unavailable')
		transportFailure.name = 'HttpRequestError'
		await expect(
			readTokenMetadata(address, 10n, {
				decimals: async () => {
					throw transportFailure
				},
				name: async () => 'Token',
				symbol: async () => 'TKN',
			}),
		).rejects.toThrow('provider unavailable')
		await expect(
			readTokenMetadata(address, 10n, {
				decimals: async () => 18,
				name: async () => {
					throw transportFailure
				},
				symbol: async () => 'TKN',
			}),
		).rejects.toThrow('provider unavailable')
		await expect(
			readTokenMetadata(address, 10n, {
				decimals: async () => 18,
				name: async () => {
					throw new RpcError('state at block #10 is pruned', { code: -32603, shortMessage: 'state at block #10 is pruned' })
				},
				symbol: async () => {
					throw transportFailure
				},
			}),
		).rejects.toThrow('provider unavailable')
	})

	test('records a stable fallback for contracts that do not implement token metadata', async () => {
		const reverted = new Error('execution reverted')
		reverted.name = 'ContractFunctionRevertedError'
		const zeroData = new Error('returned no data')
		zeroData.name = 'ContractFunctionZeroDataError'

		expect(
			await readTokenMetadata(address, 10n, {
				decimals: async () => {
					throw new Error('metadata wrapper', { cause: reverted })
				},
				name: async () => 'Token',
				symbol: async () => 'TKN',
			}),
		).toEqual({ address, readError: 'ERC-20 metadata unavailable', readBlock: 10n })
		expect(
			await readTokenMetadata(address, 10n, {
				decimals: async () => 6,
				name: async () => {
					throw zeroData
				},
				symbol: async () => 'TKN',
			}),
		).toEqual({ address, decimals: 6, symbol: 'TKN', readBlock: 10n })
	})

	test('records retryable unavailable metadata when any historical metadata field is pruned', async () => {
		const pruned = new RpcRequestMethodError(
			'eth_call',
			new RpcError('state at block #11000001 is pruned', { code: -32603, shortMessage: 'state at block #11000001 is pruned' }),
			'#1 http://reth:8545',
		)
		for (const prunedField of ['decimals', 'name', 'symbol'] as const) {
			const metadata = await readTokenMetadata(address, 11_000_001n, {
				decimals: async () => {
					if (prunedField === 'decimals') throw pruned
					return 18
				},
				name: async () => {
					if (prunedField === 'name') throw pruned
					return 'Token'
				},
				symbol: async () => {
					if (prunedField === 'symbol') throw pruned
					return 'TKN'
				},
			})
			expect(metadata).toEqual({ address, readError: 'ERC-20 metadata unavailable', readBlock: 11_000_001n })
			expect(tokenMetadataNeedsRead(metadata, 11_000_025n)).toBe(false)
			expect(tokenMetadataNeedsRead(metadata, 11_000_026n)).toBe(true)
		}
	})

	test('retries an essential historical state read at the observed head only when state is pruned', async () => {
		const attemptedBlocks: bigint[] = []
		const result = await readWithPrunedStateFallback(11_000_001n, 12_000_000n, async (blockNumber) => {
			attemptedBlocks.push(blockNumber)
			if (blockNumber === 11_000_001n)
				throw new RpcRequestMethodError(
					'eth_call',
					new RpcError('state at block #11000001 is pruned', { code: -32603, shortMessage: 'state at block #11000001 is pruned' }),
					'#1 http://reth:8545',
				)
			return 'available'
		})
		expect(result).toEqual({ blockNumber: 12_000_000n, value: 'available' })
		expect(attemptedBlocks).toEqual([11_000_001n, 12_000_000n])
		expect(isPrunedHistoricalStateError(new Error('temporary provider failure'))).toBe(false)
	})

	test('does not move ordinary historical state failures to another block', async () => {
		const attemptedBlocks: bigint[] = []
		await expect(
			readWithPrunedStateFallback(11_000_001n, 12_000_000n, async (blockNumber) => {
				attemptedBlocks.push(blockNumber)
				throw new Error('temporary provider failure')
			}),
		).rejects.toThrow('temporary provider failure')
		expect(attemptedBlocks).toEqual([11_000_001n])
	})

	test('records metadata fallback from actual zero-data and revert RPC responses', async () => {
		for (const response of [
			Response.json({ id: 1, jsonrpc: '2.0', result: '0x' }),
			Response.json({ error: { code: 3, message: 'execution reverted' }, id: 1, jsonrpc: '2.0' }),
		]) {
			const client = createPublicClient({
				transport: withRpcRequestQueue(
					http('https://rpc.example', {
						fetchFn: async () => response.clone(),
						retryCount: 0,
					}),
					createRpcRequestQueue(1),
				),
			})
			expect(
				await readTokenMetadata(address, 10n, {
					decimals: async () => {
						const result = await client.readContract({ address, abi: metadataAbi, functionName: 'decimals', blockNumber: 10n })
						if (typeof result !== 'bigint') throw new Error('Invalid decimals result')
						return Number(result)
					},
					name: async () => 'Token',
					symbol: async () => 'TKN',
				}),
			).toEqual({ address, readError: 'ERC-20 metadata unavailable', readBlock: 10n })
		}
	})

	test('records fallback metadata for malformed contract return bytes', async () => {
		const invalidDecimals = malformedDecimalsResult()
		const invalidString = (functionName: 'name' | 'symbol') => malformedMetadataResult(functionName, toHex(64n, { size: 32 }))
		expect(
			await readTokenMetadata(address, 10n, {
				decimals: async () => {
					throw invalidDecimals
				},
				name: async () => 'Token',
				symbol: async () => 'TKN',
			}),
		).toEqual({ address, readError: 'ERC-20 metadata unavailable', readBlock: 10n })
		expect(
			await readTokenMetadata(address, 10n, {
				decimals: async () => 6,
				name: async () => {
					throw invalidString('name')
				},
				symbol: async () => 'TKN',
			}),
		).toEqual({ address, decimals: 6, symbol: 'TKN', readBlock: 10n })
		expect(
			await readTokenMetadata(address, 10n, {
				decimals: async () => 6,
				name: async () => 'Token',
				symbol: async () => {
					throw invalidString('symbol')
				},
			}),
		).toEqual({ address, decimals: 6, name: 'Token', readBlock: 10n })
	})

	test('retries failed token metadata reads with bounded block backoff', () => {
		expect(tokenMetadataNeedsRead(undefined, 1n)).toBe(true)
		expect(tokenMetadataNeedsRead(tokenMetadata, 34n)).toBe(false)
		expect(tokenMetadataNeedsRead(tokenMetadata, 35n)).toBe(true)
		expect(tokenMetadataNeedsRead({ ...tokenMetadata, decimals: 6, readError: undefined }, 100n)).toBe(false)
	})

	test('never requires RPC history below a configured start boundary', () => {
		expect(requiresParentLookup(1_000n, 1_000n)).toBe(false)
		expect(requiresParentLookup(1_001n, 1_000n)).toBe(true)
		expect(reorgSearchFloor(1_000n, 1_003n, 64n)).toBe(1_000n)
		expect(reorgSearchFloor(1_000n, 2_000n, 64n)).toBe(1_936n)
	})

	test('refuses to commit a block that changed during RPC collection', async () => {
		const indexedHash = `0x${'1'.repeat(64)}` as const
		const replacementHash = `0x${'2'.repeat(64)}` as const
		await expect(confirmCanonicalBlock(100n, indexedHash, async () => replacementHash)).rejects.toThrow('Block 100 changed while it was being indexed')
		expect(safeIndexerFailure(await confirmCanonicalBlock(100n, indexedHash, async () => replacementHash).catch((error) => error))).toBe(
			'The remote canonical chain changed while indexing; retrying',
		)
		await expect(confirmCanonicalBlock(100n, indexedHash, async () => indexedHash)).resolves.toBeUndefined()
	})

	test('does not commit balance evidence when the anchor changes after the read', async () => {
		const indexedHash = `0x${'1'.repeat(64)}` as const
		const replacementHash = `0x${'2'.repeat(64)}` as const
		let committed = false
		await expect(
			commitCanonicalRead(
				100n,
				indexedHash,
				async () => ['balance evidence'],
				async () => replacementHash,
				async () => {
					committed = true
				},
			),
		).rejects.toThrow('Block 100 changed while it was being indexed')
		expect(committed).toBe(false)
	})

	test('retries lock acquisition and seeding before running as owner', async () => {
		const controller = new AbortController()
		let acquisitions = 0
		let seeds = 0
		let ownedRuns = 0
		let unownedFailures = 0
		const failures: string[] = []
		const lease = { assertHeld: async () => {}, release: async () => {} }

		await runIndexerOwnershipLifecycle({
			networkId: 'sepolia',
			acquire: async () => {
				acquisitions++
				if (acquisitions === 1) throw new Error('database starting')
				return lease
			},
			seed: async () => {
				seeds++
				if (seeds === 1) throw new Error('database recovering')
			},
			runOwned: async () => {
				ownedRuns++
				controller.abort()
			},
			failure: async (message, currentLease) => {
				if (currentLease === undefined) unownedFailures++
				else failures.push(message)
			},
			standby: () => {},
			intervalMs: 1,
			random: () => 0.5,
			signal: controller.signal,
		})

		expect(acquisitions).toBe(3)
		expect(seeds).toBe(2)
		expect(ownedRuns).toBe(1)
		expect(unownedFailures).toBe(1)
		expect(failures).toEqual(['Database request failed; retrying'])
	})

	test('logs an actionable configured-boundary failure during ownership seeding', async () => {
		const controller = new AbortController()
		const error = new DatabaseConsistencyError(
			'Cannot change the configured start block from 100 to 200 while checkpoint 125 exists; rebuild the augurScan database from the new start block',
			{ code: 'start-block-mismatch', configuredStartBlock: 200n, storedStartBlock: 100n, indexedBlock: 125n },
		)
		let seeds = 0
		const logged = spyOn(console, 'error').mockImplementation(() => {})
		try {
			await runIndexerOwnershipLifecycle({
				networkId: 'sepolia',
				acquire: async () => ({ assertHeld: async () => {}, release: async () => {} }),
				seed: async () => {
					seeds++
					if (seeds === 1) throw error
				},
				runOwned: async () => controller.abort(),
				failure: async () => {},
				standby: () => {},
				intervalMs: 1,
				signal: controller.signal,
			})
			expect(logged).toHaveBeenCalledWith(
				`[sepolia] indexer ownership failed; stage: seed; consecutive failures: 1; retry delay: 1ms; backend PID: unavailable; reason: DatabaseConsistencyError: ${error.message}`,
			)
		} finally {
			logged.mockRestore()
		}
	})

	test('reports sanitized ownership stages and backs off rapid failures', async () => {
		const controller = new AbortController()
		const delays: number[] = []
		const ownershipEvents: unknown[] = []
		let acquisitions = 0
		const logged = spyOn(console, 'error').mockImplementation(() => {})
		try {
			await runIndexerOwnershipLifecycle({
				networkId: 'mainnet',
				acquire: async () => {
					acquisitions++
					if (acquisitions === 1) throw Object.assign(new Error('postgres://user:secret@database/augurscan'), { code: 'ECONNRESET' })
					return {
						backendPid: 42,
						assertHeld: async () => {
							if (acquisitions === 2) throw new Error('lease missing')
						},
						release: async () => {},
					}
				},
				seed: async () => {},
				runOwned: async () => controller.abort(),
				failure: async () => {},
				standby: () => {},
				intervalMs: 10,
				onEvent: (event) => ownershipEvents.push(event),
				random: () => 0.5,
				wait: async (delay) => {
					delays.push(delay)
				},
				signal: controller.signal,
			})

			expect(delays).toEqual([10, 20])
			expect(ownershipEvents).toEqual([
				{ type: 'failure', stage: 'acquire', consecutiveFailures: 1, retryDelayMs: 10 },
				{ type: 'failure', stage: 'verify', consecutiveFailures: 2, retryDelayMs: 20, backendPid: 42 },
				{ type: 'released', backendPid: 42 },
				{ type: 'acquired', backendPid: 42, recoveredAfterFailures: 2, acquiredAfterStandby: false },
				{ type: 'released', backendPid: 42 },
			])
			expect(logged).toHaveBeenNthCalledWith(
				1,
				'[mainnet] indexer ownership failed; stage: acquire; consecutive failures: 1; retry delay: 10ms; backend PID: unavailable; reason: Error; code ECONNRESET',
			)
			expect(logged).toHaveBeenNthCalledWith(
				2,
				'[mainnet] indexer ownership failed; stage: verify; consecutive failures: 2; retry delay: 20ms; backend PID: 42; reason: Error',
			)
			expect(logged.mock.calls.flat().join(' ')).not.toContain('secret')
		} finally {
			logged.mockRestore()
		}
	})

	test('formats ownership recovery failures without exposing arbitrary messages', () => {
		const secret = 'postgres://user:password@database/augurscan'
		expect(ownershipFailureLogMessage('sepolia', 'owned-run', Object.assign(new Error(secret), { name: `${secret}Error` }), 3, 40, 123)).toBe(
			'[sepolia] indexer ownership failed; stage: owned-run; consecutive failures: 3; retry delay: 40ms; backend PID: 123; reason: UnknownError',
		)
		expect(ownershipFailureLogMessage('sepolia', 'seed', Object.assign(new Error(secret), { name: 'DatabaseConsistencyError' }), 1, 10)).toBe(
			'[sepolia] indexer ownership failed; stage: seed; consecutive failures: 1; retry delay: 10ms; backend PID: unavailable; reason: DatabaseConsistencyError',
		)
		expect(ownershipFailureLogMessage('sepolia', 'seed', new DatabaseConsistencyError(secret), 1, 10)).toBe(
			'[sepolia] indexer ownership failed; stage: seed; consecutive failures: 1; retry delay: 10ms; backend PID: unavailable; reason: DatabaseConsistencyError',
		)
		const moved = new DatabaseConsistencyError('unsafe original message', {
			code: 'lease-backend-moved',
			expectedBackendPid: 41,
			observedBackendPid: 42,
		})
		expect(ownershipFailureLogMessage('sepolia', 'owned-run', new Error('wrapper secret', { cause: moved }), 1, 10)).toContain(
			'Error caused by DatabaseConsistencyError: Indexer lease moved from PostgreSQL backend 41 to 42; use a direct connection or a session-mode pooler',
		)
	})

	test('backs off repeated immediate owned-run failures across reacquisition', async () => {
		const controller = new AbortController()
		const delays: number[] = []
		let ownedRuns = 0
		const logged = spyOn(console, 'error').mockImplementation(() => {})
		const recovered = spyOn(console, 'info').mockImplementation(() => {})
		try {
			await runIndexerOwnershipLifecycle({
				networkId: 'mainnet',
				acquire: async () => ({ backendPid: 42, assertHeld: async () => {}, release: async () => {} }),
				seed: async () => {},
				runOwned: async () => {
					ownedRuns++
					throw new Error('immediate owned failure')
				},
				failure: async () => {},
				standby: () => {},
				intervalMs: 10,
				random: () => 0.5,
				wait: async (delay) => {
					delays.push(delay)
					if (delays.length === 3) controller.abort()
				},
				signal: controller.signal,
			})

			expect(ownedRuns).toBe(3)
			expect(delays).toEqual([10, 20, 40])
			expect(logged.mock.calls.map(([message]) => message)).toEqual([
				'[mainnet] indexer ownership failed; stage: owned-run; consecutive failures: 1; retry delay: 10ms; backend PID: 42; reason: Error',
				'[mainnet] indexer ownership failed; stage: owned-run; consecutive failures: 2; retry delay: 20ms; backend PID: 42; reason: Error',
				'[mainnet] indexer ownership failed; stage: owned-run; consecutive failures: 3; retry delay: 40ms; backend PID: 42; reason: Error',
			])
		} finally {
			logged.mockRestore()
			recovered.mockRestore()
		}
	})

	test('reports acquisition after standby without treating standby as a failure', async () => {
		const controller = new AbortController()
		const ownershipEvents: unknown[] = []
		let acquisitions = 0
		const recovered = spyOn(console, 'info').mockImplementation(() => {})
		try {
			await runIndexerOwnershipLifecycle({
				networkId: 'sepolia',
				acquire: async () => {
					acquisitions++
					if (acquisitions === 1) return undefined
					return { backendPid: 52, assertHeld: async () => {}, release: async () => {} }
				},
				seed: async () => {},
				runOwned: async () => controller.abort(),
				failure: async () => {},
				standby: () => {},
				intervalMs: 10,
				onEvent: (event) => ownershipEvents.push(event),
				wait: async () => {},
				signal: controller.signal,
			})

			expect(ownershipEvents).toEqual([
				{ type: 'standby' },
				{ type: 'acquired', backendPid: 52, recoveredAfterFailures: 0, acquiredAfterStandby: true },
				{ type: 'released', backendPid: 52 },
			])
			expect(recovered).toHaveBeenCalledWith('[sepolia] indexer ownership reacquired; backend PID: 52; source: standby; previous consecutive failures: 0')
		} finally {
			recovered.mockRestore()
		}
	})

	test('tracks process-local ownership failures and reacquisitions for health diagnostics', () => {
		const failed = nextIndexerOwnershipStatus(
			'sepolia',
			undefined,
			{ type: 'failure', stage: 'verify', consecutiveFailures: 2, retryDelayMs: 24_000, backendPid: 41 },
			new Date('2026-08-13T10:00:00Z'),
		)
		expect(failed).toEqual({
			networkId: 'sepolia',
			active: false,
			backendPid: 41,
			failuresTotal: 1,
			reacquisitionsTotal: 0,
			consecutiveFailures: 2,
			lastFailureAt: '2026-08-13T10:00:00.000Z',
			lastFailureStage: 'verify',
		})
		expect(nextIndexerOwnershipStatus('sepolia', failed, { type: 'acquired', backendPid: 42, recoveredAfterFailures: 2, acquiredAfterStandby: false })).toEqual(
			{
				...failed,
				active: true,
				backendPid: 42,
				reacquisitionsTotal: 1,
				consecutiveFailures: 0,
			},
		)
		const standby = nextIndexerOwnershipStatus('mainnet', undefined, { type: 'standby' })
		expect(nextIndexerOwnershipStatus('mainnet', standby, { type: 'acquired', backendPid: 52, recoveredAfterFailures: 0, acquiredAfterStandby: true })).toEqual(
			{
				networkId: 'mainnet',
				active: true,
				backendPid: 52,
				failuresTotal: 0,
				reacquisitionsTotal: 1,
				consecutiveFailures: 0,
			},
		)
	})

	test('reports a lease release failure through ownership diagnostics', async () => {
		const controller = new AbortController()
		const ownershipEvents: unknown[] = []
		const logged = spyOn(console, 'error').mockImplementation(() => {})
		try {
			await runIndexerOwnershipLifecycle({
				networkId: 'mainnet',
				acquire: async () => ({
					backendPid: 42,
					assertHeld: async () => {},
					release: async () => {
						throw Object.assign(new Error('connection secret'), { code: 'ERR_POSTGRES_CONNECTION_CLOSED' })
					},
				}),
				seed: async () => {},
				runOwned: async () => controller.abort(),
				failure: async () => {},
				standby: () => {},
				intervalMs: 10,
				onEvent: (event) => ownershipEvents.push(event),
				random: () => 0.5,
				signal: controller.signal,
			})

			expect(ownershipEvents).toEqual([
				{ type: 'acquired', backendPid: 42, recoveredAfterFailures: 0, acquiredAfterStandby: false },
				{ type: 'failure', stage: 'release', consecutiveFailures: 1, retryDelayMs: 10, backendPid: 42 },
				{ type: 'released', backendPid: 42 },
			])
			expect(logged).toHaveBeenCalledWith(
				'[mainnet] indexer ownership failed; stage: release; consecutive failures: 1; retry delay: 10ms; backend PID: 42; reason: Error; code ERR_POSTGRES_CONNECTION_CLOSED',
			)
			expect(logged.mock.calls.flat().join(' ')).not.toContain('secret')
		} finally {
			logged.mockRestore()
		}
	})

	test('rejects an indexer lease that moves to another PostgreSQL backend', () => {
		expect(() => assertIndexerLeaseObservation(41, 41, true)).not.toThrow()
		expect(() => assertIndexerLeaseObservation(41, 42, true)).toThrow(
			'Indexer lease moved from PostgreSQL backend 41 to 42; use a direct connection or a session-mode pooler',
		)
		expect(() => assertIndexerLeaseObservation(41, 41, false)).toThrow(DatabaseConsistencyError)
		expect(() => assertIndexerLeaseObservation(41, 41, false)).toThrow('Indexer lease is no longer held by PostgreSQL backend 41')
	})

	test('rejects an indexer lease release on another backend or without an unlocked lock', () => {
		expect(() => assertIndexerLeaseReleaseObservation(41, 41, true)).not.toThrow()
		expect(() => assertIndexerLeaseReleaseObservation(41, 42, false)).toThrow('Indexer lease moved from PostgreSQL backend 41 to 42')
		expect(() => assertIndexerLeaseReleaseObservation(41, 41, false)).toThrow(
			'Indexer lease unlock failed on PostgreSQL backend 41; lock ownership may already be lost',
		)
	})

	test('does not select shared tokens as standalone activity sources', () => {
		const contract = (kind: string): ContractMetadata => ({
			address: '0x1000000000000000000000000000000000000001',
			label: kind,
			kind,
			provenance: 'manifest',
		})

		expect(isProtocolActivitySource(contract('weth'))).toBe(false)
		expect(isProtocolActivitySource(contract('usdc'))).toBe(false)
		expect(isProtocolActivitySource(contract('reputationToken'))).toBe(false)
		expect(isProtocolActivitySource(contract('multicall3'))).toBe(false)
		expect(isProtocolActivitySource(contract('proxyDeployer'))).toBe(false)
		expect(isProtocolEvidenceEmitter(contract('weth'))).toBe(true)
		expect(isProtocolEvidenceEmitter(contract('reputationToken'))).toBe(true)
		expect(isProtocolActivitySource(contract('openOracle'))).toBe(true)
		expect(isProtocolActivitySource(contract('shareToken'))).toBe(true)
	})
})
