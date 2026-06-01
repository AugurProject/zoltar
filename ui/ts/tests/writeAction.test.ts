/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getAddress } from 'viem'
import { runWriteAction } from '../lib/writeAction.js'

const walletAddress = getAddress('0x00000000000000000000000000000000000000a1')
const transactionHash = '0x00000000000000000000000000000000000000000000000000000000000000a1'

describe('runWriteAction', () => {
	test('uses the provided missing-wallet message when no wallet is connected', async () => {
		let errorMessage: string | undefined

		await runWriteAction(
			{
				accountAddress: undefined,
				missingWalletMessage: 'Connect a wallet before creating a question',
				onTransaction: () => undefined,
				onTransactionFinished: () => undefined,
				onTransactionRequested: () => undefined,
				refreshState: async () => undefined,
				setErrorMessage: message => {
					errorMessage = message
				},
			},
			async () => ({ hash: transactionHash }),
			'Failed to create question',
		)

		expect(errorMessage).toBe('Connect a wallet before creating a question')
	})

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

		expect(errorMessage).toBe('Transaction failed while attempting to report on outcome.')
	})

	test('delegates missing-wallet errors to onWriteError when provided', async () => {
		let onWriteErrorMessage: string | undefined

		await runWriteAction(
			{
				accountAddress: undefined,
				missingWalletMessage: 'Please connect your wallet',
				onTransaction: () => undefined,
				onTransactionFinished: () => undefined,
				onTransactionRequested: () => undefined,
				refreshState: async () => undefined,
				onWriteError: message => {
					onWriteErrorMessage = message
				},
				setErrorMessage: () => undefined,
			},
			async () => ({ hash: transactionHash }),
			'Failed to report on outcome',
		)

		expect(onWriteErrorMessage).toBe('Please connect your wallet')
	})

	test('prefers onWriteError over setErrorMessage when provided', async () => {
		let errorMessage: string | undefined
		let onWriteErrorMessage: string | undefined
		let transactionFinished = false

		await runWriteAction(
			{
				accountAddress: walletAddress,
				missingWalletMessage: 'Connect wallet',
				onTransaction: () => undefined,
				onTransactionFinished: () => {
					transactionFinished = true
				},
				onTransactionRequested: () => undefined,
				refreshState: async () => undefined,
				formatErrorMessage: (error, fallback) => {
					void error
					return `custom-${fallback}`
				},
				onWriteError: message => {
					onWriteErrorMessage = message
				},
				setErrorMessage: message => {
					errorMessage = message
				},
			},
			async () => {
				throw new Error('reverted')
			},
			'Failed to report on outcome',
		)

		expect(onWriteErrorMessage).toBe('custom-Failed to report on outcome')
		expect(errorMessage).toBeUndefined()
		expect(transactionFinished).toBe(true)
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
		expect(errorMessage).toBe('Reporting transaction succeeded, but refreshing reporting details failed. Reason: RPC unavailable')
	})

	test('reports refresh errors to the refresh callback without using setErrorMessage', async () => {
		let refreshErrorMessage: string | undefined
		let refreshErrorHash: string | undefined

		await runWriteAction(
			{
				accountAddress: walletAddress,
				missingWalletMessage: 'Connect wallet',
				onTransaction: () => undefined,
				onTransactionFinished: () => undefined,
				onTransactionRequested: () => undefined,
				refreshErrorFallback: 'Refresh failure fallback',
				refreshState: async () => {
					throw new Error('RPC unavailable')
				},
				onRefreshError: (message, hash) => {
					refreshErrorMessage = message
					refreshErrorHash = hash
				},
				setErrorMessage: () => undefined,
			},
			async () => ({ hash: transactionHash }),
			'Failed to report on outcome',
			async () => undefined,
		)

		expect(refreshErrorMessage).toBe('Refresh failure fallback. Reason: RPC unavailable')
		expect(refreshErrorHash).toBe(transactionHash)
	})
})
