/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { getMigrationOutcomeSplitLimit } from '@zoltar/ui-zoltar-shared/features/universes/components/MigrationOutcomeUniversesSection.js'
import type { ZoltarChildUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'

void describe('getMigrationOutcomeSplitLimit', () => {
	void test('returns the minimum remaining capacity across selected universes', () => {
		const childUniverses = [
			{
				exists: true,
				forkTime: 0n,
				outcomeIndex: 1n,
				outcomeLabel: 'Yes',
				parentUniverseId: 0n,
				reputationToken: zeroAddress,
				universeId: 123n,
			},
			{
				exists: true,
				forkTime: 0n,
				outcomeIndex: 2n,
				outcomeLabel: 'No',
				parentUniverseId: 0n,
				reputationToken: zeroAddress,
				universeId: 456n,
			},
		] satisfies ZoltarChildUniverseSummary[]

		expect(getMigrationOutcomeSplitLimit(childUniverses, { '123': 10n, '456': 40n }, 50n, new Set(['1', '2']))).toBe(10n)
	})

	void test('returns zero when every selected universe is fully migrated', () => {
		const childUniverses = [
			{
				exists: true,
				forkTime: 0n,
				outcomeIndex: 1n,
				outcomeLabel: 'Yes',
				parentUniverseId: 0n,
				reputationToken: zeroAddress,
				universeId: 123n,
			},
		] satisfies ZoltarChildUniverseSummary[]

		expect(getMigrationOutcomeSplitLimit(childUniverses, { '123': 50n }, 50n, new Set(['1']))).toBe(0n)
	})
})
