import { describe, expect, test } from 'bun:test'
import { defaultRpcUrl, networkConfiguration, parseNetworkName } from '#config/network'

describe('operator networks', () => {
	test('uses mainnet defaults and requires an explicit Sepolia REP deployment', () => {
		expect(networkConfiguration('mainnet', {}).chain.id).toBe(1)
		expect(defaultRpcUrl('mainnet')).toContain('ethereum-rpc')
		expect(() => networkConfiguration('sepolia', {})).toThrow('rep-address')
		const sepolia = networkConfiguration('sepolia', { rep: '0x0000000000000000000000000000000000000001' })
		expect(sepolia.chain.id).toBe(11_155_111)
		expect(sepolia.explorerUrl).toBe('https://sepolia.etherscan.io')
	})

	test('rejects unsupported networks', () => {
		expect(parseNetworkName(undefined)).toBe('mainnet')
		expect(parseNetworkName('sepolia')).toBe('sepolia')
		expect(() => parseNetworkName('holesky')).toThrow('mainnet or sepolia')
	})
})
