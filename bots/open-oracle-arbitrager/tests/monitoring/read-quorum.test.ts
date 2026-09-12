import { describe, expect, test } from 'bun:test'
import { quorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'

describe('independent read quorum', () => {
	test('accepts one endpoint by default and enforces exact agreement for an explicit quorum', () => {
		expect(quorumValue('state hash', [{ endpoint: 'primary', value: 1n }])).toBe(1n)
		expect(() => quorumValue('state hash', [{ endpoint: 'primary', value: 1n }], 2)).toThrow('at least two')
		expect(
			quorumValue('state hash', [
				{ endpoint: 'primary', value: { block: 10n, hash: '0xabc' } },
				{ endpoint: 'secondary', value: { block: 10n, hash: '0xabc' } },
			]),
		).toEqual({ block: 10n, hash: '0xabc' })
		expect(() =>
			quorumValue('state hash', [
				{ endpoint: 'primary', value: { block: 10n, hash: '0xabc' } },
				{ endpoint: 'secondary', value: { block: 10n, hash: '0xdef' } },
			]),
		).toThrow('RPC disagreement')
	})
})
