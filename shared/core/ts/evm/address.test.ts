import { expect, test } from 'bun:test'
import { sameAddress } from './address.js'

test('compares address case without treating missing values as matches', () => {
	expect(sameAddress('0xaB', '0xAb')).toBe(true)
	expect(sameAddress('0xab', '0xac')).toBe(false)
	expect(sameAddress(undefined, undefined)).toBe(false)
	expect(sameAddress('0xab', undefined)).toBe(false)
	expect(sameAddress(' 0xab', '0xab')).toBe(false)
})
