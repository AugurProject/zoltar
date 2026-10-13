/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import type { SecurityPoolVaultSummary } from '@zoltar/ui-statoblast-shared/types/contracts.js'
import { getVaultHealthTier, getVaultSummaryHealth, sortByVaultHealthRisk } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/vaultHealth.js'

const ATTO = 10n ** 18n
const MULTIPLIER_BPS = 20_000n

// 100 REP backing a 10 ETH commitment at a 2x multiplier stays healthy up to 5 REP/ETH.
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

describe('vault health', () => {
	test('reads a vault far above its multiplier as healthy, with its backing ratio', () => {
		expect(getVaultSummaryHealth({ multiplierBps: MULTIPLIER_BPS, repPerEthPrice: ATTO, vault: createVault() })).toEqual({ associatedRepPerCapacityBps: 100_000n, tier: 'healthy' })
	})

	test('reads a healthy vault within 5% of its multiplier as near minimum', () => {
		expect(getVaultSummaryHealth({ multiplierBps: MULTIPLIER_BPS, repPerEthPrice: (48n * ATTO) / 10n, vault: createVault() }).tier).toBe('nearMinimum')
	})

	test('reads a vault past its liquidation threshold as underwater', () => {
		expect(getVaultSummaryHealth({ multiplierBps: MULTIPLIER_BPS, repPerEthPrice: 6n * ATTO, vault: createVault() }).tier).toBe('underwater')
	})

	test('gives no verdict without a usable price or multiplier', () => {
		expect(getVaultSummaryHealth({ multiplierBps: MULTIPLIER_BPS, repPerEthPrice: undefined, vault: createVault() })).toEqual({ associatedRepPerCapacityBps: undefined, tier: 'unknown' })
		expect(getVaultSummaryHealth({ multiplierBps: MULTIPLIER_BPS, repPerEthPrice: 0n, vault: createVault() }).tier).toBe('unknown')
		expect(getVaultSummaryHealth({ multiplierBps: undefined, repPerEthPrice: ATTO, vault: createVault() }).tier).toBe('unknown')
	})

	test('maps the selected vault verdict onto the same tiers', () => {
		expect(getVaultHealthTier({ associatedRepPerCapacityBps: 75_000n, isCurrentlyHealthy: false, multiplierBps: MULTIPLIER_BPS })).toBe('underwater')
		expect(getVaultHealthTier({ associatedRepPerCapacityBps: 21_000n, isCurrentlyHealthy: true, multiplierBps: MULTIPLIER_BPS })).toBe('nearMinimum')
		expect(getVaultHealthTier({ associatedRepPerCapacityBps: 21_001n, isCurrentlyHealthy: true, multiplierBps: MULTIPLIER_BPS })).toBe('healthy')
		expect(getVaultHealthTier({ associatedRepPerCapacityBps: 75_000n, isCurrentlyHealthy: undefined, multiplierBps: MULTIPLIER_BPS })).toBe('unknown')
	})

	test('orders vaults riskiest first and keeps the given order within a tier', () => {
		const vaults = [
			{ id: 'healthy-a', tier: 'healthy' },
			{ id: 'near', tier: 'nearMinimum' },
			{ id: 'unknown', tier: 'unknown' },
			{ id: 'underwater', tier: 'underwater' },
			{ id: 'healthy-b', tier: 'healthy' },
		] as const
		expect(sortByVaultHealthRisk(vaults, vault => vault.tier).map(vault => vault.id)).toEqual(['underwater', 'near', 'healthy-a', 'unknown', 'healthy-b'])
	})
})
