/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getAddress } from '@zoltar/shared/ethereum'
import { MAINNET_NETWORK_PROFILE, MAINNET_WETH_ADDRESS, SEPOLIA_NETWORK_PROFILE, buildTransactionExplorerUrl, createSimulationProfile, formatTransactionNetworkLabel, getPublicNetworkProfile } from '../lib/networkProfile.js'
import { SEPOLIA_GENESIS_REP_ADDRESS, SEPOLIA_WETH_ADDRESS } from '../lib/sepoliaDeploymentConfig.js'

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

	test('defines Sepolia with deterministically deployable WETH and genesis REP', () => {
		expect(SEPOLIA_NETWORK_PROFILE.id).toBe('sepolia')
		expect(SEPOLIA_NETWORK_PROFILE.chainIdHex).toBe('0xaa36a7')
		expect(SEPOLIA_NETWORK_PROFILE.chain.id).toBe(11155111)
		expect(SEPOLIA_NETWORK_PROFILE.genesisRepTokenAddress).toBe(SEPOLIA_GENESIS_REP_ADDRESS)
		expect(SEPOLIA_NETWORK_PROFILE.wethAddress).toBe(SEPOLIA_WETH_ADDRESS)
		expect(SEPOLIA_NETWORK_PROFILE.repPricingMode).toBe('uniswap')
		expect(SEPOLIA_NETWORK_PROFILE.uniswapV4QuoterAddress).toBe(getAddress('0x61b3f2011a92d183c7dbadbda940a7555ccf9227'))
		expect(SEPOLIA_NETWORK_PROFILE.uniswapV3FactoryAddress).toBe(getAddress('0x0227628f3F023bb0B980b67D528571c95c6DaC1c'))
		expect(SEPOLIA_NETWORK_PROFILE.uniswapV3QuoterAddress).toBe(getAddress('0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3'))
		expect(SEPOLIA_NETWORK_PROFILE.usdcAddress).toBe(getAddress('0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'))
		expect(buildTransactionExplorerUrl(SEPOLIA_NETWORK_PROFILE, '0xabc')).toBe('https://sepolia.etherscan.io/tx/0xabc')
		expect(getPublicNetworkProfile('sepolia')).toBe(SEPOLIA_NETWORK_PROFILE)
		expect(getPublicNetworkProfile('mainnet')).toBe(MAINNET_NETWORK_PROFILE)
		expect(getPublicNetworkProfile(undefined)).toBe(MAINNET_NETWORK_PROFILE)
		expect(() => getPublicNetworkProfile('sepolai')).toThrow('Unsupported network "sepolai". Use "mainnet" or "sepolia".')
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
