import { describe, expect, test } from 'bun:test'
import { parseCoreDeploymentManifest, requireMatchingChain, requireReceiptBlockNumber, requireSafeChainId } from '../deploy/manifest.ts'

describe('trading deployment manifest validation', () => {
	test('requires the core manifest and RPC to identify the same chain', () => {
		const parsed = parseCoreDeploymentManifest({ network: { chainId: 31_337 }, contracts: { SecurityPoolFactory: { address: `0x${'12'.repeat(20)}` } } })
		expect(parsed.chainId).toBe(31_337n)
		expect(() => requireMatchingChain(parsed.chainId, 1n)).toThrow('does not match RPC chain')
		expect(requireMatchingChain(parsed.chainId, 31_337n)).toBeUndefined()
	})

	test('rejects manifests without chain identity', () => {
		expect(() => parseCoreDeploymentManifest({ securityPoolFactory: `0x${'12'.repeat(20)}` })).toThrow('valid chain ID')
	})

	test('records deployment receipt block numbers without unsafe number conversion', () => {
		expect(requireReceiptBlockNumber('0x123456789abcdef')).toBe(BigInt('0x123456789abcdef').toString())
		expect(() => requireReceiptBlockNumber(undefined)).toThrow('valid block number')
	})

	test('rejects a chain ID that cannot be represented before deployment', () => {
		expect(requireSafeChainId(31_337n)).toBe(31_337)
		expect(() => requireSafeChainId(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow('safe integer')
	})
})
