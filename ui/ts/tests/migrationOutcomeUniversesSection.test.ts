/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { zeroAddress } from 'viem'
import { getMigrationOutcomeHeldBalance } from '../components/MigrationOutcomeUniversesSection.js'
import type { ZoltarChildUniverseSummary } from '../types/contracts.js'

void describe('getMigrationOutcomeHeldBalance', () => {
	void test('returns undefined for undeployed child universes', () => {
		const child = {
			exists: false,
			forkTime: 0n,
			outcomeIndex: 1n,
			outcomeLabel: 'Yes',
			parentUniverseId: 0n,
			reputationToken: zeroAddress,
			universeId: 123n,
		} satisfies ZoltarChildUniverseSummary

		expect(getMigrationOutcomeHeldBalance(child, {})).toBe(undefined)
	})

	void test('returns the recorded balance for deployed child universes', () => {
		const child = {
			exists: true,
			forkTime: 0n,
			outcomeIndex: 1n,
			outcomeLabel: 'Yes',
			parentUniverseId: 0n,
			reputationToken: zeroAddress,
			universeId: 123n,
		} satisfies ZoltarChildUniverseSummary

		expect(getMigrationOutcomeHeldBalance(child, { '123': 42n })).toBe(42n)
	})
})
