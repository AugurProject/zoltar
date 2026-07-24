import { describe, expect, test } from 'bun:test'
import { sortBigIntsAscending } from './bigInt.js'

describe('sortBigIntsAscending', () => {
	test('sorts descending and duplicate values without mutating the input', () => {
		const values = [2n, 1n, 2n]

		expect(sortBigIntsAscending(values)).toEqual([1n, 2n, 2n])
		expect(values).toEqual([2n, 1n, 2n])
	})
})
