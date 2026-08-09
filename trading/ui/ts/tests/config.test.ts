import { describe, expect, test } from 'bun:test'
import { parseDeploymentConfiguration } from '../protocol/config.ts'
import { validateRpcChainId } from '../protocol/live.ts'

const factory = `0x${'12'.repeat(20)}`
const router = `0x${'23'.repeat(20)}`
const core = `0x${'34'.repeat(20)}`

describe('trading UI deployment configuration', () => {
	test('consumes the nested deployment manifest emitted by deploy:local', () => {
		const parsed = parseDeploymentConfiguration({ network: { chainId: 31_337, chainIdHex: '0x7a69', rpcUrl: 'http://127.0.0.1:8545' }, core: { securityPoolFactory: core }, trading: { factory, router, feeBps: 30 } })
		expect(parsed.chainId).toBe(31_337)
		expect(parsed.factory.toLowerCase()).toBe(factory)
	})

	test('rejects incomplete addresses', () => {
		expect(() => parseDeploymentConfiguration({ chainId: 1, chainName: 'Mainnet', rpcUrl: 'https://example.test', securityPoolFactory: core, factory: '0x12', router, feeBps: 30 })).toThrow('factory must be a valid address')
	})

	test('rejects an impossible AMM fee', () => {
		expect(() => parseDeploymentConfiguration({ chainId: 1, chainName: 'One', rpcUrl: 'http://localhost', securityPoolFactory: core, factory, router, feeBps: 10_000 })).toThrow('feeBps must be below 10000')
	})

	test('rejects an RPC chain that differs from the manifest', () => {
		expect(() => validateRpcChainId(2, 1)).toThrow('RPC chain 2 does not match deployment chain 1')
		expect(validateRpcChainId(1, 1)).toBeUndefined()
	})
})
