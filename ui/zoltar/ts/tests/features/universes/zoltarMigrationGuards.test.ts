/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { getMigrationGuardMessage } from '@zoltar/ui-zoltar-shared/features/universes/lib/zoltarMigrationGuards.js'
import type { ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import { createUniverseSummary } from '@zoltar/ui-core-shared/tests/testUtils/universeFixtures.js'

function createUniverse(overrides: Partial<ZoltarUniverseSummary> = {}): ZoltarUniverseSummary {
	return createUniverseSummary({
		hasForked: true,
		...overrides,
	})
}

describe('zoltar migration guards', () => {
	test('blocks migration when wallet or network prerequisites are missing', () => {
		expect(getMigrationGuardMessage(undefined, true, createUniverse(), false, true, false, 'Fork first.')).toBe('Connect wallet to continue.')
		expect(getMigrationGuardMessage(zeroAddress, false, createUniverse(), false, true, false, 'Fork first.')).toBe('Switch to Sepolia.')
	})

	test('waits for root universe and fork state before migration actions can proceed', () => {
		expect(getMigrationGuardMessage(zeroAddress, true, undefined, false, false, false, '')).toBe('Universe details could not be loaded.')
		expect(getMigrationGuardMessage(zeroAddress, true, createUniverse({ hasForked: false }), false, false, false, '')).toBeUndefined()
		expect(getMigrationGuardMessage(zeroAddress, true, createUniverse(), false, true, false, '')).toBeUndefined()
	})
})
