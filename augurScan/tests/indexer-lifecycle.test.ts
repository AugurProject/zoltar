import { describe, expect, test } from 'bun:test'
import {
	isProtocolActivitySource,
	isProtocolEvidenceEmitter,
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

describe('network indexer lifecycle', () => {
	test('redacts arbitrary transport failures to a stable public message', () => {
		const secret = 'provider-key-sentinel'
		const message = safeIndexerFailure(new Error(`HTTP request failed at https://rpc.example/${secret}?token=${secret}`))

		expect(message).toBe('RPC request failed; retrying')
		expect(message).not.toContain(secret)
		expect(message).not.toContain('rpc.example')
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
		expect(failures).toEqual(['RPC request failed; retrying'])
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
