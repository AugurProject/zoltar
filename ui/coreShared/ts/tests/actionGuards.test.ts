import { describe, expect, test } from 'bun:test'
import { getActionAvailabilityReason, getWalletActionBlocker, getWalletActiveAppChainActionAvailability, getWalletActiveAppChainGuardState, getWalletConnectionActiveAppChainGuardState, withWalletBlocker } from '../transactions/actionGuards.js'
import type { WalletActionBlocker } from '../types/components.js'

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
		).toBe('Switch to Sepolia.')

		expect(
			getWalletActiveAppChainGuardState({
				accountAddress: '0x0000000000000000000000000000000000000001',
				isOnActiveAppChain: false,
				walletRequiredReason: 'Connect a wallet before settling escalation deposits.',
			}),
		).toEqual({ blocked: true, reason: 'Switch to Sepolia.', walletBlocker: { kind: 'wrong-network', targetChainName: 'Sepolia' } })

		expect(
			getWalletActiveAppChainActionAvailability({
				accountAddress: '0x0000000000000000000000000000000000000001',
				isOnActiveAppChain: false,
				walletRequiredReason: 'Connect a wallet before settling escalation deposits.',
			}),
		).toEqual({ disabled: true, reason: 'Switch to Sepolia.', walletBlocker: { kind: 'wrong-network', targetChainName: 'Sepolia' } })
	})

	test('falls back to the shared continue copy when no custom wallet reason is provided', () => {
		expect(
			getWalletActiveAppChainGuardState({
				accountAddress: undefined,
				isOnActiveAppChain: true,
			}).reason,
		).toBe('Connect wallet to continue.')
	})

	test('classifies the wallet prerequisite: a missing account before a wrong network', () => {
		expect(getWalletActionBlocker({ isOnActiveAppChain: false, targetChainName: 'Sepolia', walletConnected: false })).toEqual({ kind: 'wallet-disconnected' })
		expect(getWalletActionBlocker({ isOnActiveAppChain: false, targetChainName: 'Sepolia', walletConnected: true })).toEqual({ kind: 'wrong-network', targetChainName: 'Sepolia' })
		expect(getWalletActionBlocker({ isOnActiveAppChain: true, targetChainName: 'Sepolia', walletConnected: true })).toBeUndefined()
	})

	test('types the disconnected-wallet guard while keeping the custom reason', () => {
		expect(getWalletConnectionActiveAppChainGuardState({ isOnActiveAppChain: true, walletConnected: false, walletRequiredReason: 'Connect a wallet before creating a report.' })).toEqual({
			blocked: true,
			reason: 'Connect a wallet before creating a report.',
			walletBlocker: { kind: 'wallet-disconnected' },
		})
		expect(getWalletActiveAppChainGuardState({ accountAddress: '0x0000000000000000000000000000000000000001', isOnActiveAppChain: true })).toEqual({ blocked: false, reason: undefined, walletBlocker: undefined })
	})

	test('marks only disabled availability as wallet-blocked', () => {
		const walletBlocker: WalletActionBlocker = { kind: 'wallet-disconnected' }
		expect(withWalletBlocker({ disabled: true, reason: 'Connect a wallet first.' }, walletBlocker)).toEqual({ disabled: true, reason: 'Connect a wallet first.', walletBlocker })
		expect(withWalletBlocker({ disabled: false, reason: undefined }, walletBlocker)).toEqual({ disabled: false, reason: undefined })
		expect(withWalletBlocker({ disabled: true, reason: 'Enter an amount.' }, undefined)).toEqual({ disabled: true, reason: 'Enter an amount.' })
	})

	test('derives the typed availability reason from the wallet blocker instead of the reason text', () => {
		expect(getActionAvailabilityReason({ disabled: true, reason: 'Switch to Sepolia.' })).toEqual({ kind: 'other', message: 'Switch to Sepolia.' })
		expect(getActionAvailabilityReason({ disabled: true, reason: 'Anything', walletBlocker: { kind: 'wrong-network', targetChainName: 'Sepolia' } })).toEqual({ kind: 'wrong-network', targetChainName: 'Sepolia' })
		expect(getActionAvailabilityReason({ disabled: true, reason: undefined, walletBlocker: { kind: 'wallet-disconnected' } })).toEqual({ kind: 'wallet-disconnected' })
		expect(getActionAvailabilityReason({ disabled: false, reason: undefined, walletBlocker: { kind: 'wallet-disconnected' } })).toBeUndefined()
		expect(getActionAvailabilityReason({ disabled: true, reason: undefined })).toBeUndefined()
		expect(getActionAvailabilityReason(undefined)).toBeUndefined()
	})
})
