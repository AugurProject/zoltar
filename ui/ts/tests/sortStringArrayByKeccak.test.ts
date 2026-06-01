/// <reference types='bun-types' />

import { describe, expect, test } from 'bun:test'
import { encodeAbiParameters, keccak256 } from 'viem'
import { sortStringArrayByKeccak } from '../lib/sortStringArrayByKeccak.js'

void describe('sortStringArrayByKeccak', () => {
	void test('returns strings sorted descending by keccak hash and does not mutate input', () => {
		const values = ['beta', 'alpha', 'zeta', '10']
		const sorted = sortStringArrayByKeccak(values)
		const expected = [...values].sort((first, second) => {
			const firstHash = keccak256(encodeAbiParameters([{ type: 'string' }], [first]))
			const secondHash = keccak256(encodeAbiParameters([{ type: 'string' }], [second]))

			if (firstHash > secondHash) return -1
			if (firstHash < secondHash) return 1
			return 0
		})

		expect(values).toEqual(['beta', 'alpha', 'zeta', '10'])
		expect(sorted).toEqual(['beta', '10', 'alpha', 'zeta'])
		expect(sorted).toEqual(expected)
	})

	void test('keeps duplicates in deterministic positions when hashes are equal', () => {
		const values = ['alpha', 'alpha', 'alpha']
		const sorted = sortStringArrayByKeccak(values)
		expect(sorted).toEqual(values)
	})
})
