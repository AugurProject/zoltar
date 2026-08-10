import { describe, expect, test } from 'bun:test'
import { BaseError, ContractFunctionExecutionError, decodeFunctionResult, parseAbi, toHex } from '../src/ethereum.ts'
import {
	confirmCanonicalBlock,
	isProtocolActivitySource,
	isProtocolEvidenceEmitter,
	readTokenMetadata,
	reorgSearchFloor,
	requiresParentLookup,
	runIndexerOwnershipLifecycle,
	runNetworkLifecycle,
	safeIndexerFailure,
	tokenMetadataNeedsRead,
} from '../src/indexer.ts'
import type { ContractMetadata, TokenMetadata } from '../src/types.ts'

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
	test('redacts arbitrary transport failures to a stable public message', () => {
		const secret = 'provider-key-sentinel'
		const message = safeIndexerFailure(new Error(`HTTP request failed at https://rpc.example/${secret}?token=${secret}`))

		expect(message).toBe('RPC request failed; retrying')
		expect(message).not.toContain(secret)
		expect(message).not.toContain('rpc.example')
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
