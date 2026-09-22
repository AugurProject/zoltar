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
			const network = networkConfiguration(name)
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

test('uses the published Uniswap factory and QuoterV2 for Sepolia CLI defaults', () => {
	const network = networkConfiguration('sepolia')
	expect(network.factory).toBe('0x0227628f3F023bb0B980b67D528571c95c6DaC1c')
	expect(network.quoter).toBe('0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3')
})
