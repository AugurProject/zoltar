/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { assertNever } from '../lib/assert.js'

describe('assertNever', () => {
	test('throws with the provided unexpected discriminator', () => {
		expect(() => assertNever('unexpected' as never)).toThrow('Unhandled discriminated union member: "unexpected"')
	})

	test('supports debugging object payloads', () => {
		expect(() => assertNever({ kind: 'x' } as never)).toThrow('{"kind":"x"}')
	})
})
