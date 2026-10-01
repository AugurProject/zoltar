import { describe, expect, test } from 'bun:test'
import { sortBigIntsAscending, stringifyWithBigInts } from './bigInt.js'

describe('sortBigIntsAscending', () => {
	test('sorts descending and duplicate values without mutating the input', () => {
		const values = [2n, 1n, 2n]

		expect(sortBigIntsAscending(values)).toEqual([1n, 2n, 2n])
		expect(values).toEqual([2n, 1n, 2n])
	})
})

describe('stringifyWithBigInts', () => {
	test('writes nested bigints as decimal strings and omits undefined fields like JSON.stringify', () => {
		expect(stringifyWithBigInts({ amount: 12n, nested: [{ nonce: 0n, label: 'x' }], missing: undefined })).toBe('{"amount":"12","nested":[{"nonce":"0","label":"x"}]}')
		expect(stringifyWithBigInts({ amount: -3n }, 1)).toBe('{\n "amount": "-3"\n}')
	})
})
