/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getAddress } from 'viem'
import { normalizeAddress, sameAddress } from '../lib/address.js'
import { sameCaseInsensitiveText } from '../lib/caseInsensitive.js'

void describe('case-insensitive text helpers', () => {
	void test('sameAddress compares addresses without regard to case', () => {
		const address = getAddress('0x00000000000000000000000000000000000000a1')
		expect(sameAddress(address, address.toUpperCase())).toBe(true)
		expect(sameAddress(address, getAddress('0x00000000000000000000000000000000000000a2'))).toBe(false)
		expect(sameAddress(undefined, address)).toBe(false)
	})

	void test('normalizeAddress trims and lowercases address text', () => {
		expect(normalizeAddress(' 0x00000000000000000000000000000000000000A1 ')).toBe('0x00000000000000000000000000000000000000a1')
		expect(normalizeAddress(undefined)).toBe(undefined)
	})

	void test('sameCaseInsensitiveText compares arbitrary text without regard to case', () => {
		expect(sameCaseInsensitiveText('Question-1', 'question-1')).toBe(true)
		expect(sameCaseInsensitiveText('Question-1', 'question-2')).toBe(false)
	})
})
