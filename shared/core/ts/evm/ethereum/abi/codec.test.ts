import { expect, test } from 'bun:test'
import { encodeAbiParameters } from '../../ethereum.js'

test('encodes an empty Solidity parameter list as empty bytes', () => {
	expect(encodeAbiParameters([], [])).toBe('0x')
	expect(() => encodeAbiParameters([], [1n])).toThrow()
})
