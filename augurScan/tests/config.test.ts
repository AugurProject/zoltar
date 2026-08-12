import { afterEach, describe, expect, test } from 'bun:test'
import { loadNetworks } from '../src/config.ts'

const originalNetworks = process.env['NETWORKS']
const originalMainnetRpc = process.env['MAINNET_RPC_URL']
const originalStart = process.env['SEPOLIA_START_BLOCK']
const originalRpc = process.env['SEPOLIA_RPC_URL']

afterEach(() => {
	if (originalNetworks === undefined) delete process.env['NETWORKS']
	else process.env['NETWORKS'] = originalNetworks
	if (originalMainnetRpc === undefined) delete process.env['MAINNET_RPC_URL']
	else process.env['MAINNET_RPC_URL'] = originalMainnetRpc
	if (originalStart === undefined) delete process.env['SEPOLIA_START_BLOCK']
	else process.env['SEPOLIA_START_BLOCK'] = originalStart
	if (originalRpc === undefined) delete process.env['SEPOLIA_RPC_URL']
	else process.env['SEPOLIA_RPC_URL'] = originalRpc
})

describe('network configuration', () => {
	test('uses public endpoints with historical state by default', async () => {
		process.env['NETWORKS'] = 'mainnet,sepolia'
		delete process.env['MAINNET_RPC_URL']
		delete process.env['SEPOLIA_RPC_URL']
		const networks = await loadNetworks()

		expect(networks.map(({ rpcUrls }) => rpcUrls)).toEqual([['https://mainnet.gateway.tenderly.co'], ['https://sepolia.gateway.tenderly.co']])
	})

	test('selects networks and preserves an exact bigint start block', async () => {
		process.env['NETWORKS'] = 'sepolia'
		process.env['SEPOLIA_START_BLOCK'] = '8123456'
		const networks = await loadNetworks()
		expect(networks).toHaveLength(1)
		expect(networks[0]?.chainId).toBe(11155111)
		expect(networks[0]?.nativeSymbol).toBe('SepoliaETH')
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

	test('rejects unknown network selections instead of silently ignoring them', async () => {
		process.env['NETWORKS'] = 'sepolia,sepollia'
		expect(loadNetworks()).rejects.toThrow('NETWORKS contains unknown network: sepollia')
	})
})
