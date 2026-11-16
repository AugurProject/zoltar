import { describe, expect, test } from 'bun:test'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { decodeAddress, decodeBool, decodeFields, decodeUint } from './securityPoolPortfolioDecoding.js'

describe('portfolio contract value decoding', () => {
	test('decodeUint accepts bigints and safe integers inside the bit width', () => {
		expect(decodeUint(5n, 'Lots')).toBe(5n)
		expect(decodeUint(7, 'Settlement time', 48)).toBe(7n)
		expect(() => decodeUint(-1n, 'Lots')).toThrow('Lots must fit uint256.')
		expect(() => decodeUint(1n << 48n, 'Settlement time', 48)).toThrow('Settlement time must fit uint48.')
		expect(() => decodeUint(1.5, 'Lots')).toThrow('Lots must fit uint256.')
		expect(() => decodeUint('1', 'Lots')).toThrow('Lots must fit uint256.')
	})

	test('decodeAddress checksums and rejects the zero address unless allowed', () => {
		const lowercase = '0x52908400098527886e0f7030069857d2e4169ee7'
		expect(decodeAddress(lowercase, 'Owner')).toBe('0x52908400098527886E0F7030069857D2E4169EE7')
		expect(() => decodeAddress(zeroAddress, 'Owner')).toThrow('Owner must be a nonzero address.')
		expect(decodeAddress(zeroAddress, 'Owner', true)).toBe(zeroAddress)
		expect(() => decodeAddress('0x1234', 'Owner')).toThrow('Owner must be a nonzero address.')
	})

	test('decodeBool throws the caller message for non-booleans', () => {
		expect(decodeBool(false, 'Invalid state.')).toBe(false)
		expect(() => decodeBool(0, 'Invalid state.')).toThrow('Invalid state.')
	})

	test('decodeFields reads tuple arrays and named objects in field order', () => {
		expect(decodeFields([1n, true], ['lots', 'settled'], 'Invalid response.')).toEqual([1n, true])
		expect(decodeFields({ settled: true, lots: 1n }, ['lots', 'settled'], 'Invalid response.')).toEqual([1n, true])
		expect(() => decodeFields([1n], ['lots', 'settled'], 'Invalid response.')).toThrow('Invalid response.')
		expect(() => decodeFields(undefined, ['lots'], 'Invalid response.')).toThrow('Invalid response.')
	})
})
