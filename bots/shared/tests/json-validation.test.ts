import { expect, test } from 'bun:test'
import { boolean, formatDecimalAmount, integer, nonemptyString, optionalRecord, parseDecimalAmount, parseSignedDecimalAmount, record } from '../src/infrastructure/json-validation.ts'
import { errorMessage } from '@zoltar/core-shared/errors/errorMessage'

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

test('strict 18-decimal amounts round-trip unsigned and signed values', () => {
	expect(parseDecimalAmount('1.5', 'amount')).toBe(15n * 10n ** 17n)
	expect(parseDecimalAmount('0.000000000000000001', 'amount')).toBe(1n)
	for (const value of ['-1', '01', '1.', '.5', '1.0000000000000000001', ' 1', '1e3', 1]) expect(() => parseDecimalAmount(value, 'amount')).toThrow('amount must be a non-negative decimal with at most 18 places')
	expect(parseSignedDecimalAmount('-0.0015', 'profit')).toBe(-15n * 10n ** 14n)
	expect(parseSignedDecimalAmount('2', 'profit')).toBe(2n * 10n ** 18n)
	for (const value of ['--1', '-01', '+1', '-1.', '-1.0000000000000000001']) expect(() => parseSignedDecimalAmount(value, 'profit')).toThrow('profit must be a decimal with at most 18 places')
	expect(formatDecimalAmount(15n * 10n ** 17n)).toBe('1.5')
	expect(formatDecimalAmount(0n)).toBe('0')
	expect(formatDecimalAmount(-15n * 10n ** 14n)).toBe('-0.0015')
	expect(formatDecimalAmount(-2n * 10n ** 18n)).toBe('-2')
})
