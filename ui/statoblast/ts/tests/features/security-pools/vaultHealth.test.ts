/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getVaultHealthTier, getVaultSummaryHealth, sortByVaultHealthRisk } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/vaultHealth.js'
import { createUnencumberedVaultSummary } from './workflow/builders.js'

const ATTO = 10n ** 18n
const MULTIPLIER_BPS = 20_000n

describe('vault health', () => {
	test('reads a vault far above its multiplier as healthy, with its backing ratio', () => {
		expect(getVaultSummaryHealth({ multiplierBps: MULTIPLIER_BPS, poolEnded: false, repPerEthPrice: ATTO, vault: createUnencumberedVaultSummary() })).toEqual({ associatedRepPerCapacityBps: 100_000n, tier: 'healthy' })
	})

	test('reads a healthy vault within 5% of its multiplier as near minimum', () => {
		expect(getVaultSummaryHealth({ multiplierBps: MULTIPLIER_BPS, poolEnded: false, repPerEthPrice: (48n * ATTO) / 10n, vault: createUnencumberedVaultSummary() }).tier).toBe('nearMinimum')
	})

	test('reads a vault past its liquidation threshold as underwater', () => {
		expect(getVaultSummaryHealth({ multiplierBps: MULTIPLIER_BPS, poolEnded: false, repPerEthPrice: 6n * ATTO, vault: createUnencumberedVaultSummary() }).tier).toBe('underwater')
	})

	test('gives no verdict without a usable price or multiplier', () => {
		expect(getVaultSummaryHealth({ multiplierBps: MULTIPLIER_BPS, poolEnded: false, repPerEthPrice: undefined, vault: createUnencumberedVaultSummary() })).toEqual({ associatedRepPerCapacityBps: undefined, tier: 'unknown' })
		expect(getVaultSummaryHealth({ multiplierBps: MULTIPLIER_BPS, poolEnded: false, repPerEthPrice: 0n, vault: createUnencumberedVaultSummary() }).tier).toBe('unknown')
		expect(getVaultSummaryHealth({ multiplierBps: undefined, poolEnded: false, repPerEthPrice: ATTO, vault: createUnencumberedVaultSummary() }).tier).toBe('unknown')
	})

	test('gives no verdict once the pool has ended, when liquidation is closed', () => {
		expect(getVaultSummaryHealth({ multiplierBps: MULTIPLIER_BPS, poolEnded: true, repPerEthPrice: 6n * ATTO, vault: createUnencumberedVaultSummary() })).toEqual({ associatedRepPerCapacityBps: undefined, tier: 'unknown' })
	})

	test('maps a health verdict and backing ratio onto tiers', () => {
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
