import { describe, expect, test } from 'bun:test'
import { simulateSignedBundleEveryRelay, submitSignedBundle, submitSignedTransaction } from '../src/execution/transaction-submission.ts'
import { flashbotsPrivateTransactionCompatibilityProfileAllowed } from '../src/monitoring/relay-compatibility.ts'

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

	test('restricts the Flashbots compatibility profile to the official relay for each chain or loopback tests', () => {
		expect(flashbotsPrivateTransactionCompatibilityProfileAllowed('https://relay.flashbots.net', 1)).toBeTrue()
		expect(flashbotsPrivateTransactionCompatibilityProfileAllowed('https://relay-sepolia.flashbots.net', 11_155_111)).toBeTrue()
		expect(flashbotsPrivateTransactionCompatibilityProfileAllowed('https://relay-sepolia.flashbots.net/path', 11_155_111)).toBeTrue()
		expect(flashbotsPrivateTransactionCompatibilityProfileAllowed('https://relay-sepolia.flashbots.net', 1)).toBeFalse()
		expect(flashbotsPrivateTransactionCompatibilityProfileAllowed('https://relay.flashbots.net', 11_155_111)).toBeFalse()
		expect(flashbotsPrivateTransactionCompatibilityProfileAllowed('https://untrusted-private-relay.example', 11_155_111)).toBeFalse()
		expect(flashbotsPrivateTransactionCompatibilityProfileAllowed('http://127.0.0.1:8545', 1)).toBeTrue()
	})
})
