import { afterEach, describe, expect, test } from 'bun:test'
import { loadNetworks } from '../src/config.ts'

const originalNetworks = process.env['NETWORKS']
const originalStart = process.env['SEPOLIA_START_BLOCK']

afterEach(() => {
	if (originalNetworks === undefined) delete process.env['NETWORKS']
	else process.env['NETWORKS'] = originalNetworks
	if (originalStart === undefined) delete process.env['SEPOLIA_START_BLOCK']
	else process.env['SEPOLIA_START_BLOCK'] = originalStart
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
})
