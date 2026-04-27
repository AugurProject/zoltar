/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getAddress } from 'viem'
import { approvalShortage, approvalTargetAmount, balanceShortage, parseOptionalBigIntInput, resolveOptionalAddressInput, resolveOptionalBigIntListInput } from '../lib/inputs.js'

void describe('input helpers', () => {
	void test('parseOptionalBigIntInput returns undefined for empty input', () => {
		expect(parseOptionalBigIntInput('')).toBe(undefined)
		expect(parseOptionalBigIntInput('   ')).toBe(undefined)
	})

	void test('parseOptionalBigIntInput parses whole numbers and ignores invalid values', () => {
		expect(parseOptionalBigIntInput('123')).toBe(123n)
		expect(parseOptionalBigIntInput('not-a-number')).toBe(undefined)
	})

	void test('resolveOptionalAddressInput falls back for empty input and parses valid addresses', () => {
		const fallback = getAddress('0x000000000000000000000000000000000000dEaD')
		expect(resolveOptionalAddressInput('', fallback, 'Vault address')).toBe(fallback)
		expect(resolveOptionalAddressInput('   ', fallback, 'Vault address')).toBe(fallback)
		expect(resolveOptionalAddressInput('0x0000000000000000000000000000000000000001', fallback, 'Vault address')).toBe(getAddress('0x0000000000000000000000000000000000000001'))
	})

	void test('resolveOptionalBigIntListInput falls back for empty input and parses values', () => {
		expect(resolveOptionalBigIntListInput('', [1n, 2n], 'Outcome indexes')).toEqual([1n, 2n])
		expect(resolveOptionalBigIntListInput('  ', [1n, 2n], 'Outcome indexes')).toEqual([1n, 2n])
		expect(resolveOptionalBigIntListInput('3, 4', [1n, 2n], 'Outcome indexes')).toEqual([3n, 4n])
	})

	void test('balanceShortage reports how much REP is missing for a deposit', () => {
		expect(balanceShortage(undefined, 5n)).toBe(undefined)
		expect(balanceShortage(5n, undefined)).toBe(undefined)
		expect(balanceShortage(5n, 5n)).toBe(0n)
		expect(balanceShortage(6n, 5n)).toBe(1n)
	})

	void test('approvalTargetAmount returns the next total allowance target for the shared approval flow', () => {
		expect(approvalShortage(11n, 10n)).toBe(1n)
		expect(approvalTargetAmount(11n, 10n)).toBe(11n)
		expect(approvalTargetAmount(10n, 10n)).toBe(undefined)
		expect(approvalTargetAmount(10n, undefined)).toBe(10n)
		expect(approvalTargetAmount(0n, 0n)).toBe(undefined)
	})
})
