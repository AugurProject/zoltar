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
		expect(getMigrationGuardMessage(undefined, true, createUniverse(), false)).toBe('Connect wallet to continue.')
		expect(getMigrationGuardMessage(zeroAddress, false, createUniverse(), false)).toBe('Switch to Sepolia.')
	})

	test('waits for the root universe before migration actions can proceed', () => {
		expect(getMigrationGuardMessage(zeroAddress, true, undefined, false)).toBe('Refresh universe first.')
		expect(getMigrationGuardMessage(zeroAddress, true, createUniverse({ hasForked: false }), false)).toBeUndefined()
		expect(getMigrationGuardMessage(zeroAddress, true, createUniverse(), false)).toBeUndefined()
	})
})
