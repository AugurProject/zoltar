import { expect, test } from 'bun:test'
import { boolean, integer, nonemptyString, optionalRecord, record } from '../src/infrastructure/json-validation.ts'
import { errorMessage } from '../src/infrastructure/error-message.ts'

test('JSON validators preserve values and reject invalid shapes and boundaries', () => {
	const input = { enabled: false }
	expect(record(input, 'config')).toBe(input)
	expect(optionalRecord(input)).toEqual(input)
	for (const value of [null, [], true, 'record']) {
		expect(() => record(value, 'config')).toThrow('config must be an object')
		expect(optionalRecord(value)).toBeUndefined()
	}
	expect(boolean(false, 'enabled')).toBe(false)
	expect(() => boolean(0, 'enabled')).toThrow('enabled must be a boolean')
	expect(integer(1, 'count', 1, 2)).toBe(1)
	expect(integer(2, 'count', 1, 2)).toBe(2)
	for (const value of [0, 3, 1.5, NaN, Infinity, '1']) expect(() => integer(value, 'count', 1, 2)).toThrow('count must be an integer')
	expect(nonemptyString(' name ', 'name')).toBe(' name ')
	expect(() => nonemptyString(' ', 'name')).toThrow('name must be a non-empty string')
})

test('errorMessage handles errors and non-error thrown values', () => {
	expect(errorMessage(new Error('failed'))).toBe('failed')
	expect(errorMessage(undefined)).toBe('undefined')
	expect(errorMessage(42)).toBe('42')
})
