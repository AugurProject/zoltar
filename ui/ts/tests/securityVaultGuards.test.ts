/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { zeroAddress } from '@zoltar/shared/ethereum'
import { getVaultClaimFeesGuardMessage, getVaultDepositGuardMessage, getVaultExecutePendingOperationGuardMessage, getVaultRequestPriceGuardMessage, getVaultSetSecurityBondAllowanceGuardMessage, getVaultWithdrawGuardMessage } from '../lib/securityVaultGuards.js'

const ETH = 10n ** 18n

describe('security vault guards', () => {
	test('blocks deposit until deterministic deposit prerequisites are met', () => {
		expect(
			getVaultDepositGuardMessage({
				approvalSatisfied: true,
				depositAmount: 1n,
				isDepositBelowMinimum: false,
				repBalanceGap: undefined,
			}),
		).toBeUndefined()

		expect(
			getVaultDepositGuardMessage({
				approvalSatisfied: false,
				depositAmount: 0n,
				isDepositBelowMinimum: false,
				repBalanceGap: undefined,
			}),
		).toBe('Enter a REP deposit amount greater than zero.')

		expect(
			getVaultDepositGuardMessage({
				approvalSatisfied: false,
				depositAmount: 1n,
				isDepositBelowMinimum: false,
				repBalanceGap: undefined,
			}),
		).toBe('Approve enough REP before depositing.')

		expect(
			getVaultDepositGuardMessage({
				approvalSatisfied: true,
				depositAmount: 3n * 10n ** 18n,
				isDepositBelowMinimum: false,
				repBalanceGap: 2n * 10n ** 18n,
			}),
		).toBe('Need 2 more REP in this wallet.')

		expect(
			getVaultDepositGuardMessage({
				approvalSatisfied: true,
				depositAmount: 3n * 10n ** 18n,
				isDepositBelowMinimum: false,
				repBalanceGap: undefined,
			}),
		).toBeUndefined()
	})

	test('blocks withdraw, allowance, and claim actions until their deterministic prerequisites are met', () => {
		expect(
			getVaultWithdrawGuardMessage({
				requiredEthCost: undefined,
				stagedOperationTimeoutMinutes: 5n,
				withdrawAmount: 1n,
				withdrawableRepAmount: 1n,
				walletEthBalance: 1n,
			}),
		).toBeUndefined()

		expect(
			getVaultWithdrawGuardMessage({
				requiredEthCost: undefined,
				stagedOperationTimeoutMinutes: 5n,
				withdrawAmount: 0n,
				withdrawableRepAmount: 2_500n * 10n ** 18n,
				walletEthBalance: 1n,
			}),
		).toBe('Enter a REP withdraw amount greater than zero.')

		expect(
			getVaultWithdrawGuardMessage({
				requiredEthCost: undefined,
				stagedOperationTimeoutMinutes: 5n,
				withdrawAmount: 10_000n * 10n ** 18n,
				withdrawableRepAmount: 2_500n * 10n ** 18n,
				walletEthBalance: 1n,
			}),
		).toBe('Reduce the withdrawal to 2 500 REP or less.')

		expect(
			getVaultSetSecurityBondAllowanceGuardMessage({
				maxSecurityBondAllowanceAmount: undefined,
				requiredEthCost: undefined,
				securityBondAllowanceAmount: undefined,
				stagedOperationTimeoutMinutes: 5n,
				walletEthBalance: 1n,
			}),
		).toBe('Enter a valid security bond allowance.')

		expect(
			getVaultSetSecurityBondAllowanceGuardMessage({
				maxSecurityBondAllowanceAmount: undefined,
				requiredEthCost: undefined,
				securityBondAllowanceAmount: 0n,
				stagedOperationTimeoutMinutes: 5n,
				walletEthBalance: 1n,
			}),
		).toBeUndefined()

		expect(
			getVaultSetSecurityBondAllowanceGuardMessage({
				maxSecurityBondAllowanceAmount: 5n * 10n ** 18n,
				requiredEthCost: undefined,
				securityBondAllowanceAmount: 5n * 10n ** 17n,
				stagedOperationTimeoutMinutes: 5n,
				walletEthBalance: 1n,
			}),
		).toBe('Enter at least 1 ETH for a non-zero allowance.')

		expect(
			getVaultSetSecurityBondAllowanceGuardMessage({
				maxSecurityBondAllowanceAmount: 5n * 10n ** 18n,
				requiredEthCost: undefined,
				securityBondAllowanceAmount: 6n * 10n ** 18n,
				stagedOperationTimeoutMinutes: 5n,
				walletEthBalance: 1n,
			}),
		).toBe('Reduce the security bond allowance to 5 ETH or less.')

		expect(
			getVaultClaimFeesGuardMessage({
				hasClaimableFees: false,
			}),
		).toBe('No claimable fees are available for this vault.')
	})

	test('blocks approval and oracle manager actions until required state is loaded', () => {
		expect(
			getVaultRequestPriceGuardMessage({
				accountAddress: zeroAddress,
				hasLoadedSelectedPool: true,
				isMainnet: true,
				pendingReportId: 9n,
				requiredEthCost: 1n,
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
				requiredEthCost: 10n * ETH,
				walletEthBalance: 5n * ETH,
			}),
		).toBe('Need 7 more ETH in this wallet to request a new price.')

		expect(
			getVaultWithdrawGuardMessage({
				bufferRequiredEthCost: true,
				requiredEthCost: 10n * ETH,
				stagedOperationTimeoutMinutes: 5n,
				withdrawAmount: 1n * ETH,
				withdrawableRepAmount: 5n * ETH,
				walletEthBalance: 5n * ETH,
			}),
		).toBe('Need 7 more ETH in this wallet to queue this REP withdrawal.')

		expect(
			getVaultSetSecurityBondAllowanceGuardMessage({
				maxSecurityBondAllowanceAmount: undefined,
				bufferRequiredEthCost: true,
				requiredEthCost: 10n * ETH,
				securityBondAllowanceAmount: 0n,
				stagedOperationTimeoutMinutes: 5n,
				walletEthBalance: 5n * ETH,
			}),
		).toBe('Need 7 more ETH in this wallet to queue this bond allowance update.')
	})
})
