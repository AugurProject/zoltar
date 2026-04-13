import { describe, expect, test } from 'bun:test'
import { requireDefined } from '../lib/required.js'

describe('requireDefined', () => {
	test('returns defined values', () => {
		expect(requireDefined('value', 'missing')).toBe('value')
	})

	test('throws for undefined values', () => {
		expect(() => requireDefined(undefined, 'missing')).toThrow('missing')
	})
})
