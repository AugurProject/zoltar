/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { zeroAddress } from 'viem'
import { getVaultApprovalGuardMessage, getVaultClaimFeesGuardMessage, getVaultDepositGuardMessage, getVaultExecutePendingOperationGuardMessage, getVaultRequestPriceGuardMessage, getVaultSetSecurityBondAllowanceGuardMessage, getVaultWithdrawGuardMessage } from '../lib/securityVaultGuards.js'

const ETH = 10n ** 18n

describe('security vault guards', () => {
	test('blocks deposit until the vault is owned, loaded, approved, funded, and above minimum', () => {
		expect(
			getVaultDepositGuardMessage({
				accountAddress: zeroAddress,
				approvalSatisfied: true,
				isDepositBelowMinimum: false,
				isMainnet: true,
				repBalanceGap: undefined,
				selectedVaultDetailsLoaded: true,
				selectedVaultIsOwnedByAccount: false,
			}),
		).toBe('Select your own vault to deposit REP.')

		expect(
			getVaultDepositGuardMessage({
				accountAddress: zeroAddress,
				approvalSatisfied: false,
				isDepositBelowMinimum: false,
				isMainnet: true,
				repBalanceGap: undefined,
				selectedVaultDetailsLoaded: true,
				selectedVaultIsOwnedByAccount: true,
			}),
		).toBe('Approve enough REP before depositing.')

		expect(
			getVaultDepositGuardMessage({
				accountAddress: zeroAddress,
				approvalSatisfied: true,
				isDepositBelowMinimum: false,
				isMainnet: true,
				repBalanceGap: 2n * 10n ** 18n,
				selectedVaultDetailsLoaded: true,
				selectedVaultIsOwnedByAccount: true,
			}),
		).toBe('Need 2 more REP in this wallet.')

		expect(
			getVaultDepositGuardMessage({
				accountAddress: zeroAddress,
				approvalSatisfied: true,
				isDepositBelowMinimum: false,
				isMainnet: true,
				repBalanceGap: undefined,
				selectedVaultDetailsLoaded: true,
				selectedVaultIsOwnedByAccount: true,
			}),
		).toBeUndefined()
	})

	test('blocks withdraw, allowance, and claim actions until their deterministic prerequisites are met', () => {
		expect(
			getVaultWithdrawGuardMessage({
				accountAddress: zeroAddress,
				hasValidOraclePrice: false,
				isMainnet: true,
				requestPriceEthCost: undefined,
				selectedVaultIsOwnedByAccount: true,
				stagedOperationTimeoutMinutes: 5n,
				withdrawAmount: 1n,
				withdrawableRepAmount: 1n,
				walletEthBalance: 1n,
			}),
		).toBe('A valid oracle price is required before withdrawing REP.')

		expect(
			getVaultWithdrawGuardMessage({
				accountAddress: zeroAddress,
				hasValidOraclePrice: true,
				isMainnet: true,
				requestPriceEthCost: undefined,
				selectedVaultIsOwnedByAccount: true,
				stagedOperationTimeoutMinutes: 5n,
				withdrawAmount: 10_000n * 10n ** 18n,
				withdrawableRepAmount: 2_500n * 10n ** 18n,
				walletEthBalance: 1n,
			}),
		).toBe('Reduce the withdrawal to 2 500 REP or less.')

		expect(
			getVaultSetSecurityBondAllowanceGuardMessage({
				hasValidOraclePrice: true,
				isMainnet: true,
				maxSecurityBondAllowanceAmount: undefined,
				requestPriceEthCost: undefined,
				securityBondAllowanceAmount: undefined,
				selectedVaultDetailsLoaded: true,
				selectedVaultIsOwnedByAccount: true,
				stagedOperationTimeoutMinutes: 5n,
				walletEthBalance: 1n,
			}),
		).toBe('Enter a valid security bond allowance.')

		expect(
			getVaultSetSecurityBondAllowanceGuardMessage({
				hasValidOraclePrice: true,
				isMainnet: true,
				maxSecurityBondAllowanceAmount: undefined,
				requestPriceEthCost: undefined,
				securityBondAllowanceAmount: 0n,
				selectedVaultDetailsLoaded: true,
				selectedVaultIsOwnedByAccount: true,
				stagedOperationTimeoutMinutes: 5n,
				walletEthBalance: 1n,
			}),
		).toBeUndefined()

		expect(
			getVaultSetSecurityBondAllowanceGuardMessage({
				hasValidOraclePrice: true,
				isMainnet: true,
				maxSecurityBondAllowanceAmount: 5n * 10n ** 18n,
				requestPriceEthCost: undefined,
				securityBondAllowanceAmount: 5n * 10n ** 17n,
				selectedVaultDetailsLoaded: true,
				selectedVaultIsOwnedByAccount: true,
				stagedOperationTimeoutMinutes: 5n,
				walletEthBalance: 1n,
			}),
		).toBe('Enter at least 1 ETH for a non-zero allowance.')

		expect(
			getVaultSetSecurityBondAllowanceGuardMessage({
				hasValidOraclePrice: true,
				isMainnet: true,
				maxSecurityBondAllowanceAmount: 5n * 10n ** 18n,
				requestPriceEthCost: undefined,
				securityBondAllowanceAmount: 6n * 10n ** 18n,
				selectedVaultDetailsLoaded: true,
				selectedVaultIsOwnedByAccount: true,
				stagedOperationTimeoutMinutes: 5n,
				walletEthBalance: 1n,
			}),
		).toBe('Reduce the security bond allowance to 5 ETH or less.')

		expect(
			getVaultClaimFeesGuardMessage({
				hasClaimableFees: false,
				isMainnet: true,
				selectedVaultIsOwnedByAccount: true,
			}),
		).toBe('No claimable fees are available for this vault.')
	})

	test('blocks approval and oracle manager actions until required state is loaded', () => {
		expect(
			getVaultApprovalGuardMessage({
				accountAddress: undefined,
				isMainnet: true,
				selectedVaultDetailsLoaded: false,
				selectedVaultIsOwnedByAccount: false,
			}),
		).toBe('Connect wallet to continue.')

		expect(
			getVaultRequestPriceGuardMessage({
				accountAddress: zeroAddress,
				hasLoadedSelectedPool: true,
				isMainnet: true,
				pendingReportId: 9n,
				requestPriceEthCost: 1n,
				walletEthBalance: 1n,
			}),
		).toBe('A pending price report already exists for this pool.')

		expect(
			getVaultExecutePendingOperationGuardMessage({
				accountAddress: zeroAddress,
				hasLoadedOracleManager: true,
				isMainnet: true,
				isPriceValid: false,
				resolvedPendingOperationId: 1n,
			}),
		).toBe('Wait for a valid oracle price before executing a staged operation.')

		expect(
			getVaultExecutePendingOperationGuardMessage({
				accountAddress: zeroAddress,
				hasLoadedOracleManager: true,
				isMainnet: true,
				isPriceValid: true,
				resolvedPendingOperationId: 1n,
			}),
		).toBeUndefined()
	})

	test('blocks request-price-backed actions when the wallet lacks the buffered ETH value', () => {
		expect(
			getVaultRequestPriceGuardMessage({
				accountAddress: zeroAddress,
				hasLoadedSelectedPool: true,
				isMainnet: true,
				pendingReportId: 0n,
				requestPriceEthCost: 10n * ETH,
				walletEthBalance: 5n * ETH,
			}),
		).toBe('Need 7 more ETH in this wallet to request a new price.')

		expect(
			getVaultWithdrawGuardMessage({
				accountAddress: zeroAddress,
				hasValidOraclePrice: true,
				isMainnet: true,
				requestPriceEthCost: 10n * ETH,
				selectedVaultIsOwnedByAccount: true,
				stagedOperationTimeoutMinutes: 5n,
				withdrawAmount: 1n * ETH,
				withdrawableRepAmount: 5n * ETH,
				walletEthBalance: 5n * ETH,
			}),
		).toBe('Need 7 more ETH in this wallet to queue this REP withdrawal.')

		expect(
			getVaultSetSecurityBondAllowanceGuardMessage({
				hasValidOraclePrice: true,
				isMainnet: true,
				maxSecurityBondAllowanceAmount: undefined,
				requestPriceEthCost: 10n * ETH,
				securityBondAllowanceAmount: 0n,
				selectedVaultDetailsLoaded: true,
				selectedVaultIsOwnedByAccount: true,
				stagedOperationTimeoutMinutes: 5n,
				walletEthBalance: 5n * ETH,
			}),
		).toBe('Need 7 more ETH in this wallet to queue this bond allowance update.')
	})
})
