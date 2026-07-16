import { describe, expect, test } from 'bun:test'
import { getWalletMainnetActionAvailability, getWalletMainnetGuardMessage, getWalletMainnetGuardState } from '../lib/actionGuards.js'

describe('actionGuards', () => {
	test('returns the provided disconnected-wallet reason before feature-specific checks', () => {
		expect(
			getWalletMainnetGuardMessage({
				accountAddress: undefined,
				isMainnet: true,
				walletRequiredReason: 'Connect a wallet before settling escalation deposits.',
			}),
		).toBe('Connect a wallet before settling escalation deposits.')
	})

	test('explains wrong-network recovery while disabling actions', () => {
		expect(
			getWalletMainnetGuardMessage({
				accountAddress: '0x0000000000000000000000000000000000000001',
				isMainnet: false,
				walletRequiredReason: 'Connect a wallet before settling escalation deposits.',
			}),
		).toBe('Switch to Ethereum mainnet.')

		expect(
			getWalletMainnetGuardState({
				accountAddress: '0x0000000000000000000000000000000000000001',
				isMainnet: false,
				walletRequiredReason: 'Connect a wallet before settling escalation deposits.',
			}),
		).toEqual({ blocked: true, reason: 'Switch to Ethereum mainnet.' })

		expect(
			getWalletMainnetActionAvailability({
				accountAddress: '0x0000000000000000000000000000000000000001',
				isMainnet: false,
				walletRequiredReason: 'Connect a wallet before settling escalation deposits.',
			}),
		).toEqual({ disabled: true, reason: 'Switch to Ethereum mainnet.' })
	})

	test('falls back to the shared continue copy when no custom wallet reason is provided', () => {
		expect(
			getWalletMainnetGuardMessage({
				accountAddress: undefined,
				isMainnet: true,
			}),
		).toBe('Connect wallet to continue.')
	})
})
