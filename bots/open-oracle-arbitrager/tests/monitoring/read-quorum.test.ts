import { describe, expect, test } from 'bun:test'
import { quorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'

describe('independent read quorum', () => {
	test('accepts one endpoint under quorum 1 and enforces exact agreement for quorum 2', () => {
		expect(quorumValue('state hash', [{ endpoint: 'primary', value: 1n }], 1)).toBe(1n)
		expect(() => quorumValue('state hash', [{ endpoint: 'primary', value: 1n }], 2)).toThrow('at least two')
		expect(
			quorumValue(
				'state hash',
				[
					{ endpoint: 'primary', value: { block: 10n, hash: '0xabc' } },
					{ endpoint: 'secondary', value: { block: 10n, hash: '0xabc' } },
				],
				2,
			),
		).toEqual({ block: 10n, hash: '0xabc' })
		expect(() =>
			quorumValue(
				'state hash',
				[
					{ endpoint: 'primary', value: { block: 10n, hash: '0xabc' } },
					{ endpoint: 'secondary', value: { block: 10n, hash: '0xdef' } },
				],
				2,
			),
		).toThrow('RPC disagreement')
	})
})
