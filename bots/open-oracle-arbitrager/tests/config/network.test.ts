import mainnet from '../../../../docs/mainnet-deployment-addresses.json'
import sepolia from '../../../../docs/sepolia-deployment-addresses.json'
import { getAddress } from '@zoltar/bot-shared/ethereum'
import { describe, expect, test } from 'bun:test'
import { defaultRpcUrl, networkConfiguration, parseNetworkName } from '#config/network'

describe('operator networks', () => {
	for (const [name, manifest] of [
		['mainnet', mainnet],
		['sepolia', sepolia],
	] as const) {
		test(`uses canonical ${name} REP and WETH without overrides`, () => {
			const network = networkConfiguration(name, {})
			expect(network.chain.id).toBe(manifest.network.chainId)
			expect(network.rep).toBe(getAddress(manifest.network.genesisRepTokenAddress))
			expect(network.weth).toBe(getAddress(manifest.network.wethAddress))
			expect(defaultRpcUrl(name)).toContain('ethereum')
		})
	}

	test('rejects unsupported networks', () => {
		expect(parseNetworkName(undefined)).toBe('mainnet')
		expect(parseNetworkName('sepolia')).toBe('sepolia')
		expect(() => parseNetworkName('holesky')).toThrow('mainnet or sepolia')
	})
})
