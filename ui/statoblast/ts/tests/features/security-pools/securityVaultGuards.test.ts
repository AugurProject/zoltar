/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { getVaultExecutePendingOperationGuardMessage, getVaultRedeemRepGuardMessage, getVaultRequestPriceGuardMessage } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/securityVaultGuards.js'

const ATTO_ETH_PER_ETH = 10n ** 18n

describe('security vault guards', () => {
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
		).toBe('Switch to Sepolia.')

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
		).toBe('Switch to Sepolia.')

		expect(
			getVaultExecutePendingOperationGuardMessage({
				accountAddress: zeroAddress,
				hasLoadedOracleManager: true,
				isOnActiveAppChain: true,
				isPriceValid: false,
				resolvedPendingOperationId: 1n,
			}),
		).toBe('Request a new price in Price oracle before executing this operation.')

		expect(
			getVaultExecutePendingOperationGuardMessage({
				accountAddress: zeroAddress,
				hasLoadedOracleManager: true,
				isOnActiveAppChain: true,
				isPriceValid: false,
				resolvedPendingOperationId: 1n,
				pendingSettlementOperationIds: [1n],
			}),
		).toBe('Auto-executes after oracle settlement.')

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
	})

	test('blocks REP redemption until the commitment is exited', () => {
		// SecurityPool.redeemRepFromVault requires underwritingLimitAttoEth == 0.
		expect(getVaultRedeemRepGuardMessage({ disputeStakedAttoRep: 0n, redeemableRepAmountAttoRep: 5n, underwritingLimitAttoEth: 1n })).toBe('Set your commitment limit to 0 ETH before redeeming REP. The pool keeps vault REP locked while the vault still has a commitment.')
		expect(getVaultRedeemRepGuardMessage({ disputeStakedAttoRep: 0n, redeemableRepAmountAttoRep: 5n, underwritingLimitAttoEth: 0n })).toBeUndefined()
		expect(getVaultRedeemRepGuardMessage({ disputeStakedAttoRep: 1n, redeemableRepAmountAttoRep: 5n, underwritingLimitAttoEth: 1n })).toBe('Settle escalation deposits before redeeming REP.')
	})
})
