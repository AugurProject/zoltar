import { describe, expect, spyOn, test } from 'bun:test'
import { getEventListeners } from 'node:events'
import {
	assertIndexerLeaseObservation,
	assertIndexerLeaseReleaseObservation,
	DatabaseConsistencyError,
	runFencedIndexerTransaction,
	type StoredTransaction,
} from '../src/database.ts'
import {
	BaseError,
	ContractFunctionExecutionError,
	decodeFunctionResult,
	HttpRequestError,
	parseAbi,
	RpcRequestError,
	TimeoutError,
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
	deploymentReadBudget,
	findContractDeploymentBlock,
	indexerOperationFailureReason,
	indexerProgressMessage,
	indexerWaitingMessage,
	indexingCompletion,
	isProtocolActivitySource,
	isProtocolEvidenceEmitter,
	isSplittableLogRangeError,
	nextIndexerOwnershipStatus,
	ownershipFailureLogMessage,
	planDeploymentAwareLogScan,
	queryAdaptiveLogRange,
	queryCanonicalLogRange,
	readTokenMetadata,
	reorgSearchFloor,
	requiresParentLookup,
	retryDelayMs,
	rpcFailureLogMessage,
	rpcLogAddressGroups,
	rpcLogQueryGroups,
	rpcProviderLabel,
	runIndexerOwnershipLifecycle,
	runIndexerTask,
	runNetworkLifecycle,
	safeIndexerFailure,
	safeIndexerFailureReason,
	tokenMetadataNeedsRead,
	uniswapV4PoolIds,
	waitForIndexerDelay,
	withVerifiedProvider,
} from '../src/indexer.ts'
import type { ContractMetadata, StoredLog, TokenMetadata } from '../src/types.ts'
import { isSupportedUniswapV4Market, uniswapV4PoolId } from '../src/uniswap.ts'

const tokenMetadata: TokenMetadata = {
	address: '0x1000000000000000000000000000000000000001',
	readError: 'ERC-20 metadata unavailable',
	readBlock: 10n,
}

const address = '0x1000000000000000000000000000000000000001' as const
const metadataAbi = parseAbi(['function decimals() view returns (uint8)', 'function name() view returns (string)', 'function symbol() view returns (string)'])

const malformedMetadataResult = (functionName: 'name' | 'symbol', data: `0x${string}`): Error => {
	try {
		decodeFunctionResult({ abi: metadataAbi, functionName, data })
		throw new Error(`Malformed ${functionName} result unexpectedly decoded`)
	} catch (error) {
		if (!(error instanceof BaseError)) throw error
		return new ContractFunctionExecutionError(error, { abi: metadataAbi, contractAddress: address, functionName })
	}
}

const malformedDecimalsResult = (): number => {
	const value = decodeFunctionResult({ abi: metadataAbi, functionName: 'decimals', data: toHex(256n, { size: 32 }) })
	if (typeof value !== 'number') throw new Error('Malformed decimals result did not decode to a number')
	return value
}

describe('network indexer lifecycle', () => {
	test('derives four distinct standard V4 pool IDs for each known universe REP token', () => {
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
		])
		const ids = uniswapV4PoolIds(contracts)
		expect(ids).toHaveLength(4)
		expect(new Set(ids).size).toBe(4)
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

	test('does not split viem HTTP rate-limit failures', async () => {
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
		expect(safeIndexerFailureReason(structuredRangeFailure)).toBe('RpcRequestError; code -32600; message: provider rejected the requested block range')
		const unrelatedStructuredFailure = new RpcRequestError({
			body: { method: 'eth_getLogs', params: ['request timed out'] },
			error: { code: -32600, message: 'upstream rejected query' },
			url: 'https://rpc.example/response-size/',
		})
		expect(isSplittableLogRangeError(unrelatedStructuredFailure)).toBe(false)
		expect(safeIndexerFailureReason(unrelatedStructuredFailure)).toBe('RpcRequestError; code -32600')
		const conflictingCause = new Error('request rate exceeded', { cause: structuredRangeFailure })
		expect(isSplittableLogRangeError(conflictingCause)).toBe(false)
		expect(safeIndexerFailureReason(conflictingCause)).toBe('Error caused by RpcRequestError; code -32600; message: provider rate limit exceeded')

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
			expect(safeIndexerFailureReason(failure)).toBe('RpcRequestError; code -32600; message: provider rate limit exceeded')
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
			expect(safeIndexerFailureReason(failure)).toBe(`RpcRequestError; code -32600; message: ${expectedMessage}`)
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

	test('splits viem timeout and oversized-response failures at exact inclusive boundaries', async () => {
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
			async (block) => new Date(Number(block) * 1_000),
		)
		expect(plan.inputs).toEqual([{ address, fromBlock: 75n, startBlock: 75n }])
		expect(plan.observations).toEqual([
			{ contractAddress: address, checkedBlock: 100n, deployment: { block: 75n, exact: true, timestamp: new Date(75_000) } },
			{ contractAddress: absent.address, checkedBlock: 100n },
		])
		expect(checkedBlocks).not.toContain(49n)
	})

	test('falls back to complete scanning when deployment detection fails', async () => {
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
		expect(diagnostics.failureReason(rejected)).toBe('RPC #2: RpcRequestError; code -32000')
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
		expect(safeIndexerFailureReason(rangeError)).toBe('RpcRequestError; code -32600; message: provider rejected the requested block range')

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
		expect(reason).toBe('RpcRequestError; code -32600')
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
			expect(safeIndexerFailureReason(diagnosticError)).toBe(`RpcRequestError; code -32600; message: ${expectedMessage}`)
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
		expect(quotedReason).toBe('RpcRequestError; code -32600')
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
			expect(escapedReason).toBe('RpcRequestError; code -32600')
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

	test('retries initial chain verification and begins polling after recovery', async () => {
		const controller = new AbortController()
		const failures: string[] = []
		let verificationAttempts = 0
		let polls = 0

		await runNetworkLifecycle({
			verify: async () => {
				verificationAttempts++
				if (verificationAttempts === 1) throw new Error('temporary timeout with secret=provider-key-sentinel')
			},
			poll: async () => {
				polls++
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

		expect(verificationAttempts).toBe(2)
		expect(polls).toBe(1)
		expect(failures).toEqual(['RPC request failed; retrying'])
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

	test('records fallback metadata for malformed contract return bytes', async () => {
		const invalidDecimals = malformedDecimalsResult()
		const invalidString = (functionName: 'name' | 'symbol') => malformedMetadataResult(functionName, toHex(64n, { size: 32 }))
		expect(
			await readTokenMetadata(address, 10n, {
				decimals: async () => invalidDecimals,
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

	test('does not run a leased mutation when the transaction uses another PostgreSQL backend', async () => {
		let mutated = false
		const transaction = { backendPid: 42 }

		await expect(
			runFencedIndexerTransaction(
				async (operation) => await operation(transaction),
				async (activeTransaction: { readonly backendPid: number }) => assertIndexerLeaseObservation(41, activeTransaction.backendPid, true),
				async () => {
					mutated = true
				},
			),
		).rejects.toThrow('Indexer lease moved from PostgreSQL backend 41 to 42')
		expect(mutated).toBeFalse()
	})

	test('does not select shared tokens as standalone activity sources', () => {
		const contract = (kind: string): ContractMetadata => ({
			address: '0x1000000000000000000000000000000000000001',
			label: kind,
			kind,
			provenance: 'manifest',
		})

		expect(isProtocolActivitySource(contract('weth'))).toBe(false)
		expect(isProtocolActivitySource(contract('reputationToken'))).toBe(false)
		expect(isProtocolActivitySource(contract('multicall3'))).toBe(false)
		expect(isProtocolActivitySource(contract('proxyDeployer'))).toBe(false)
		expect(isProtocolEvidenceEmitter(contract('weth'))).toBe(true)
		expect(isProtocolEvidenceEmitter(contract('reputationToken'))).toBe(true)
		expect(isProtocolActivitySource(contract('openOracle'))).toBe(true)
		expect(isProtocolActivitySource(contract('shareToken'))).toBe(true)
	})
})
