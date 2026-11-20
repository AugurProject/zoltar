/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getAddress } from '@zoltar/core-shared/evm/ethereum'
import { tokenDisplayLabel } from '../lib/tokenLabel.js'

const address = getAddress('0x1234567890abcdef1234567890abcdef12345678')

void describe('tokenDisplayLabel', () => {
	void test('shows a verified token by its symbol', () => {
		expect(tokenDisplayLabel({ address, symbol: 'WETH', verified: true })).toBe('WETH')
	})

	void test('suffixes an unverified token symbol with its shortened address', () => {
		expect(tokenDisplayLabel({ address, symbol: ' REP ', verified: false })).toBe('REP (0x123456…345678)')
	})

	void test('escapes hidden characters so a bidi override cannot reorder the address suffix', () => {
		expect(tokenDisplayLabel({ address, symbol: 'REP\u202E', verified: false })).toBe('REP\\u{202E} (0x123456…345678)')
	})

	void test.each([undefined, '', '   '])('names a token without a usable symbol by its address: %p', symbol => {
		expect(tokenDisplayLabel({ address, symbol, verified: false })).toBe('Token 0x123456…345678')
		expect(tokenDisplayLabel({ address, symbol, verified: true })).toBe('Token 0x123456…345678')
	})
})
