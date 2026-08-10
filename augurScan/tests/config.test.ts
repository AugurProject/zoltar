import { afterEach, describe, expect, test } from 'bun:test'
import { loadNetworks } from '../src/config.ts'

const originalNetworks = process.env['NETWORKS']
const originalStart = process.env['SEPOLIA_START_BLOCK']
const originalRpc = process.env['SEPOLIA_RPC_URL']

afterEach(() => {
	if (originalNetworks === undefined) delete process.env['NETWORKS']
	else process.env['NETWORKS'] = originalNetworks
	if (originalStart === undefined) delete process.env['SEPOLIA_START_BLOCK']
	else process.env['SEPOLIA_START_BLOCK'] = originalStart
	if (originalRpc === undefined) delete process.env['SEPOLIA_RPC_URL']
	else process.env['SEPOLIA_RPC_URL'] = originalRpc
})

describe('network configuration', () => {
	test('selects networks and preserves an exact bigint start block', async () => {
		process.env['NETWORKS'] = 'sepolia'
		process.env['SEPOLIA_START_BLOCK'] = '8123456'
		const networks = await loadNetworks()
		expect(networks).toHaveLength(1)
		expect(networks[0]?.chainId).toBe(11155111)
		expect(networks[0]?.startBlock).toBe(8_123_456n)
		expect(networks[0]?.contracts.length).toBeGreaterThan(10)
	})

	test('rejects a negative history boundary', async () => {
		process.env['NETWORKS'] = 'sepolia'
		process.env['SEPOLIA_START_BLOCK'] = '-1'
		expect(loadNetworks()).rejects.toThrow('must not be negative')
	})

	test('accepts an ordered comma-separated provider pool', async () => {
		process.env['NETWORKS'] = 'sepolia'
		process.env['SEPOLIA_RPC_URL'] = 'https://primary.example, https://fallback.example/rpc'
		const networks = await loadNetworks()
		expect(networks[0]?.rpcUrls).toEqual(['https://primary.example', 'https://fallback.example/rpc'])
	})

	test('rejects non-HTTP RPC transports', async () => {
		process.env['NETWORKS'] = 'sepolia'
		process.env['SEPOLIA_RPC_URL'] = 'wss://provider.example'
		expect(loadNetworks()).rejects.toThrow('must contain HTTP(S) URLs')
	})
})
