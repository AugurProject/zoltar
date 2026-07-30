import { describe, expect, test } from 'bun:test'
import { signerCandidate } from '#config/signer'

describe('operator signer candidate', () => {
	test('derives valid keys and rejects invalid curve scalars before returning state', () => {
		expect(signerCandidate('0x0000000000000000000000000000000000000000000000000000000000000001').address).toBe('0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf')
		expect(() => signerCandidate('0x0000000000000000000000000000000000000000000000000000000000000000')).toThrow()
		expect(() => signerCandidate(`0x${'ff'.repeat(32)}`)).toThrow()
		expect(signerCandidate(null)).toEqual({ address: undefined, privateKey: undefined })
	})
})
