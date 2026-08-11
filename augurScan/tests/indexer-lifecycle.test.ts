import { describe, expect, spyOn, test } from 'bun:test'
import { getEventListeners } from 'node:events'
import type { StoredTransaction } from '../src/database.ts'
import { BaseError, ContractFunctionExecutionError, decodeFunctionResult, parseAbi, toHex } from '../src/ethereum.ts'
import {
	addressActivityFrom,
	boundedDeploymentRead,
	commitCanonicalRead,
	confirmCanonicalBlock,
	contractDeploymentScanDue,
	findContractDeploymentBlock,
	indexerProgressMessage,
	isProtocolActivitySource,
	isProtocolEvidenceEmitter,
	readTokenMetadata,
	reorgSearchFloor,
	requiresParentLookup,
	retryDelayMs,
	rpcFailureLogMessage,
	rpcLogAddressGroups,
	rpcProviderLabel,
	runIndexerOwnershipLifecycle,
	runIndexerTask,
	runNetworkLifecycle,
	safeIndexerFailure,
	safeIndexerFailureReason,
	tokenMetadataNeedsRead,
	waitForIndexerDelay,
	withVerifiedProvider,
} from '../src/indexer.ts'
import type { ContractMetadata, StoredLog, TokenMetadata } from '../src/types.ts'

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
		expect(indexerProgressMessage('mainnet', 100n, 119n, 1_000n)).toBe(
			'[mainnet] indexer state: backfilling; indexed blocks #100–#119; observed head #1000; 881 blocks behind',
		)
		expect(indexerProgressMessage('sepolia', 1_000n, 1_000n, 1_000n)).toBe('[sepolia] indexer state: live; indexed block #1000; observed head #1000; caught up')
	})

	test('finds the first block containing contract code and distinguishes a bounded result', async () => {
		expect(await findContractDeploymentBlock(0n, 100n, async (block) => (block >= 42n ? '0x01' : undefined))).toEqual({ block: 42n, exact: true })
		expect(await findContractDeploymentBlock(50n, 100n, async () => '0x01')).toEqual({ block: 50n, exact: false })
		expect(await findContractDeploymentBlock(0n, 100n, async () => undefined)).toBeUndefined()
	})

	test('bounds a stalled optional contract deployment history read', async () => {
		await expect(boundedDeploymentRead(() => new Promise(() => {}), 1)).rejects.toMatchObject({ name: 'TimeoutError' })
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

	test('keeps RPC log address filters within public-provider limits', () => {
		expect(rpcLogAddressGroups(Array.from({ length: 12 }, (_, index) => index))).toEqual([
			[0, 1, 2, 3, 4],
			[5, 6, 7, 8, 9],
			[10, 11],
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

		expect(reason).toBe('ContractFunctionExecutionError caused by HttpRequestError; HTTP 429; code HTTP_429')
		expect(rpcFailureLogMessage('RPC request failed; retrying', '#1 https://rpc.example', reason)).toBe(
			'RPC request failed; retrying (RPC: #1 https://rpc.example; reason: ContractFunctionExecutionError caused by HttpRequestError; HTTP 429; code HTTP_429)',
		)
		expect(reason).not.toContain(secret)
		expect(reason).not.toContain('rpc.example')
		expect(safeIndexerFailureReason(Object.assign(new Error(secret), { code: 'PROVIDER_KEY_SENTINEL', name: `${secret}Error` }))).toBe('UnknownError')
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
			signal: controller.signal,
		})

		expect(acquisitions).toBe(3)
		expect(seeds).toBe(2)
		expect(ownedRuns).toBe(1)
		expect(unownedFailures).toBe(1)
		expect(failures).toEqual(['Database request failed; retrying'])
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
