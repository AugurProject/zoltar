/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import {
	getAllowanceBackedRep,
	getMaxRedeemableCompleteSets,
	getRemainingMintCapacity,
	getSelectedOutcomeShareBalance,
	getTradingMigrateSharesGuardMessage,
	getTradingMintGuardMessage,
	getTradingRedeemCompleteSetGuardMessage,
	getTradingRedeemSharesGuardMessage,
	hasRepBackedPoolWithNoActiveAllowance,
} from '../lib/trading.js'

void describe('trading helpers', () => {
	const shareBalances = {
		invalid: 2n * 10n ** 18n,
		no: 4n * 10n ** 18n,
		yes: 3n * 10n ** 18n,
	}

	void test('computes remaining mint capacity from total bond allowance and minted open interest', () => {
		expect(getRemainingMintCapacity(10n, 4n)).toBe(6n)
		expect(getRemainingMintCapacity(10n, 10n)).toBe(0n)
		expect(getRemainingMintCapacity(10n, 12n)).toBe(0n)
		expect(getRemainingMintCapacity(undefined, 12n)).toBeUndefined()
	})

	void test('converts allowance to REP using the latest oracle price', () => {
		expect(getAllowanceBackedRep(2n * 10n ** 18n, 2_500n * 10n ** 18n)).toBe(5_000n * 10n ** 18n)
		expect(getAllowanceBackedRep(undefined, 2_500n * 10n ** 18n)).toBeUndefined()
		expect(getAllowanceBackedRep(2n * 10n ** 18n, undefined)).toBeUndefined()
	})

	void test('detects pools that have REP backing but no active allowance', () => {
		expect(hasRepBackedPoolWithNoActiveAllowance(20n * 10n ** 18n, 0n)).toBe(true)
		expect(hasRepBackedPoolWithNoActiveAllowance(20n * 10n ** 18n, 1n)).toBe(false)
		expect(hasRepBackedPoolWithNoActiveAllowance(0n, 0n)).toBe(false)
	})

	void test('derives the max redeemable complete sets from wallet share balances', () => {
		expect(getMaxRedeemableCompleteSets(shareBalances)).toBe(2n * 10n ** 18n)
		expect(getMaxRedeemableCompleteSets(undefined)).toBeUndefined()
		expect(getSelectedOutcomeShareBalance(shareBalances, 'yes')).toBe(3n * 10n ** 18n)
		expect(getSelectedOutcomeShareBalance(shareBalances, 'no')).toBe(4n * 10n ** 18n)
		expect(getSelectedOutcomeShareBalance(shareBalances, 'invalid')).toBe(2n * 10n ** 18n)
	})

	void test('blocks minting until a pool is loaded and the wallet is connected on mainnet', () => {
		expect(
			getTradingMintGuardMessage({
				accountAddress: undefined,
				completeSetCollateralAmount: 0n,
				ethBalance: 10n,
				hasSelectedPool: true,
				isMainnet: true,
				mintAmountInput: '1',
				systemState: 'operational',
				totalRepDeposit: 0n,
				totalSecurityBondAllowance: 10n,
				universeHasForked: false,
			}),
		).toBe('Connect a wallet before minting complete sets.')

		expect(
			getTradingMintGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				completeSetCollateralAmount: 0n,
				ethBalance: 10n,
				hasSelectedPool: false,
				isMainnet: true,
				mintAmountInput: '1',
				systemState: 'operational',
				totalRepDeposit: 0n,
				totalSecurityBondAllowance: 10n,
				universeHasForked: false,
			}),
		).toBe('Load a pool before minting.')

		expect(
			getTradingMintGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				completeSetCollateralAmount: 0n,
				ethBalance: 10n,
				hasSelectedPool: true,
				isMainnet: false,
				mintAmountInput: '1',
				systemState: 'operational',
				totalRepDeposit: 0n,
				totalSecurityBondAllowance: 10n,
				universeHasForked: false,
			}),
		).toBe('Switch to Ethereum mainnet before minting complete sets.')
	})

	void test('surfaces the main mint block reasons before the transaction is sent', () => {
		expect(
			getTradingMintGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				completeSetCollateralAmount: 1n,
				ethBalance: 10n ** 18n,
				hasSelectedPool: true,
				isMainnet: true,
				mintAmountInput: '100',
				systemState: 'forkMigration',
				totalRepDeposit: 0n,
				totalSecurityBondAllowance: 10n,
				universeHasForked: false,
			}),
		).toBe('Minting is only available while the pool is operational.')

		expect(
			getTradingMintGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				completeSetCollateralAmount: undefined,
				ethBalance: 10n ** 18n,
				hasSelectedPool: true,
				isMainnet: true,
				mintAmountInput: '100',
				systemState: 'operational',
				totalRepDeposit: 0n,
				totalSecurityBondAllowance: 10n,
				universeHasForked: false,
			}),
		).toBe('Loading mint capacity.')

		expect(
			getTradingMintGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				completeSetCollateralAmount: 10n,
				ethBalance: 10n ** 18n,
				hasSelectedPool: true,
				isMainnet: true,
				mintAmountInput: '100',
				systemState: 'operational',
				totalRepDeposit: 0n,
				totalSecurityBondAllowance: 10n,
				universeHasForked: false,
			}),
		).toBe('No mint capacity remaining.')

		expect(
			getTradingMintGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				completeSetCollateralAmount: 0n,
				ethBalance: 10n ** 18n,
				hasSelectedPool: true,
				isMainnet: true,
				mintAmountInput: '100',
				systemState: 'operational',
				totalRepDeposit: 20n * 10n ** 18n,
				totalSecurityBondAllowance: 0n,
				universeHasForked: false,
			}),
		).toBe('No mint capacity. No active security bond allowance.')

		expect(
			getTradingMintGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				completeSetCollateralAmount: 0n,
				ethBalance: 10n ** 18n,
				hasSelectedPool: true,
				isMainnet: true,
				mintAmountInput: 'abc',
				systemState: 'operational',
				totalRepDeposit: 0n,
				totalSecurityBondAllowance: 10n ** 18n,
				universeHasForked: false,
			}),
		).toBe('Enter a valid mint amount.')

		expect(
			getTradingMintGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				completeSetCollateralAmount: 0n,
				ethBalance: 10n ** 18n,
				hasSelectedPool: true,
				isMainnet: true,
				mintAmountInput: '0',
				systemState: 'operational',
				totalRepDeposit: 0n,
				totalSecurityBondAllowance: 10n ** 18n,
				universeHasForked: false,
			}),
		).toBe('Enter a mint amount greater than zero.')

		expect(
			getTradingMintGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				completeSetCollateralAmount: 8n * 10n ** 17n,
				ethBalance: 10n ** 18n,
				hasSelectedPool: true,
				isMainnet: true,
				mintAmountInput: '0.3',
				systemState: 'operational',
				totalRepDeposit: 0n,
				totalSecurityBondAllowance: 10n ** 18n,
				universeHasForked: false,
			}),
		).toBe('Max mint capacity is 0.2 ETH.')

		expect(
			getTradingMintGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				completeSetCollateralAmount: 0n,
				ethBalance: 5n * 10n ** 17n,
				hasSelectedPool: true,
				isMainnet: true,
				mintAmountInput: '1',
				systemState: 'operational',
				totalRepDeposit: 0n,
				totalSecurityBondAllowance: 2n * 10n ** 18n,
				universeHasForked: false,
			}),
		).toBe('Need 0.5 more ETH in this wallet to mint the selected amount.')

		expect(
			getTradingMintGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				completeSetCollateralAmount: 0n,
				ethBalance: 5n * 10n ** 18n,
				hasSelectedPool: true,
				isMainnet: true,
				mintAmountInput: '1',
				systemState: 'operational',
				totalRepDeposit: 0n,
				totalSecurityBondAllowance: 2n * 10n ** 18n,
				universeHasForked: true,
			}),
		).toBe('Minting is unavailable after this universe has forked.')
	})

	void test('allows minting when the pool has capacity and the wallet has enough ETH', () => {
		expect(
			getTradingMintGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				completeSetCollateralAmount: 4n * 10n ** 17n,
				ethBalance: 2n * 10n ** 18n,
				hasSelectedPool: true,
				isMainnet: true,
				mintAmountInput: '0.5',
				systemState: 'operational',
				totalRepDeposit: 0n,
				totalSecurityBondAllowance: 2n * 10n ** 18n,
				universeHasForked: false,
			}),
		).toBeUndefined()
	})

	void test('limits complete-set redemption to the wallet minimum across yes, no, and invalid', () => {
		expect(
			getTradingRedeemCompleteSetGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				hasSelectedPool: true,
				isMainnet: true,
				loadingTradingDetails: false,
				redeemAmountInput: '0',
				shareBalances,
				systemState: 'operational',
				universeHasForked: false,
			}),
		).toBe('Enter a redeem amount greater than zero.')

		expect(
			getTradingRedeemCompleteSetGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				hasSelectedPool: true,
				isMainnet: true,
				loadingTradingDetails: true,
				redeemAmountInput: '1',
				shareBalances: undefined,
				systemState: 'operational',
				universeHasForked: false,
			}),
		).toBe('Loading wallet share balances.')

		expect(
			getTradingRedeemCompleteSetGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				hasSelectedPool: true,
				isMainnet: true,
				loadingTradingDetails: false,
				redeemAmountInput: '1',
				shareBalances: {
					invalid: 0n,
					no: 2n * 10n ** 18n,
					yes: 2n * 10n ** 18n,
				},
				systemState: 'operational',
				universeHasForked: false,
			}),
		).toBe('Need matching Invalid, Yes, and No shares to redeem complete sets.')

		expect(
			getTradingRedeemCompleteSetGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				hasSelectedPool: true,
				isMainnet: true,
				loadingTradingDetails: false,
				redeemAmountInput: 'abc',
				shareBalances,
				systemState: 'operational',
				universeHasForked: false,
			}),
		).toBe('Enter a valid redeem amount.')

		expect(
			getTradingRedeemCompleteSetGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				hasSelectedPool: true,
				isMainnet: true,
				loadingTradingDetails: false,
				redeemAmountInput: '2.1',
				shareBalances,
				systemState: 'operational',
				universeHasForked: false,
			}),
		).toBe('Max redeemable amount is 2 complete sets.')

		expect(
			getTradingRedeemCompleteSetGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				hasSelectedPool: true,
				isMainnet: true,
				loadingTradingDetails: false,
				redeemAmountInput: '2',
				shareBalances,
				systemState: 'operational',
				universeHasForked: false,
			}),
		).toBeUndefined()
	})

	void test('only enables share migration after a fork and when the selected outcome balance is positive', () => {
		expect(
			getTradingMigrateSharesGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				hasSelectedPool: true,
				isMainnet: true,
				loadingTradingDetails: false,
				selectedOutcome: 'yes',
				shareBalances,
				universeHasForked: false,
			}),
		).toBe('Share migration is only available after this universe has forked.')

		expect(
			getTradingMigrateSharesGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				hasSelectedPool: true,
				isMainnet: true,
				loadingTradingDetails: false,
				selectedOutcome: 'invalid',
				shareBalances: {
					invalid: 0n,
					no: 4n * 10n ** 18n,
					yes: 3n * 10n ** 18n,
				},
				universeHasForked: true,
			}),
		).toBe('No Invalid shares available to migrate.')

		expect(
			getTradingMigrateSharesGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				hasSelectedPool: true,
				isMainnet: true,
				loadingTradingDetails: false,
				selectedOutcome: 'yes',
				shareBalances,
				universeHasForked: true,
			}),
		).toBeUndefined()
	})

	void test('only enables resolved-share redemption after finalization', () => {
		expect(
			getTradingRedeemSharesGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				hasSelectedPool: true,
				isMainnet: true,
				questionOutcome: 'none',
				systemState: 'operational',
				universeHasForked: false,
			}),
		).toBe('This market has not finalized yet.')

		expect(
			getTradingRedeemSharesGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				hasSelectedPool: true,
				isMainnet: true,
				questionOutcome: 'yes',
				systemState: 'operational',
				universeHasForked: true,
			}),
		).toBe('Redeeming shares is unavailable after this universe has forked.')

		expect(
			getTradingRedeemSharesGuardMessage({
				accountAddress: '0x1234567890123456789012345678901234567890',
				hasSelectedPool: true,
				isMainnet: true,
				questionOutcome: 'yes',
				systemState: 'operational',
				universeHasForked: false,
			}),
		).toBeUndefined()
	})
})
