import { describe, expect, test } from 'bun:test'
import { quorumValue, readWithQuorum } from '#monitoring/read-quorum'

describe('independent read quorum', () => {
	test('requires at least two independent endpoints and exact agreement', () => {
		expect(() => quorumValue('state hash', [{ endpoint: 'primary', value: 1n }])).toThrow('at least two')
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

	test('fails closed when pending nonce providers disagree before signing', async () => {
		await expect(readWithQuorum('pending account nonce used for signing', ['primary', 'secondary'], async endpoint => (endpoint === 'primary' ? 7n : 8n))).rejects.toThrow('RPC disagreement')
		expect(await readWithQuorum('pending account nonce used for signing', ['primary', 'secondary'], async () => 7n)).toBe(7n)
	})
})
