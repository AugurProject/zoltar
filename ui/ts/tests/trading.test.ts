/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getRemainingMintCapacity, getTradingMintGuardMessage } from '../lib/trading.js'

void describe('trading helpers', () => {
	void test('computes remaining mint capacity from total bond allowance and minted open interest', () => {
		expect(getRemainingMintCapacity(10n, 4n)).toBe(6n)
		expect(getRemainingMintCapacity(10n, 10n)).toBe(0n)
		expect(getRemainingMintCapacity(10n, 12n)).toBe(0n)
		expect(getRemainingMintCapacity(undefined, 12n)).toBeUndefined()
	})

	void test('blocks minting until the wallet is connected on mainnet', () => {
		expect(
			getTradingMintGuardMessage({
				accountAddress: undefined,
				completeSetCollateralAmount: 0n,
				ethBalance: 10n,
				isMainnet: true,
				mintAmountInput: '1',
				systemState: 'operational',
				totalSecurityBondAllowance: 10n,
			}),
		).toBe('Connect a wallet before minting complete sets.')

		expect(
			getTradingMintGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				completeSetCollateralAmount: 0n,
				ethBalance: 10n,
				isMainnet: false,
				mintAmountInput: '1',
				systemState: 'operational',
				totalSecurityBondAllowance: 10n,
			}),
		).toBe('Switch to Ethereum mainnet before minting complete sets.')
	})

	void test('surfaces the main mint block reasons before the transaction is sent', () => {
		expect(
			getTradingMintGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				completeSetCollateralAmount: 1n,
				ethBalance: 10n ** 18n,
				isMainnet: true,
				mintAmountInput: '100',
				systemState: 'forkMigration',
				totalSecurityBondAllowance: 10n,
			}),
		).toBe('Minting is only available while the pool is operational.')

		expect(
			getTradingMintGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				completeSetCollateralAmount: undefined,
				ethBalance: 10n ** 18n,
				isMainnet: true,
				mintAmountInput: '100',
				systemState: 'operational',
				totalSecurityBondAllowance: 10n,
			}),
		).toBe('Loading pool mint capacity.')

		expect(
			getTradingMintGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				completeSetCollateralAmount: 10n,
				ethBalance: 10n ** 18n,
				isMainnet: true,
				mintAmountInput: '100',
				systemState: 'operational',
				totalSecurityBondAllowance: 10n,
			}),
		).toBe('This pool has no remaining mint capacity.')

		expect(
			getTradingMintGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				completeSetCollateralAmount: 0n,
				ethBalance: 10n ** 18n,
				isMainnet: true,
				mintAmountInput: 'abc',
				systemState: 'operational',
				totalSecurityBondAllowance: 10n ** 18n,
			}),
		).toBe('Enter a valid whole-number mint amount.')

		expect(
			getTradingMintGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				completeSetCollateralAmount: 0n,
				ethBalance: 10n ** 18n,
				isMainnet: true,
				mintAmountInput: '0',
				systemState: 'operational',
				totalSecurityBondAllowance: 10n ** 18n,
			}),
		).toBe('Enter a mint amount greater than zero.')

		expect(
			getTradingMintGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				completeSetCollateralAmount: 8n * 10n ** 17n,
				ethBalance: 10n ** 18n,
				isMainnet: true,
				mintAmountInput: '300000000000000000',
				systemState: 'operational',
				totalSecurityBondAllowance: 10n ** 18n,
			}),
		).toBe('This pool only has 0.2 ETH of mint capacity remaining.')

		expect(
			getTradingMintGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				completeSetCollateralAmount: 0n,
				ethBalance: 5n * 10n ** 17n,
				isMainnet: true,
				mintAmountInput: '1000000000000000000',
				systemState: 'operational',
				totalSecurityBondAllowance: 2n * 10n ** 18n,
			}),
		).toBe('Need 0.5 more ETH in this wallet to mint the selected amount.')
	})

	void test('allows minting when the pool has capacity and the wallet has enough ETH', () => {
		expect(
			getTradingMintGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				completeSetCollateralAmount: 4n * 10n ** 17n,
				ethBalance: 2n * 10n ** 18n,
				isMainnet: true,
				mintAmountInput: '500000000000000000',
				systemState: 'operational',
				totalSecurityBondAllowance: 2n * 10n ** 18n,
			}),
		).toBeUndefined()
	})
})
