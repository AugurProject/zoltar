/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getReportingOutcomeKey, getReportingOutcomeValue, getSecurityPoolSystemState, requireReportingOutcomeKey, tryGetSecurityPoolSystemState } from '../lib/contractEnums.js'

void describe('contract enum helpers', () => {
	void test('maps reporting outcome indexes to keys and back', () => {
		expect(getReportingOutcomeKey(0n)).toBe('invalid')
		expect(getReportingOutcomeKey(1)).toBe('yes')
		expect(getReportingOutcomeKey(2n)).toBe('no')
		expect(getReportingOutcomeKey(3)).toBe('none')
		expect(getReportingOutcomeValue('no')).toBe(2)
		expect(requireReportingOutcomeKey('no')).toBe('no')
		expect(requireReportingOutcomeKey(1n)).toBe('yes')
		expect(() => requireReportingOutcomeKey(9n)).toThrow('Unsupported child universe outcome index: 9')
	})

	void test('maps security pool system states', () => {
		expect(getSecurityPoolSystemState(0)).toBe('operational')
		expect(getSecurityPoolSystemState(1n)).toBe('poolForked')
		expect(getSecurityPoolSystemState(2)).toBe('forkMigration')
		expect(getSecurityPoolSystemState(3n)).toBe('forkTruthAuction')
		expect(() => getSecurityPoolSystemState(4)).toThrow('Unhandled security pool system state: 4')
		expect(tryGetSecurityPoolSystemState(4)).toBeUndefined()
	})
})
