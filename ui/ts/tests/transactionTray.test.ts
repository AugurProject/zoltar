/// <reference types='bun-types' />

import { describe, expect, test } from 'bun:test'
import { createInitialTransactionTrayState, markTransactionFailed, markTransactionFinished, markTransactionPrepared, markTransactionPresented, markTransactionRequested, markTransactionSubmitted } from '../lib/transactionTray.js'

const transactionHash = '0x1234000000000000000000000000000000000000000000000000000000000000'

describe('transactionTray', () => {
	test('tracks a requested transaction through submit, presentation, and finish', () => {
		const requested = markTransactionRequested(createInitialTransactionTrayState(), {
			action: 'createMarket',
			source: 'zoltar',
			submittedDetail: 'Question creation transaction submitted.',
			submittedTitle: 'Creating Question',
		})
		const submitted = markTransactionSubmitted(requested, transactionHash)
		const presented = markTransactionPresented(submitted, {
			detail: 'The new question is now on-chain.',
			dismissKey: transactionHash,
			hash: transactionHash,
			title: 'Question Created',
			tone: 'success',
		})
		const finished = markTransactionFinished(presented)

		expect(requested.inFlightCount).toBe(1)
		expect(requested.active?.tone).toBe('awaiting-wallet')
		expect(requested.active?.title).toBe('Creating Question')
		expect(requested.active?.hash).toBeUndefined()
		expect(requested.pendingIntent?.submittedTitle).toBe('Creating Question')
		expect(submitted.active?.tone).toBe('pending')
		expect(submitted.active?.hash).toBe(transactionHash)
		expect(submitted.active?.title).toBe('Creating Question')
		expect(submitted.pendingIntent).toBeUndefined()
		expect(presented.active?.tone).toBe('success')
		expect(presented.active?.title).toBe('Question Created')
		expect(finished.inFlightCount).toBe(0)
	})

	test('does not underflow the in-flight count', () => {
		const finished = markTransactionFinished(createInitialTransactionTrayState())

		expect(finished.inFlightCount).toBe(0)
	})

	test('ignores submitted hashes when no pending intent exists', () => {
		const submitted = markTransactionSubmitted(createInitialTransactionTrayState(), transactionHash)

		expect(submitted.active).toBeUndefined()
	})

	test('adds prepared transaction call details before submission', () => {
		const requested = markTransactionRequested(createInitialTransactionTrayState(), {
			action: 'createMarket',
			source: 'zoltar',
			submittedDetail: 'Question creation transaction submitted.',
			submittedTitle: 'Creating Question',
		})
		const prepared = markTransactionPrepared(requested, {
			account: '0x00000000000000000000000000000000000000a1',
			args: [1n, ['yes', 'no']],
			chainName: 'Ethereum',
			contractAddress: '0x00000000000000000000000000000000000000b2',
			functionName: 'createQuestion',
			value: 0n,
		})
		const submitted = markTransactionSubmitted(prepared, transactionHash)

		expect(prepared.active?.tone).toBe('awaiting-wallet')
		expect(prepared.active?.detail).toBe('Review the prepared transaction, then confirm it in your wallet.')
		expect(prepared.active?.rows?.some(row => row.label === 'Function' && row.value === 'createQuestion')).toBe(true)
		expect(prepared.active?.rows?.some(row => row.label === 'Arguments' && row.value === '1, [yes, no]')).toBe(true)
		expect(submitted.active?.rows?.some(row => row.label === 'Contract' && row.value === '0x00000000000000000000000000000000000000b2')).toBe(true)
	})

	test('uses non-wallet prepared copy for raw broadcasts', () => {
		const requested = markTransactionRequested(createInitialTransactionTrayState(), {
			action: 'deploy',
			source: 'deployment',
			submittedDetail: 'Deployment transaction submitted.',
			submittedTitle: 'Deploying Contract',
		})
		const prepared = markTransactionPrepared(requested, {
			account: undefined,
			args: undefined,
			chainName: 'Ethereum',
			data: '0x1234',
			functionName: 'Broadcast deterministic proxy deployer transaction',
			requiresWalletConfirmation: false,
			value: undefined,
		})

		expect(prepared.active?.detail).toBe('Review the prepared transaction before it is submitted.')
		expect(prepared.active?.rows?.some(row => row.label === 'Calldata' && row.value === '0x1234')).toBe(true)
	})

	test('turns a requested transaction into a dismissible failure when submission fails', () => {
		const requested = markTransactionRequested(createInitialTransactionTrayState(), {
			action: 'createMarket',
			source: 'zoltar',
			submittedDetail: 'Question creation transaction submitted.',
			submittedTitle: 'Creating Question',
		})
		const failed = markTransactionFailed(requested, 'Action canceled in wallet.')

		expect(failed.active?.tone).toBe('error')
		expect(failed.active?.title).toBe('Creating Question')
		expect(failed.active?.detail).toBe('Action canceled in wallet.')
		expect(failed.active?.hash).toBeUndefined()
		expect(failed.active?.dismissKey).toBe('transaction-request-1')
		expect(failed.pendingIntent).toBeUndefined()
	})

	test('turns a submitted pending transaction into a failed transaction while preserving the hash', () => {
		const requested = markTransactionRequested(createInitialTransactionTrayState(), {
			action: 'createMarket',
			source: 'zoltar',
			submittedDetail: 'Question creation transaction submitted.',
			submittedTitle: 'Creating Question',
		})
		const submitted = markTransactionSubmitted(requested, transactionHash)
		const failed = markTransactionFailed(submitted, 'Transaction reverted')

		expect(failed.active?.tone).toBe('error')
		expect(failed.active?.title).toBe('Creating Question')
		expect(failed.active?.detail).toBe('Transaction reverted')
		expect(failed.active?.hash).toBe(transactionHash)
		expect(failed.active?.dismissKey).toBe(transactionHash)
	})
})
