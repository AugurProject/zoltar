import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'bun:test'
import { array, booleanValue, decode, dictionary, numberValue, object, oneOf, optional, stringValue, union } from '../src/dashboard/response-validation.ts'

const response = object<{ enabled: boolean; items: { label: string; count?: number }[] }>({ enabled: booleanValue, items: array(object<{ label: string; count?: number }>({ label: stringValue, count: optional(numberValue) })) })

test('validates required and optional fields throughout response arrays', () => {
	expect(response({ enabled: false, items: [{ label: 'a' }], extra: true })).toBe(true)
	for (const value of [null, [], {}, { enabled: 'false', items: [] }, { enabled: true, items: [null] }, { enabled: true, items: [{ label: 'a', count: '1' }] }, { enabled: true, items: [{ label: 'a', count: NaN }] }]) {
		expect(response(value)).toBe(false)
		expect(() => decode(value, response, 'state snapshot')).toThrow('invalid state snapshot')
	}
})

test('validates dictionary values and literal alternatives without coercion', () => {
	const guard = dictionary(union(oneOf('ready', 'pending'), numberValue))
	expect(guard({ phase: 'ready', count: 1 })).toBe(true)
	for (const value of [[], null, { phase: 'unknown' }, { count: Infinity }]) expect(guard(value)).toBe(false)
})

test('exposes response validators through the shared package export map', () => {
	expect(createRequire(import.meta.url).resolve('@zoltar/bot-shared/dashboard/response-validation')).toBe(fileURLToPath(new URL('../src/dashboard/response-validation.ts', import.meta.url)))
})
