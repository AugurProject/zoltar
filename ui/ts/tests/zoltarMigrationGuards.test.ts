/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { zeroAddress } from 'viem'
import { getMigrationGuardMessage } from '../lib/zoltarMigrationGuards.js'
import type { ZoltarUniverseSummary } from '../types/contracts.js'

function createUniverse(overrides: Partial<ZoltarUniverseSummary> = {}): ZoltarUniverseSummary {
	return {
		childUniverses: [],
		forkThreshold: 1n,
		forkQuestionDetails: undefined,
		forkTime: 0n,
		forkingOutcomeIndex: 0n,
		hasForked: true,
		parentUniverseId: 0n,
		reputationToken: zeroAddress,
		totalTheoreticalSupply: 1n,
		universeId: 1n,
		...overrides,
	}
}

describe('zoltar migration guards', () => {
	test('blocks migration when wallet or network prerequisites are missing', () => {
		expect(getMigrationGuardMessage(undefined, true, createUniverse(), false, true, false, 'Fork first.')).toBe('Connect wallet to continue.')
		expect(getMigrationGuardMessage(zeroAddress, false, createUniverse(), false, true, false, 'Fork first.')).toBe('Switch to Ethereum mainnet.')
	})

	test('waits for root universe and fork state before migration actions can proceed', () => {
		expect(getMigrationGuardMessage(zeroAddress, true, undefined, false, false, false, 'Fork Oracle before preparing REP.')).toBe('Refresh universe first.')
		expect(getMigrationGuardMessage(zeroAddress, true, createUniverse({ hasForked: false }), false, false, false, 'Fork Oracle before preparing REP.')).toBe('Fork Oracle before preparing REP.')
		expect(getMigrationGuardMessage(zeroAddress, true, createUniverse(), false, true, false, 'Fork Oracle before preparing REP.')).toBeUndefined()
	})
})
