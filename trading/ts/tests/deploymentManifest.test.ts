import { describe, expect, test } from 'bun:test'
import { parseCoreDeploymentManifest, requireMatchingChain } from '../deploy/manifest.ts'

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
})
