/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import type { SecurityPoolVaultSummary } from '@zoltar/ui-statoblast-shared/types/contracts.js'
import * as liquidationCopy from '@zoltar/ui-statoblast-shared/copy/liquidation.js'
import { getDeterministicLiquidationFailureReason, getLiquidationExecutionFailureDetail, getLiquidationFailureReason, getMaxLiquidationAmount, isLiquidationBeyondMinPriceDistance } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/liquidation.js'

const ATTO = 10n ** 18n
const DISTANCE_BPS = 1_000n
// For 100 REP backing 10 ETH at a 2x multiplier, the contract's threshold price is 5 REP/ETH,
// so a 10% distance first passes at ceil(5e22 / 9000) = 5555555555555555556.
const FIRST_PRICE_BEYOND_DISTANCE = 5_555_555_555_555_555_556n

function createVault(overrides: Partial<SecurityPoolVaultSummary> = {}): SecurityPoolVaultSummary {
	return {
		badDebtAttoEth: 0n,
		claimableFeesAttoEth: 0n,
		disputeStakedAttoRep: 0n,
		underwritingLimitAttoEth: 10n * ATTO,
		vaultAddress: zeroAddress,
		vaultAttoRepBacking: 100n * ATTO,
		...overrides,
	}
}

function createReasonInput(overrides: Partial<Parameters<typeof getDeterministicLiquidationFailureReason>[0]> = {}): Parameters<typeof getDeterministicLiquidationFailureReason>[0] {
	return {
		callerVaultSummary: createVault({ underwritingLimitAttoEth: 0n, vaultAttoRepBacking: 1_000n * ATTO }),
		minLiquidationPriceDistanceBps: DISTANCE_BPS,
		minimumSecurityBondDebtAttoEth: 1n,
		minimumVaultRepDepositAttoRep: 1n,
		repPerEthPrice: FIRST_PRICE_BEYOND_DISTANCE,
		requestedDebtAttoEth: ATTO,
		settlementCollateralAttoEth: 10n * ATTO,
		statoblastSecurityMultiplierBps: 20_000n,
		targetVaultSummary: createVault(),
		totalUnderwritingLimitAttoEth: 10n * ATTO,
		...overrides,
	}
}

describe('liquidation minimum price distance', () => {
	const base = { disputeStakedAttoRep: 0n, minPriceDistanceBps: DISTANCE_BPS, openInterestAttoEth: 10n * ATTO, poolHeldVaultRepBackingAttoRep: 100n * ATTO, poolSecurityMultiplierBps: 20_000n }

	test('matches the contract threshold and floor rounding at the distance boundary', () => {
		expect(isLiquidationBeyondMinPriceDistance({ ...base, currentPrice: FIRST_PRICE_BEYOND_DISTANCE })).toBe(true)
		expect(isLiquidationBeyondMinPriceDistance({ ...base, currentPrice: FIRST_PRICE_BEYOND_DISTANCE - 1n })).toBe(false)
		expect(isLiquidationBeyondMinPriceDistance({ ...base, currentPrice: 5n * ATTO })).toBe(false)
	})

	test('uses the lower of the associated-REP and migration thresholds', () => {
		// Dispute stake raises the associated threshold to 7.5, so the 6.66… migration threshold applies.
		const withDispute = { ...base, disputeStakedAttoRep: 50n * ATTO }
		expect(isLiquidationBeyondMinPriceDistance({ ...withDispute, currentPrice: 7_407_407_407_407_407_407n })).toBe(true)
		expect(isLiquidationBeyondMinPriceDistance({ ...withDispute, currentPrice: 7_407_407_407_407_407_406n })).toBe(false)
	})

	test('treats a zero distance as always satisfied and zero open interest or price as unsatisfied', () => {
		expect(isLiquidationBeyondMinPriceDistance({ ...base, currentPrice: 1n, minPriceDistanceBps: 0n })).toBe(true)
		expect(isLiquidationBeyondMinPriceDistance({ ...base, currentPrice: 10n * ATTO, openInterestAttoEth: 0n })).toBe(false)
		expect(isLiquidationBeyondMinPriceDistance({ ...base, currentPrice: 0n })).toBe(false)
	})

	test('blocks an unhealthy vault within the distance and explains the required move', () => {
		const withinDistance = createReasonInput({ repPerEthPrice: FIRST_PRICE_BEYOND_DISTANCE - 1n })
		const reason = 'The price must move at least 10% past this vault’s liquidation threshold before it can be liquidated.'
		expect(getDeterministicLiquidationFailureReason(withinDistance)).toBe(reason)
		expect(getMaxLiquidationAmount({ minLiquidationPriceDistanceBps: DISTANCE_BPS, repPerEthPrice: FIRST_PRICE_BEYOND_DISTANCE - 1n, statoblastSecurityMultiplierBps: 20_000n, targetVaultSummary: createVault() })).toBe(0n)
		expect(getLiquidationFailureReason({ ...withinDistance, settlementCollateralAttoEth: 10n * ATTO, totalUnderwritingLimitAttoEth: 10n * ATTO })).toBe(reason)
		expect(getDeterministicLiquidationFailureReason(createReasonInput({ minLiquidationPriceDistanceBps: 1_050n, repPerEthPrice: FIRST_PRICE_BEYOND_DISTANCE }))).toBe('The price must move at least 10.5% past this vault’s liquidation threshold before it can be liquidated.')
	})

	test('allows the vault once the price is beyond the distance', () => {
		expect(getDeterministicLiquidationFailureReason(createReasonInput())).toBeUndefined()
		expect(getMaxLiquidationAmount({ minLiquidationPriceDistanceBps: DISTANCE_BPS, repPerEthPrice: FIRST_PRICE_BEYOND_DISTANCE, statoblastSecurityMultiplierBps: 20_000n, targetVaultSummary: createVault() })).toBe(10n * ATTO)
	})

	test('keeps the safe-vault reason for a healthy vault', () => {
		expect(getDeterministicLiquidationFailureReason(createReasonInput({ repPerEthPrice: 4n * ATTO }))).toBe('This vault is not undercollateralized at the current Open Oracle price.')
	})
})

describe('liquidation bad debt', () => {
	test('blocks when the target vault has bad debt', () => {
		expect(getDeterministicLiquidationFailureReason(createReasonInput({ targetVaultSummary: createVault({ badDebtAttoEth: 1n }) }))).toBe(liquidationCopy.targetBadDebtReason)
	})

	test('blocks when the receiver vault has bad debt', () => {
		expect(getDeterministicLiquidationFailureReason(createReasonInput({ callerVaultSummary: createVault({ badDebtAttoEth: 1n, underwritingLimitAttoEth: 0n, vaultAttoRepBacking: 1_000n * ATTO }) }))).toBe(liquidationCopy.receiverBadDebtReason)
	})
})

describe('liquidation execution failure details', () => {
	test.each([
		['Liquidation distance too low', liquidationCopy.liquidationDistanceTooLowError],
		['Target bad debt', liquidationCopy.targetBadDebtReason],
		['Receiver bad debt', liquidationCopy.receiverBadDebtReason],
		['Target backingUnits changed', liquidationCopy.targetSnapshotChangedError],
		['Target commitment changed', liquidationCopy.targetSnapshotChangedError],
		['Stale liquidation', liquidationCopy.stagedLiquidationStaleError],
		['Staged operation expired', liquidationCopy.stagedLiquidationExpiredError],
	])('maps the %s revert to plain language', (revert, detail) => {
		expect(getLiquidationExecutionFailureDetail(revert)).toBe(detail)
	})

	test('passes through reverts the contracts do not emit', () => {
		expect(getLiquidationExecutionFailureDetail('Target REP')).toBe('Target REP')
	})
})
