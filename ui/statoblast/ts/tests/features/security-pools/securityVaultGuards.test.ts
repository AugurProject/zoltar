/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { zeroAddress } from '@zoltar/shared/ethereum'
import { getVaultDepositGuardMessage, getVaultExecutePendingOperationGuardMessage, getVaultRequestPriceGuardMessage, getVaultWithdrawGuardMessage } from '../../../features/security-pools/lib/securityVaultGuards.js'

const ATTO_ETH_PER_ETH = 10n ** 18n

describe('security vault guards', () => {
	test('blocks deposit until deterministic deposit prerequisites are met', () => {
		expect(
			getVaultDepositGuardMessage({
				approvalSatisfied: true,
				depositAmount: 1n,
				isDepositBelowMinimum: false,
				walletRepShortfallAttoRep: undefined,
			}),
		).toBeUndefined()

		expect(
			getVaultDepositGuardMessage({
				approvalSatisfied: false,
				depositAmount: 0n,
				isDepositBelowMinimum: false,
				walletRepShortfallAttoRep: undefined,
			}),
		).toBeUndefined()

		expect(
			getVaultDepositGuardMessage({
				approvalSatisfied: false,
				depositAmount: 1n,
				isDepositBelowMinimum: false,
				walletRepShortfallAttoRep: undefined,
			}),
		).toBe('Approve enough REP before depositing.')

		expect(
			getVaultDepositGuardMessage({
				approvalSatisfied: true,
				depositAmount: 3n * 10n ** 18n,
				isDepositBelowMinimum: false,
				walletRepShortfallAttoRep: 2n * 10n ** 18n,
			}),
		).toBe('Need 2\u00a0more\u00a0REP in this wallet.')

		expect(
			getVaultDepositGuardMessage({
				approvalSatisfied: true,
				depositAmount: 3n * 10n ** 18n,
				isDepositBelowMinimum: false,
				walletRepShortfallAttoRep: undefined,
			}),
		).toBeUndefined()
	})

	test('blocks positive deposits until the deposit target factor is valid', () => {
		const guard = (targetHealthFactor: string) =>
			getVaultDepositGuardMessage({
				approvalSatisfied: true,
				depositAmount: 1n,
				isDepositBelowMinimum: false,
				targetHealthFactor,
				walletRepShortfallAttoRep: undefined,
			})

		expect(guard('')).toBe('Deposit target factor must be a number with at most four decimal places')
		expect(guard('abc')).toBe('Deposit target factor must be a number with at most four decimal places')
		expect(guard('0.9999')).toBe('Deposit target factor must be at least 1.00×')
		expect(guard('1.25')).toBeUndefined()
	})

	test('capacity ownership', () => {
		expect(
			getVaultWithdrawGuardMessage({
				disputeStakedAttoRep: 1n,
				requiredCostAttoEth: undefined,
				stagedOperationTimeoutMinutes: 5n,
				withdrawAmount: 1n,
				withdrawableRepAmountAttoRep: 1n,
				walletBalanceAttoEth: 1n,
			}),
		).toBe('Settle escalation deposits before withdrawing REP.')

		expect(
			getVaultWithdrawGuardMessage({
				requiredCostAttoEth: undefined,
				stagedOperationTimeoutMinutes: 5n,
				withdrawAmount: 1n,
				withdrawableRepAmountAttoRep: 1n,
				walletBalanceAttoEth: 1n,
			}),
		).toBeUndefined()

		expect(
			getVaultWithdrawGuardMessage({
				requiredCostAttoEth: undefined,
				stagedOperationTimeoutMinutes: 5n,
				withdrawAmount: 0n,
				withdrawableRepAmountAttoRep: 2_500n * 10n ** 18n,
				walletBalanceAttoEth: 1n,
			}),
		).toBeUndefined()

		expect(
			getVaultWithdrawGuardMessage({
				requiredCostAttoEth: undefined,
				stagedOperationTimeoutMinutes: 5n,
				withdrawAmount: 10_000n * 10n ** 18n,
				withdrawableRepAmountAttoRep: 2_500n * 10n ** 18n,
				walletBalanceAttoEth: 1n,
			}),
		).toBe('Reduce the withdrawal to 2 500\u00a0REP or less.')
	})

	test('blocks approval and oracle manager actions until required state is loaded', () => {
		expect(
			getVaultRequestPriceGuardMessage({
				accountAddress: zeroAddress,
				hasLoadedSelectedPool: true,
				isPriceValid: false,
				isOnActiveAppChain: false,
				pendingReportId: 0n,
				requiredCostAttoEth: 1n,
				walletBalanceAttoEth: 1n,
			}),
		).toBe('Switch to Ethereum mainnet.')

		expect(
			getVaultRequestPriceGuardMessage({
				accountAddress: zeroAddress,
				hasLoadedSelectedPool: true,
				isPriceValid: false,
				isOnActiveAppChain: true,
				pendingReportId: 9n,
				requiredCostAttoEth: 1n,
				walletBalanceAttoEth: 1n,
			}),
		).toBe('A pending price report already exists for this pool.')

		expect(
			getVaultRequestPriceGuardMessage({
				accountAddress: zeroAddress,
				hasLoadedSelectedPool: true,
				isOnActiveAppChain: true,
				isPriceValid: true,
				pendingReportId: 0n,
				requiredCostAttoEth: 1n,
				walletBalanceAttoEth: 1n,
			}),
		).toBe('The current oracle price is still valid.')

		expect(
			getVaultExecutePendingOperationGuardMessage({
				accountAddress: zeroAddress,
				hasLoadedOracleManager: true,
				isOnActiveAppChain: false,
				isPriceValid: true,
				resolvedPendingOperationId: 1n,
			}),
		).toBe('Switch to Ethereum mainnet.')

		expect(
			getVaultExecutePendingOperationGuardMessage({
				accountAddress: zeroAddress,
				hasLoadedOracleManager: true,
				isOnActiveAppChain: true,
				isPriceValid: false,
				resolvedPendingOperationId: 1n,
			}),
		).toBe('Wait for a valid oracle price before executing a staged operation.')

		expect(
			getVaultExecutePendingOperationGuardMessage({
				accountAddress: zeroAddress,
				hasLoadedOracleManager: true,
				isOnActiveAppChain: true,
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
				isPriceValid: false,
				isOnActiveAppChain: true,
				pendingReportId: 0n,
				requiredCostAttoEth: 10n * ATTO_ETH_PER_ETH,
				walletBalanceAttoEth: 5n * ATTO_ETH_PER_ETH,
			}),
		).toBe('Need 7\u00a0more\u00a0ETH in this wallet to request a new price.')

		expect(
			getVaultWithdrawGuardMessage({
				bufferRequiredEthCost: true,
				requiredCostAttoEth: 10n * ATTO_ETH_PER_ETH,
				stagedOperationTimeoutMinutes: 5n,
				withdrawAmount: 1n * ATTO_ETH_PER_ETH,
				withdrawableRepAmountAttoRep: 5n * ATTO_ETH_PER_ETH,
				walletBalanceAttoEth: 5n * ATTO_ETH_PER_ETH,
			}),
		).toBe('Need 7\u00a0more\u00a0ETH in this wallet to queue this REP withdrawal.')
	})
})
