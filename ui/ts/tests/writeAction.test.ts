/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getAddress } from 'viem'
import { runWriteAction } from '../lib/writeAction.js'

const walletAddress = getAddress('0x00000000000000000000000000000000000000a1')
const transactionHash = '0x00000000000000000000000000000000000000000000000000000000000000a1'

describe('runWriteAction', () => {
	test('uses the action fallback when the write action fails', async () => {
		let errorMessage: string | undefined

		await runWriteAction(
			{
				accountAddress: walletAddress,
				missingWalletMessage: 'Connect wallet',
				onTransaction: () => undefined,
				onTransactionFinished: () => undefined,
				onTransactionRequested: () => undefined,
				refreshState: async () => undefined,
				setErrorMessage: message => {
					errorMessage = message
				},
			},
			async () => {
				throw new Error('execution reverted')
			},
			'Failed to report on outcome',
		)

		expect(errorMessage).toBe('Failed to report on outcome')
	})

	test('uses the refresh fallback when post-transaction refresh fails', async () => {
		let errorMessage: string | undefined
		let onSuccessCalled = false

		await runWriteAction(
			{
				accountAddress: walletAddress,
				missingWalletMessage: 'Connect wallet',
				onTransaction: () => undefined,
				onTransactionFinished: () => undefined,
				onTransactionRequested: () => undefined,
				refreshErrorFallback: 'Reporting transaction succeeded, but refreshing reporting details failed',
				refreshState: async () => {
					throw new Error('RPC unavailable')
				},
				setErrorMessage: message => {
					errorMessage = message
				},
			},
			async () => ({ hash: transactionHash }),
			'Failed to report on outcome',
			async () => {
				onSuccessCalled = true
			},
		)

		expect(onSuccessCalled).toBe(true)
		expect(errorMessage).toBe('Reporting transaction succeeded, but refreshing reporting details failed')
	})
})
