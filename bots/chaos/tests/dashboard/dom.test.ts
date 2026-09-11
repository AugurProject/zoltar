import { describe, expect, test } from 'bun:test'
import { transactionExplorerUrl } from '../../src/dashboard/dom.ts'

const hash = `0x${'12'.repeat(32)}`

describe('transactionExplorerUrl', () => {
	test('builds the explorer transaction page for the configured network', () => {
		expect(transactionExplorerUrl('https://etherscan.io', hash)).toBe(`https://etherscan.io/tx/${hash}`)
		expect(transactionExplorerUrl('https://sepolia.etherscan.io', hash)).toBe(`https://sepolia.etherscan.io/tx/${hash}`)
	})

	test('tolerates a trailing slash and keeps a path-bearing explorer base', () => {
		expect(transactionExplorerUrl('https://sepolia.etherscan.io/', hash)).toBe(`https://sepolia.etherscan.io/tx/${hash}`)
		expect(transactionExplorerUrl('https://explorer.example/chain/sepolia', hash)).toBe(`https://explorer.example/chain/sepolia/tx/${hash}`)
	})

	test('links nothing without an explorer or for values that are not transaction hashes', () => {
		expect(transactionExplorerUrl(undefined, hash)).toBeUndefined()
		expect(transactionExplorerUrl('https://etherscan.io', `0x${'ab'.repeat(20)}`)).toBeUndefined()
		expect(transactionExplorerUrl('https://etherscan.io', 'not a hash')).toBeUndefined()
	})
})
