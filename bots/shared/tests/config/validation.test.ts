import { expect, test } from 'bun:test'
import { requiredRecord, boolean, integer, nonemptyString, parseDecimalAmount } from '../../src/config/validation.ts'

test('record validation preserves the same object and rejects non-records', () => {
	const value = { a: 1 }
	expect(requiredRecord(value, 'Config')).toBe(value)
	for (const invalid of [undefined, null, [], false, 'value']) expect(() => requiredRecord(invalid, 'Config')).toThrow('Config must be an object')
})

test('boolean and string validation do not coerce values or trim accepted strings', () => {
	expect(boolean(false, 'Pause')).toBe(false)
	expect(boolean(true, 'Pause')).toBe(true)
	for (const invalid of ['true', 0, undefined, null]) expect(() => boolean(invalid, 'Pause')).toThrow('Pause must be a boolean')
	expect(nonemptyString(' padded ', 'Name')).toBe(' padded ')
	for (const invalid of ['', ' \n ', 1, undefined]) expect(() => nonemptyString(invalid, 'Name')).toThrow('Name must be a non-empty string')
})

test('integer boundaries are inclusive, safe, and retain the through error contract', () => {
	expect(integer(1, 'Count', 1, 3)).toBe(1)
	expect(integer(3, 'Count', 1, 3)).toBe(3)
	for (const invalid of [0, 4, 1.5, '2', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(() => integer(invalid, 'Count', 1, 3)).toThrow('Count must be an integer from 1 through 3')
})

test('decimal parser preserves exact 18-place scaling without accepting numeric coercions', () => {
	expect(parseDecimalAmount('1.000000000000000001', 'Amount')).toBe(1000000000000000001n)
	expect(parseDecimalAmount('0', 'Amount')).toBe(0n)
	for (const invalid of [1, '', '01', '-1', '1e2', '1.0000000000000000001']) expect(() => parseDecimalAmount(invalid, 'Amount')).toThrow('Amount must be a non-negative decimal with at most 18 places')
})
