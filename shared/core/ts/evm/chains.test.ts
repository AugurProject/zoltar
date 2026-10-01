import { describe, expect, test } from 'bun:test'
import { blockExplorerUrl, mainnet, sepolia } from './ethereum.js'

describe('shared chain definitions', () => {
	test('publish the default block explorer of each supported network', () => {
		expect(mainnet.blockExplorers.default.url).toBe('https://etherscan.io')
		expect(sepolia.blockExplorers.default.url).toBe('https://sepolia.etherscan.io')
	})

	test('looks up the block explorer by chain id', () => {
		expect(blockExplorerUrl(1)).toBe('https://etherscan.io')
		expect(blockExplorerUrl(11_155_111)).toBe('https://sepolia.etherscan.io')
		expect(blockExplorerUrl(1337)).toBeUndefined()
	})

	test('publish explorer origins without a trailing slash so callers can append paths', () => {
		for (const chain of [mainnet, sepolia]) expect(chain.blockExplorers.default.url.endsWith('/')).toBe(false)
	})
})
