/// <reference types='bun-types' />

import { afterEach, describe, expect, test } from 'bun:test'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '../lib/activeEnvironment.js'
import { createInitialTransactionTrayState, getTransactionActionLockReason, markTransactionCanceled, markTransactionFailed, markTransactionFinished, markTransactionPrepared, markTransactionPresented, markTransactionRequested, markTransactionSubmitted, TRANSACTION_ACTION_LOCK_REASON } from '../lib/transactionTray.js'
import { createFakeBackend, createFakeSimulationProfile } from './testUtils/fakeBackend.js'

const transactionHash = '0x1234000000000000000000000000000000000000000000000000000000000000'

describe('transactionTray', () => {
	afterEach(() => {
		resetActiveEnvironmentForTesting()
	})

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
		expect(submitted.pendingIntent?.submittedTitle).toBe('Creating Question')
		expect(presented.active?.tone).toBe('success')
		expect(presented.active?.title).toBe('Question Created')
		expect(finished.inFlightCount).toBe(0)
		expect(finished.pendingIntent).toBeUndefined()
	})

	test('keeps transaction actions locked until the current transaction finishes', () => {
		const requested = markTransactionRequested(createInitialTransactionTrayState(), {
			action: 'createMarket',
			source: 'zoltar',
			submittedDetail: 'Question creation transaction submitted.',
			submittedTitle: 'Creating Question',
		})
		const submitted = markTransactionSubmitted(requested, transactionHash)
		const finished = markTransactionFinished(submitted)

		expect(getTransactionActionLockReason(requested)).toBe(TRANSACTION_ACTION_LOCK_REASON)
		expect(requested.inFlightCount).toBe(1)
		expect(requested.pendingIntent).toBeDefined()
		expect(getTransactionActionLockReason(submitted)).toBe(TRANSACTION_ACTION_LOCK_REASON)
		expect(submitted.inFlightCount).toBe(1)
		expect(submitted.pendingIntent).toBeDefined()
		expect(getTransactionActionLockReason(finished)).toBeUndefined()
		expect(finished.inFlightCount).toBe(0)
		expect(finished.pendingIntent).toBeUndefined()
	})

	test('does not underflow the in-flight count', () => {
		const finished = markTransactionFinished(createInitialTransactionTrayState())

		expect(finished.inFlightCount).toBe(0)
	})

	test('ignores submitted hashes when no pending intent exists', () => {
		const submitted = markTransactionSubmitted(createInitialTransactionTrayState(), transactionHash)

		expect(submitted.active).toBeUndefined()
	})

	test('updates the pending hash when a submitted transaction is repriced', () => {
		const replacementHash = '0x5678000000000000000000000000000000000000000000000000000000000000'
		const requested = markTransactionRequested(createInitialTransactionTrayState(), {
			action: 'createMarket',
			source: 'zoltar',
			submittedDetail: 'Question creation transaction submitted.',
			submittedTitle: 'Creating Question',
		})
		const submitted = markTransactionSubmitted(requested, transactionHash)
		const replaced = markTransactionSubmitted(submitted, replacementHash)

		expect(replaced.active?.tone).toBe('pending')
		expect(replaced.active?.hash).toBe(replacementHash)
		expect(replaced.active?.dismissKey).toBe(replacementHash)
		expect(replaced.active?.title).toBe('Creating Question')
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
			args: [1n, { title: 'Will this resolve?' }, ['yes', 'no']],
			chainName: 'Ethereum',
			contractAddress: '0x00000000000000000000000000000000000000b2',
			functionName: 'createQuestion',
			value: 0n,
		})
		const submitted = markTransactionSubmitted(prepared, transactionHash)
		const presented = markTransactionPresented(submitted, {
			dismissKey: transactionHash,
			hash: transactionHash,
			rows: [{ label: 'Question ID', value: '0x01' }],
			title: 'Question Created',
			tone: 'success',
		})

		expect(prepared.active?.tone).toBe('awaiting-wallet')
		expect(prepared.active?.detail).toBe('Review the prepared transaction, then confirm it in your wallet.')
		expect(prepared.active?.rows).toBeUndefined()
		expect(prepared.active?.technicalRows?.some(row => row.label === 'Function' && row.value === 'createQuestion')).toBe(true)
		expect(prepared.active?.technicalRows?.some(row => row.label === 'Arguments' && row.value === '1, {title: Will this resolve?}, [yes, no]')).toBe(true)
		expect(prepared.active?.technicalRows?.some(row => row.label === 'Sender')).toBe(false)
		expect(prepared.active?.technicalRows?.some(row => row.label === 'Chain')).toBe(false)
		expect(prepared.active?.technicalRows?.some(row => String(row.value).includes('[object Object]'))).toBe(false)
		expect(submitted.active?.technicalRows?.some(row => row.label === 'Contract' && row.value === '0x00000000000000000000000000000000000000b2')).toBe(true)
		expect(presented.active?.rows).toEqual([{ label: 'Question ID', value: '0x01' }])
		expect(presented.active?.technicalRows?.some(row => row.label === 'Function' && row.value === 'createQuestion')).toBe(true)
	})

	test('updates technical details for every transaction in a multi-write operation', () => {
		const approvalHash = '0xaaaa000000000000000000000000000000000000000000000000000000000000'
		const requestHash = '0xbbbb000000000000000000000000000000000000000000000000000000000000'
		const requested = markTransactionRequested(createInitialTransactionTrayState(), {
			action: 'requestPrice',
			rows: [{ label: 'Pool', value: '0x0000000000000000000000000000000000000001' }],
			source: 'pool-oracle',
			submittedTitle: 'Requesting New Price',
		})
		const approvalPrepared = markTransactionPrepared(requested, {
			account: '0x0000000000000000000000000000000000000002',
			args: ['0x0000000000000000000000000000000000000003', 10n],
			chainName: 'Ethereum',
			contractAddress: '0x0000000000000000000000000000000000000004',
			functionName: 'approve',
			value: 0n,
		})
		const approvalSubmitted = markTransactionSubmitted(approvalPrepared, approvalHash)
		const requestPrepared = markTransactionPrepared(approvalSubmitted, {
			account: '0x0000000000000000000000000000000000000002',
			args: [3n, 4n],
			chainName: 'Ethereum',
			contractAddress: '0x0000000000000000000000000000000000000001',
			functionName: 'requestPrice',
			value: 5n,
		})
		const requestSubmitted = markTransactionSubmitted(requestPrepared, requestHash)
		const requestFailed = markTransactionFailed(requestSubmitted, 'Transaction reverted')
		const requestSucceeded = markTransactionPresented(requestSubmitted, {
			dismissKey: requestHash,
			hash: requestHash,
			rows: [{ label: 'Pool', value: '0x0000000000000000000000000000000000000001' }],
			title: 'Price Request Submitted',
			tone: 'success',
		})
		const finished = markTransactionFinished(requestSucceeded)

		expect(approvalSubmitted.active?.hash).toBe(approvalHash)
		expect(approvalSubmitted.active?.technicalRows?.some(row => row.label === 'Function' && row.value === 'approve')).toBe(true)
		expect(requestPrepared.active?.hash).toBeUndefined()
		expect(requestPrepared.active?.technicalRows?.some(row => row.label === 'Function' && row.value === 'requestPrice')).toBe(true)
		for (const state of [requestPrepared, requestSubmitted, requestFailed, requestSucceeded]) {
			expect(state.active?.rows?.map(row => row.label)).toContain('Pool')
			expect(state.active?.technicalRows?.some(row => row.label === 'Function' && row.value === 'requestPrice')).toBe(true)
			expect(state.active?.technicalRows?.some(row => row.label === 'Function' && row.value === 'approve')).toBe(false)
		}
		expect(requestSubmitted.active?.hash).toBe(requestHash)
		expect(requestFailed.active?.hash).toBe(requestHash)
		expect(requestSucceeded.active?.hash).toBe(requestHash)
		expect(finished.pendingIntent).toBeUndefined()
		expect(finished.pendingRequestKey).toBeUndefined()
	})

	test('formats self-referential arrays and mixed object-array cycles safely', () => {
		const selfReferentialArray: unknown[] = []
		selfReferentialArray.push(selfReferentialArray)
		const mixedCycle: { values?: unknown[] } = {}
		mixedCycle.values = [mixedCycle]
		const requested = markTransactionRequested(createInitialTransactionTrayState(), {
			action: 'createMarket',
			source: 'zoltar',
			submittedDetail: 'Question creation transaction submitted.',
			submittedTitle: 'Creating Question',
		})

		const prepared = markTransactionPrepared(requested, {
			account: '0x00000000000000000000000000000000000000a1',
			args: [selfReferentialArray, mixedCycle],
			chainName: 'Ethereum',
			contractAddress: '0x00000000000000000000000000000000000000b2',
			functionName: 'createQuestion',
			value: 0n,
		})

		expect(prepared.active?.technicalRows?.some(row => row.label === 'Arguments' && row.value === '[[circular value]], {values: [[circular value]]}')).toBe(true)
	})

	test('uses non-wallet prepared copy for raw broadcasts', () => {
		const requested = markTransactionRequested(createInitialTransactionTrayState(), {
			action: 'deploy',
			source: 'deployment',
			submittedDetail: 'Deployment transaction submitted.',
			submittedTitle: 'Deploying Contract',
		})
		const prepared = markTransactionPrepared(requested, {
			account: '0x00000000000000000000000000000000000000c3',
			args: undefined,
			chainName: 'Ethereum',
			data: '0x1234',
			dataLabel: 'Raw transaction',
			functionName: 'Broadcast deterministic proxy deployer transaction',
			requiresWalletConfirmation: false,
			to: '0x00000000000000000000000000000000000000d4',
			toLabel: 'Proxy deployer',
			value: undefined,
		})

		expect(prepared.active?.tone).toBe('preparing')
		expect(prepared.active?.detail).toBe('Review the prepared transaction before it is submitted.')
		expect(prepared.active?.technicalRows?.some(row => row.label === 'Sender')).toBe(false)
		expect(prepared.active?.technicalRows?.some(row => row.label === 'Chain')).toBe(false)
		expect(prepared.active?.technicalRows?.some(row => row.label === 'Raw transaction')).toBe(false)
		expect(prepared.active?.technicalRows?.some(row => row.label === 'To' && row.value === 'Proxy deployer (0x00000000000000000000000000000000000000d4)')).toBe(true)
	})

	test('uses preparing copy for requested simulation transactions', () => {
		const requested = markTransactionRequested(createInitialTransactionTrayState(), {
			action: 'createMarket',
			requiresWalletConfirmation: false,
			source: 'zoltar',
			submittedDetail: 'Question creation transaction submitted.',
			submittedTitle: 'Creating Question',
		})

		expect(requested.active?.tone).toBe('preparing')
		expect(requested.active?.detail).toBe('Submitting in browser simulation. No wallet confirmation is required.')
		expect(requested.pendingIntent?.requiresWalletConfirmation).toBe(false)
	})

	test('applies active simulation defaults to undecorated requested transactions', () => {
		const resetEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ profile: createFakeSimulationProfile() }))
		const requested = markTransactionRequested(createInitialTransactionTrayState(), {
			action: 'createMarket',
			source: 'zoltar',
			submittedDetail: 'Question creation transaction submitted.',
			submittedTitle: 'Creating Question',
		})
		resetEnvironment()

		expect(requested.active?.tone).toBe('preparing')
		expect(requested.active?.detail).toBe('Submitting in browser simulation. No wallet confirmation is required.')
		expect(requested.pendingIntent?.requiresWalletConfirmation).toBe(false)
	})

	test('uses the defaulted pending intent when prepared previews omit wallet confirmation requirements', () => {
		const resetEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ profile: createFakeSimulationProfile() }))
		const requested = markTransactionRequested(createInitialTransactionTrayState(), {
			action: 'createMarket',
			source: 'zoltar',
			submittedDetail: 'Question creation transaction submitted.',
			submittedTitle: 'Creating Question',
		})
		resetEnvironment()

		const prepared = markTransactionPrepared(requested, {
			account: '0x00000000000000000000000000000000000000a1',
			args: [1n, ['yes', 'no']],
			chainName: 'Ethereum',
			contractAddress: '0x00000000000000000000000000000000000000b2',
			functionName: 'createQuestion',
			value: 0n,
		})

		expect(prepared.active?.tone).toBe('preparing')
		expect(prepared.active?.detail).toBe('Review the prepared transaction before it is submitted.')
		expect(prepared.active?.technicalRows?.some(row => row.label === 'Function' && row.value === 'createQuestion')).toBe(true)
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

	test('clears requested transaction state when a write is canceled before submission', () => {
		const requested = markTransactionRequested(createInitialTransactionTrayState(), {
			action: 'createMarket',
			source: 'zoltar',
			submittedDetail: 'Question creation transaction submitted.',
			submittedTitle: 'Creating Question',
		})
		const canceled = markTransactionCanceled(requested)
		const finished = markTransactionFinished(canceled)

		expect(canceled.active).toBeUndefined()
		expect(canceled.pendingIntent).toBeUndefined()
		expect(canceled.pendingRequestKey).toBeUndefined()
		expect(canceled.inFlightCount).toBe(1)
		expect(getTransactionActionLockReason(canceled)).toBe(TRANSACTION_ACTION_LOCK_REASON)
		expect(finished.inFlightCount).toBe(0)
		expect(getTransactionActionLockReason(finished)).toBeUndefined()
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
