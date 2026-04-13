/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getAddress } from 'viem'
import { parseOptionalBigIntInput, resolveOptionalAddressInput, resolveOptionalBigIntListInput } from '../lib/inputs.js'

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
})
