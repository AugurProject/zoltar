/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { zeroAddress } from '@zoltar/shared/ethereum'
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
		expect(getMigrationGuardMessage(zeroAddress, false, createUniverse(), false, true, false, 'Fork first.')).toBeUndefined()
	})

	test('waits for root universe and fork state before migration actions can proceed', () => {
		expect(getMigrationGuardMessage(zeroAddress, true, undefined, false, false, false, 'REP preparation is unavailable because this universe has not forked.')).toBe('Refresh universe first.')
		expect(getMigrationGuardMessage(zeroAddress, true, createUniverse({ hasForked: false }), false, false, false, 'REP preparation is unavailable because this universe has not forked.')).toBe('REP preparation is unavailable because this universe has not forked.')
		expect(getMigrationGuardMessage(zeroAddress, true, createUniverse(), false, true, false, 'REP preparation is unavailable because this universe has not forked.')).toBeUndefined()
	})
})
