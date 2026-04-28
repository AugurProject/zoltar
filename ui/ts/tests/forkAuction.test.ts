/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getForkAuctionStageView, getForkStageDescriptionForState, getOutcomeActionLabel, hasForkActivity } from '../lib/forkAuction.js'

void describe('fork auction helpers', () => {
	void test('getOutcomeActionLabel reuses reporting labels', () => {
		expect(getOutcomeActionLabel('invalid')).toBe('Invalid')
		expect(getOutcomeActionLabel('yes')).toBe('Yes')
		expect(getOutcomeActionLabel('no')).toBe('No')
	})

	void test('describes each fork stage from system state', () => {
		expect(getForkStageDescriptionForState('operational')).toContain('operational')
		expect(getForkStageDescriptionForState('poolForked')).toContain('Child universes')
		expect(getForkStageDescriptionForState('forkMigration')).toContain('Migration is active')
		expect(getForkStageDescriptionForState('forkTruthAuction')).toContain('Truth auction is active')
	})

	void test('detects whether preview pool data reflects actual fork activity', () => {
		expect(
			hasForkActivity({
				forkOutcome: 'none',
				migratedRep: 0n,
				systemState: 'operational',
				truthAuctionStartedAt: 0n,
			}),
		).toBe(false)

		expect(
			hasForkActivity({
				forkOutcome: 'yes',
				migratedRep: 0n,
				systemState: 'operational',
				truthAuctionStartedAt: 0n,
			}),
		).toBe(true)

		expect(
			hasForkActivity({
				forkOutcome: 'none',
				migratedRep: 0n,
				systemState: 'forkMigration',
				truthAuctionStartedAt: 0n,
			}),
		).toBe(true)
	})

	void test('derives lifecycle stage for pre-fork, migration, auction, and settlement states', () => {
		expect(
			getForkAuctionStageView({
				claimingAvailable: false,
				forkOutcome: 'none',
				migratedRep: 0n,
				systemState: 'operational',
				truthAuction: undefined,
				truthAuctionStartedAt: 0n,
			}),
		).toBe('initiate')

		expect(
			getForkAuctionStageView({
				claimingAvailable: false,
				forkOutcome: 'none',
				migratedRep: 1n,
				systemState: 'forkMigration',
				truthAuction: undefined,
				truthAuctionStartedAt: 0n,
			}),
		).toBe('migration')

		expect(
			getForkAuctionStageView({
				claimingAvailable: false,
				forkOutcome: 'none',
				migratedRep: 1n,
				systemState: 'forkTruthAuction',
				truthAuction: { finalized: false },
				truthAuctionStartedAt: 1n,
			}),
		).toBe('auction')

		expect(
			getForkAuctionStageView({
				claimingAvailable: false,
				forkOutcome: 'yes',
				migratedRep: 1n,
				systemState: 'operational',
				truthAuction: undefined,
				truthAuctionStartedAt: 1n,
			}),
		).toBe('settlement')
	})
})
