import { describe, expect, test } from 'bun:test'
import { commitSignerMutation } from '../../src/core/signer-mutation.ts'

describe('signer mutation', () => {
	test('does not activate a remembered signer when persistence fails', async () => {
		let activeSigner = 'original'
		await expect(
			commitSignerMutation(
				'replacement',
				true,
				async () => {
					throw new Error('settings revision conflict')
				},
				signer => {
					activeSigner = signer
				},
			),
		).rejects.toThrow('settings revision conflict')
		expect(activeSigner).toBe('original')
	})

	test('activates an ephemeral signer without persisting it', async () => {
		let activeSigner = 'original'
		let persisted = false
		await commitSignerMutation(
			'replacement',
			false,
			async () => {
				persisted = true
			},
			signer => {
				activeSigner = signer
			},
		)
		expect(persisted).toBe(false)
		expect(activeSigner).toBe('replacement')
	})
})
