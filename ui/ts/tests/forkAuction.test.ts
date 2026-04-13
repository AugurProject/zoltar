/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getOutcomeActionLabel } from '../lib/forkAuction.js'

void describe('fork auction helpers', () => {
	void test('getOutcomeActionLabel reuses reporting labels', () => {
		expect(getOutcomeActionLabel('invalid')).toBe('Invalid')
		expect(getOutcomeActionLabel('yes')).toBe('Yes')
		expect(getOutcomeActionLabel('no')).toBe('No')
	})
})
