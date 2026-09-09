import { describe, expect, test } from 'bun:test'
import { simulateBundle, simulateSignedBundleEveryRelay, submitSignedBundle, submitSignedTransaction } from '../src/execution/transaction-submission.ts'

describe('relay endpoint policy at the delivery boundary', () => {
	test.each([
		['http://relay.example', 'HTTPS or loopback HTTP'],
		['https://operator:placeholder@relay.example', 'embedded credentials'],
		['https://relay.example?setting=value', 'query parameters'],
		['https://relay.example#section', 'fragments'],
	])('validates %s before requesting an authentication signature', async (relayUrl, message) => {
		let signatureRequests = 0
		const parameters = {
			address: '0x0000000000000000000000000000000000000001',
			relayUrl,
			relayUrls: [relayUrl],
			signMessage: async (): Promise<never> => {
				signatureRequests += 1
				throw new Error('Signing is disabled in this policy test')
			},
			stateBlockNumber: 1n,
			targetBlockNumber: 2n,
			transactions: ['0x'],
		} as const

		await expect(simulateBundle(parameters)).rejects.toThrow(message)
		await expect(simulateSignedBundleEveryRelay(parameters)).rejects.toThrow(message)
		await expect(submitSignedBundle(parameters)).rejects.toThrow(message)
		await expect(
			submitSignedTransaction({
				...parameters,
				hash: '0x',
				maxBlockNumber: 2n,
				publicRpcUrls: [],
				publicSubmit: async (): Promise<never> => {
					throw new Error('Public submission is disabled in this policy test')
				},
				serializedTransaction: '0x',
				settings: { minimumBundleRelaySuccesses: 1, mode: 'private', relayUrls: [relayUrl] },
			}),
		).rejects.toThrow(message)
		expect(signatureRequests).toBe(0)
	})
})
