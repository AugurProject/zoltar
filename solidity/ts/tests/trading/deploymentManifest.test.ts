import { describe, expect, test } from 'bun:test'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { parseCoreDeploymentManifest, parseTradingFeeBps, requireMatchingChain, requireReceiptBlockNumber, requireSafeChainId } from '../../trading/deploy/manifest'

describe('trading deployment manifest validation', () => {
	test('defaults only an unset trading fee and rejects an empty or malformed one', () => {
		expect(parseTradingFeeBps(undefined)).toBe(30n)
		expect(parseTradingFeeBps('0')).toBe(0n)
		expect(parseTradingFeeBps('9999')).toBe(9_999n)
		for (const value of ['', ' ', '10000', '-1', '1.5', '0x1e', '030']) expect(() => parseTradingFeeBps(value)).toThrow('TRADING_FEE_BPS must be a whole number from 0 to 9999')
	})

	test('requires the core manifest and RPC to identify the same chain', () => {
		const parsed = parseCoreDeploymentManifest({ network: { chainId: 31_337 }, contracts: { SecurityPoolFactory: { address: `0x${'12'.repeat(20)}` } } })
		expect(parsed.chainId).toBe(31_337n)
		expect(() => requireMatchingChain(parsed.chainId, 1n)).toThrow('does not match RPC chain')
		expect(requireMatchingChain(parsed.chainId, 31_337n)).toBeUndefined()
	})

	test('reads SecurityPoolFactory from the canonical root deployment steps', () => {
		const securityPoolFactory = `0x${'34'.repeat(20)}` satisfies Address
		const parsed = parseCoreDeploymentManifest({
			network: { chainId: 1 },
			deploymentSteps: [
				{ id: 'proxyDeployer', address: `0x${'12'.repeat(20)}` },
				{ id: 'securityPoolFactory', address: securityPoolFactory },
			],
		})
		expect(parsed).toEqual({ chainId: 1n, securityPoolFactory })
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
