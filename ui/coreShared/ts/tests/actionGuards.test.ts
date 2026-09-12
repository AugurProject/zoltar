import { describe, expect, test } from 'bun:test'
import { getWalletActiveAppChainActionAvailability, getWalletActiveAppChainGuardState } from '../transactions/actionGuards.js'

describe('actionGuards', () => {
	test('returns the provided disconnected-wallet reason before feature-specific checks', () => {
		expect(
			getWalletActiveAppChainGuardState({
				accountAddress: undefined,
				isOnActiveAppChain: true,
				walletRequiredReason: 'Connect a wallet before settling escalation deposits.',
			}).reason,
		).toBe('Connect a wallet before settling escalation deposits.')
	})

	test('explains wrong-network recovery while disabling actions', () => {
		expect(
			getWalletActiveAppChainGuardState({
				accountAddress: '0x0000000000000000000000000000000000000001',
				isOnActiveAppChain: false,
				walletRequiredReason: 'Connect a wallet before settling escalation deposits.',
			}).reason,
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
			getWalletActiveAppChainGuardState({
				accountAddress: undefined,
				isOnActiveAppChain: true,
			}).reason,
		).toBe('Connect wallet to continue.')
	})
})
