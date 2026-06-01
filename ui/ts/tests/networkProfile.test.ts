/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getAddress } from 'viem'
import { MAINNET_NETWORK_PROFILE, MAINNET_WETH_ADDRESS, buildTransactionExplorerUrl, createSimulationProfile } from '../lib/networkProfile.js'

describe('network profile helpers', () => {
	test('exports expected defaults for Ethereum mainnet', () => {
		expect(MAINNET_NETWORK_PROFILE.id).toBe('mainnet')
		expect(MAINNET_NETWORK_PROFILE.chainIdHex).toBe('0x1')
		expect(MAINNET_NETWORK_PROFILE.displayName).toBe('Ethereum Mainnet')
		expect(MAINNET_NETWORK_PROFILE.repPricingMode).toBe('uniswap')
		expect(MAINNET_NETWORK_PROFILE.transactionExplorerBaseUrl).toBe('https://etherscan.io/tx/')
		expect(MAINNET_NETWORK_PROFILE.wethAddress).toBe(getAddress(MAINNET_WETH_ADDRESS))
		expect(buildTransactionExplorerUrl(MAINNET_NETWORK_PROFILE, '0xabc')).toBe('https://etherscan.io/tx/0xabc')
	})

	test('returns undefined explorer url when URL base is not configured', () => {
		const profile = createSimulationProfile({
			genesisRepTokenAddress: getAddress('0x0000000000000000000000000000000000000101'),
			wethAddress: getAddress('0x0000000000000000000000000000000000000202'),
		})

		expect(buildTransactionExplorerUrl(profile, '0xabc')).toBeUndefined()
	})

	test('creates a deterministic simulation profile from constructor inputs', () => {
		const profile = createSimulationProfile({
			genesisRepTokenAddress: getAddress('0x0000000000000000000000000000000000000101'),
			wethAddress: getAddress('0x0000000000000000000000000000000000000202'),
		})

		expect(profile.id).toBe('simulation')
		expect(profile.chain.id).toBe(1337)
		expect(profile.chainIdHex).toBe('0x539')
		expect(profile.displayName).toBe('Browser Simulation')
		expect(profile.repPricingMode).toBe('mock')
		expect(profile.transactionExplorerBaseUrl).toBeUndefined()
	})
})
