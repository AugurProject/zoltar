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

	test('continues with two agreeing readers when a third is unavailable', async () => {
		await expect(
			readWithQuorum('canonical head', ['primary', 'secondary', 'offline'], async endpoint => {
				if (endpoint === 'offline') throw new Error('connection refused')
				return { hash: '0xabc', number: 42n }
			}),
		).resolves.toEqual({ hash: '0xabc', number: 42n })
	})

	test('still fails closed when every available reader does not agree', async () => {
		await expect(
			readWithQuorum('canonical head', ['primary', 'secondary', 'offline'], async endpoint => {
				if (endpoint === 'offline') throw new Error('connection refused')
				return endpoint === 'primary' ? '0xabc' : '0xdef'
			}),
		).rejects.toThrow('RPC disagreement')
	})

	test('does not hide a safety failure behind two healthy readers', async () => {
		await expect(
			readWithQuorum('deployment code', ['primary', 'secondary', 'malformed'], async endpoint => {
				if (endpoint === 'malformed') throw new Error('runtime bytecode hash mismatch')
				return '0xabc'
			}),
		).rejects.toThrow('runtime bytecode hash mismatch')
	})
})
