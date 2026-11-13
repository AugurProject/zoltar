import { expect, test } from 'bun:test'
import { isObjectRecord, isPlainRecord, requireArrayOf } from './guards.js'

test('isObjectRecord accepts non-null objects only', () => {
	expect(isObjectRecord({})).toBe(true)
	expect(isObjectRecord([])).toBe(true)
	expect(isObjectRecord(null)).toBe(false)
	expect(isObjectRecord(undefined)).toBe(false)
	expect(isObjectRecord('value')).toBe(false)
})

test('isPlainRecord accepts non-null, non-array objects only', () => {
	expect(isPlainRecord({})).toBe(true)
	expect(isPlainRecord([])).toBe(false)
	expect(isPlainRecord(null)).toBe(false)
	expect(isPlainRecord(undefined)).toBe(false)
	expect(isPlainRecord('value')).toBe(false)
})

test('requireArrayOf returns arrays whose every element passes the guard', () => {
	const requireBigintArray = requireArrayOf((value: unknown): value is bigint => typeof value === 'bigint')
	const values = [1n, 2n]
	expect(requireBigintArray(values, 'bigint list')).toBe(values)
	expect(requireBigintArray([], 'bigint list')).toEqual([])
	expect(() => requireBigintArray([1n, 2], 'bigint list')).toThrow('Unexpected bigint list response')
	expect(() => requireBigintArray(1n, 'bigint list')).toThrow('Unexpected bigint list response')
})
