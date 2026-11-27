/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getReportingOutcomeKey, getReportingOutcomeValue, getQuestionLedgerSystemState, requireReportingOutcomeKey, tryGetQuestionLedgerSystemState } from '../lib/contractEnums.js'

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

	void test('maps question ledger system states', () => {
		expect(getQuestionLedgerSystemState(0)).toBe('operational')
		expect(getQuestionLedgerSystemState(1n)).toBe('poolForked')
		expect(getQuestionLedgerSystemState(2)).toBe('forkMigration')
		expect(() => getQuestionLedgerSystemState(3)).toThrow('Unknown question status: 3')
		expect(() => getQuestionLedgerSystemState(3n)).toThrow('Unknown question status: 3')
		expect(tryGetQuestionLedgerSystemState(3)).toBeUndefined()
	})
})
