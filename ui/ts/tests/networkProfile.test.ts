/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getAddress } from '@zoltar/shared/ethereum'
import { MAINNET_NETWORK_PROFILE, MAINNET_WETH_ADDRESS, SEPOLIA_NETWORK_PROFILE, buildTransactionExplorerUrl, createSimulationProfile, formatTransactionNetworkLabel } from '../lib/networkProfile.js'

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

	test('exports a supported Sepolia profile with deployed protocol token addresses', () => {
		expect(SEPOLIA_NETWORK_PROFILE.id).toBe('sepolia')
		expect(SEPOLIA_NETWORK_PROFILE.chain.id).toBe(11155111)
		expect(SEPOLIA_NETWORK_PROFILE.chainIdHex).toBe('0xaa36a7')
		expect(SEPOLIA_NETWORK_PROFILE.displayName).toBe('Sepolia')
		expect(SEPOLIA_NETWORK_PROFILE.isSupportedAppChain).toBe(true)
		expect(SEPOLIA_NETWORK_PROFILE.repPricingMode).toBe('unavailable')
		expect(SEPOLIA_NETWORK_PROFILE.transactionExplorerBaseUrl).toBe('https://sepolia.etherscan.io/tx/')
		expect(SEPOLIA_NETWORK_PROFILE.genesisRepTokenAddress).not.toBe(MAINNET_NETWORK_PROFILE.genesisRepTokenAddress)
		expect(SEPOLIA_NETWORK_PROFILE.wethAddress).not.toBe(MAINNET_NETWORK_PROFILE.wethAddress)
		expect(buildTransactionExplorerUrl(SEPOLIA_NETWORK_PROFILE, '0xabc')).toBe('https://sepolia.etherscan.io/tx/0xabc')
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
		expect(formatTransactionNetworkLabel(profile)).toBe('Browser Simulation · local sandbox')
	})

	test('uses the public network name for mainnet transaction reviews', () => {
		expect(formatTransactionNetworkLabel(MAINNET_NETWORK_PROFILE)).toBe('Ethereum Mainnet')
	})
})
