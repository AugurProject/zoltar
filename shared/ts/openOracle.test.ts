import { describe, expect, test } from 'bun:test'
import { getAddress, hexToBytes, type Address, type Hex } from './ethereum.js'
import { decodeOpenOracleStatePreimage, getOpenOracleGameTuple, getOpenOracleHelperTuple, hashOpenOracleStatePreimage } from './openOracle.js'

function encodePackedUint(value: bigint, width: number) {
	return value.toString(16).padStart(width * 2, '0')
}

function encodePackedAddress(value: Address) {
	return value.slice(2).toLowerCase()
}

describe('OpenOracle packed state preimages', () => {
	test('decodes every OpenOracleSlim packed event field and hashes the ABI preimage', () => {
		const reporter = getAddress('0x1111111111111111111111111111111111111111')
		const token1 = getAddress('0x2222222222222222222222222222222222222222')
		const feeRecipient = getAddress('0x3333333333333333333333333333333333333333')
		const token2 = getAddress('0x4444444444444444444444444444444444444444')
		const callback = getAddress('0x5555555555555555555555555555555555555555')
		const creator = getAddress('0x6666666666666666666666666666666666666666')
		const packed = `0x${[
			encodePackedUint(101n, 16),
			encodePackedUint(202n, 16),
			encodePackedAddress(reporter),
			encodePackedUint(303n, 6),
			encodePackedUint(0n, 6),
			encodePackedAddress(token1),
			encodePackedUint(404n, 6),
			encodePackedUint(505n, 6),
			encodePackedUint(606n, 16),
			encodePackedAddress(feeRecipient),
			encodePackedUint(707n, 12),
			encodePackedAddress(token2),
			encodePackedUint(8n, 3),
			encodePackedUint(9n, 3),
			encodePackedUint(10n, 3),
			encodePackedUint(110n, 2),
			encodePackedAddress(callback),
			encodePackedUint(12n, 4),
			encodePackedUint(13n, 3),
			encodePackedUint(15n, 1),
			encodePackedAddress(creator),
			encodePackedUint(14n, 6),
			encodePackedUint(15n, 6),
		].join('')}` satisfies Hex
		expect(hexToBytes(packed)).toHaveLength(235)

		const preimage = decodeOpenOracleStatePreimage(packed, 16n)
		expect(getOpenOracleGameTuple(preimage.game)).toEqual([101n, 202n, reporter, 303n, 0n, token1, 404n, 505n, 606n, feeRecipient, 707n, token2, 8n, 9n, 10n, 110n, callback, 12n, 13n, 15n])
		expect(getOpenOracleHelperTuple(preimage.helper)).toEqual([16n, creator, 14n, 15n])
		expect(hashOpenOracleStatePreimage(preimage)).toMatch(/^0x[0-9a-f]{64}$/)
	})

	test('rejects non-canonical packed lengths', () => {
		expect(() => decodeOpenOracleStatePreimage('0x00', 1n)).toThrow('must be 235 bytes')
	})
})
