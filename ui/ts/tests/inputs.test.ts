/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getAddress } from '@zoltar/shared/ethereum'
import {
	approvalShortage,
	approvalTargetAmount,
	balanceShortage,
	getReportingOutcomeKey,
	parseAddressInput,
	parseBytes32Input,
	parseBigIntListInput,
	parseOptionalBigIntInput,
	parseReportingOutcomeInput,
	parseReportingOutcomeListInput,
	parseReportIdInput,
	resolveOptionalAddressInput,
	resolveOptionalBigIntListInput,
} from '../lib/inputs.js'
import { parseOptionalRepAmountInput, parseRepAmountInput, parseTimestampInput } from '../lib/marketForm.js'

void describe('input helpers', () => {
	void test('parses and trims required address inputs', () => {
		expect(parseAddressInput('  0x0000000000000000000000000000000000000001  ', 'Wallet address')).toBe(getAddress('0x0000000000000000000000000000000000000001'))
		expect(() => parseAddressInput('   ', 'Wallet address')).toThrow('Wallet address is required')
	})

	void test('throws when required address parsing fails', () => {
		const result = (() => {
			try {
				parseAddressInput('not-an-address', 'Vault address')
				return undefined
			} catch (error) {
				return error
			}
		})()

		expect(result).toBeInstanceOf(Error)
		expect((result as Error).message).toContain('not-an-address')
	})

	void test('parseOptionalBigIntInput returns undefined for empty input', () => {
		expect(parseOptionalBigIntInput('')).toBe(undefined)
		expect(parseOptionalBigIntInput('   ')).toBe(undefined)
	})

	void test('parseOptionalBigIntInput parses whole numbers and ignores invalid values', () => {
		expect(parseOptionalBigIntInput('123')).toBe(123n)
		expect(parseOptionalBigIntInput('not-a-number')).toBe(undefined)
	})

	void test('parseReportIdInput enforces bigint parsing and handles malformed values', () => {
		expect(parseReportIdInput('42')).toBe(42n)
		expect(() => parseReportIdInput('  not-a-number  ')).toThrow('Report ID must be a whole number')
	})

	void test('resolveOptionalAddressInput falls back for empty input and parses valid addresses', () => {
		const fallback = getAddress('0x000000000000000000000000000000000000dEaD')
		expect(resolveOptionalAddressInput('', fallback, 'Vault address')).toBe(fallback)
		expect(resolveOptionalAddressInput('   ', fallback, 'Vault address')).toBe(fallback)
		expect(resolveOptionalAddressInput('0x0000000000000000000000000000000000000001', fallback, 'Vault address')).toBe(getAddress('0x0000000000000000000000000000000000000001'))
		expect(() => resolveOptionalAddressInput('not-an-address', fallback, 'Vault address')).toThrow('not-an-address')
	})

	void test('parses and validates bytes32 hex inputs', () => {
		const bytes32 = `0x${'00'.repeat(32)}` as `0x${string}`
		expect(parseBytes32Input(bytes32, 'Bytes32')).toBe(bytes32)
		expect(() => parseBytes32Input('0x1234', 'Bytes32')).toThrow('Bytes32')
		expect(() => parseBytes32Input('abc', 'Bytes32')).toThrow('Bytes32')
	})

	void test('parseOptional functions cover whitespace and boundary behavior', () => {
		expect(parseOptionalBigIntInput(' 3, 4 , ')).toBeUndefined()
		expect(parseOptionalRepAmountInput('')).toBe(undefined)
		expect(parseOptionalRepAmountInput('abc')).toBe(undefined)
		expect(parseOptionalRepAmountInput('1.25')).toBe(1_250_000_000_000_000_000n)
	})

	void test('parses lists and report outcomes with boundary handling', () => {
		expect(parseBigIntListInput('3, 4, 5', 'Outcome indexes')).toEqual([3n, 4n, 5n])
		expect(() => parseBigIntListInput('3, foo', 'Outcome indexes')).toThrow('Outcome indexes #2 must be a whole number')
		expect(parseBigIntListInput(' 1, 2, 3 ', 'Outcome indexes')).toEqual([1n, 2n, 3n])

		expect(resolveOptionalBigIntListInput('', [1n, 2n], 'Outcome indexes')).toEqual([1n, 2n])
		expect(resolveOptionalBigIntListInput('3,4', [1n, 2n], 'Outcome indexes')).toEqual([3n, 4n])
		expect(parseReportingOutcomeInput('yes')).toBe('yes')
		expect(parseReportingOutcomeListInput('YES, no, INVALID', 'Outcomes')).toEqual(['yes', 'no', 'invalid'])
		expect(() => parseReportingOutcomeInput('maybe')).toThrow('Unknown reporting outcome')
		expect(() => parseReportingOutcomeListInput('yes, maybe', 'Outcomes')).toThrow('Unknown reporting outcome')
	})

	void test('maps reporting outcome indexes to known keys', () => {
		expect(getReportingOutcomeKey(0n)).toBe('invalid')
		expect(getReportingOutcomeKey(1n)).toBe('yes')
		expect(getReportingOutcomeKey(2n)).toBe('no')
		expect(getReportingOutcomeKey('no')).toBe('no')
		expect(() => getReportingOutcomeKey(9n)).toThrow('Unsupported child universe outcome index: 9')
	})

	void test('resolves parsed amounts and shortages across branches', () => {
		expect(parseRepAmountInput('2.5', 'REP amount')).toBe(2_500_000_000_000_000_000n)
		expect(() => parseRepAmountInput('x', 'REP amount')).toThrow('REP amount must be a decimal number')
		expect(balanceShortage(undefined, 5n)).toBe(undefined)
		expect(balanceShortage(5n, undefined)).toBe(undefined)
		expect(balanceShortage(5n, 5n)).toBe(0n)
		expect(balanceShortage(6n, 5n)).toBe(1n)

		expect(approvalShortage(11n, 10n)).toBe(1n)
		expect(approvalTargetAmount(11n, 10n)).toBe(11n)
		expect(approvalTargetAmount(10n, 10n)).toBe(undefined)
	})

	void test('parses timestamps and exposes malformed errors', () => {
		expect(parseTimestampInput('2025-01-01T00:00:00Z', 'Some time')).toBeGreaterThan(0n)
		expect(() => parseTimestampInput('not-a-time', 'Some time')).toThrow('Some time is invalid')
	})
})
