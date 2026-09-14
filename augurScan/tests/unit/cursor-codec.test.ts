import { expect, test } from 'bun:test'
import { encodeOpaqueCursor, parseCursor } from '../../src/cursor-codec.ts'

test('parseCursor preserves endpoint validation and wraps decoding or shape errors', () => {
	const parse = (parts: readonly unknown[]) => {
		if (parts.length !== 1 || typeof parts[0] !== 'number') throw new Error('shape')
		return parts[0]
	}
	const invalid = (cause: unknown) => new Error('cursor is invalid', { cause })
	expect(parseCursor(encodeOpaqueCursor([42]), parse, invalid)).toBe(42)
	for (const value of ['!', encodeOpaqueCursor({ value: 42 }), encodeOpaqueCursor(['42'])]) {
		expect(() => parseCursor(value, parse, invalid)).toThrow('cursor is invalid')
	}
})
