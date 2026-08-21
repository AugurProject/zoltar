import { describe, expect, test } from 'bun:test'
import { getWalletActiveAppChainActionAvailability, getWalletActiveAppChainGuardMessage, getWalletActiveAppChainGuardState } from '../lib/actionGuards.js'

describe('actionGuards', () => {
	test('returns the provided disconnected-wallet reason before feature-specific checks', () => {
		expect(
			getWalletActiveAppChainGuardMessage({
				accountAddress: undefined,
				isOnActiveAppChain: true,
				walletRequiredReason: 'Connect a wallet before settling escalation deposits.',
			}),
		).toBe('Connect a wallet before settling escalation deposits.')
	})

	test('explains wrong-network recovery while disabling actions', () => {
		expect(
			getWalletActiveAppChainGuardMessage({
				accountAddress: '0x0000000000000000000000000000000000000001',
				isOnActiveAppChain: false,
				walletRequiredReason: 'Connect a wallet before settling escalation deposits.',
			}),
		).toBe('Switch to Ethereum mainnet.')

		expect(
			getWalletActiveAppChainGuardState({
				accountAddress: '0x0000000000000000000000000000000000000001',
				isOnActiveAppChain: false,
				walletRequiredReason: 'Connect a wallet before settling escalation deposits.',
			}),
		).toEqual({ blocked: true, reason: 'Switch to Ethereum mainnet.' })

		expect(
			getWalletActiveAppChainActionAvailability({
				accountAddress: '0x0000000000000000000000000000000000000001',
				isOnActiveAppChain: false,
				walletRequiredReason: 'Connect a wallet before settling escalation deposits.',
			}),
		).toEqual({ disabled: true, reason: 'Switch to Ethereum mainnet.' })
	})

	test('falls back to the shared continue copy when no custom wallet reason is provided', () => {
		expect(
			getWalletActiveAppChainGuardMessage({
				accountAddress: undefined,
				isOnActiveAppChain: true,
			}),
		).toBe('Connect wallet to continue.')
	})
})
