/// <reference types='bun-types' />

import { describe, expect, test } from 'bun:test'
import {
	createTransactionFailure,
	createTransactionFailureError,
	getTransactionFailureKind,
	getTransactionLifecycleHash,
	isTransactionAwaitingUser,
	isTransactionSettled,
	startTransactionLifecycle,
	transitionTransactionLifecycle,
	type TransactionLifecycle,
	type TransactionLifecycleEvent,
} from '../transactions/transactionLifecycle.js'

const hash = '0x1111000000000000000000000000000000000000000000000000000000000000'
const replacementHash = '0x2222000000000000000000000000000000000000000000000000000000000000'

function run(start: TransactionLifecycle, events: readonly TransactionLifecycleEvent[]) {
	return events.reduce(transitionTransactionLifecycle, start)
}

describe('transaction lifecycle', () => {
	test('moves through review, wallet, pending, and confirmed', () => {
		const review = startTransactionLifecycle(true)
		const wallet = transitionTransactionLifecycle(review, { type: 'review-confirmed' })
		const pending = transitionTransactionLifecycle(wallet, { type: 'submitted', hash })
		const confirmed = transitionTransactionLifecycle(pending, { type: 'receipt', hash, status: 'success' })

		expect(review).toEqual({ phase: 'review' })
		expect(wallet).toEqual({ phase: 'wallet' })
		expect(pending).toEqual({ phase: 'pending', hash })
		expect(confirmed).toEqual({ phase: 'confirmed', hash })
		expect([review, wallet, pending, confirmed].map(isTransactionAwaitingUser)).toEqual([true, true, false, false])
		expect([review, wallet, pending, confirmed].map(isTransactionSettled)).toEqual([false, false, false, true])
		expect(getTransactionLifecycleHash(confirmed)).toBe(hash)
	})

	test('starts at the wallet prompt when the app has no review', () => {
		expect(startTransactionLifecycle(false)).toEqual({ phase: 'wallet' })
	})

	test('types a reverted receipt instead of carrying a message to compare', () => {
		const failed = run({ phase: 'wallet' }, [
			{ type: 'submitted', hash },
			{ type: 'receipt', hash, status: 'reverted' },
		])

		expect(failed).toEqual({ phase: 'failed', failure: { kind: 'reverted', message: 'Transaction reverted.' }, hash })
	})

	test('follows a replacement hash and ignores receipts for other hashes', () => {
		const pending = run({ phase: 'wallet' }, [
			{ type: 'submitted', hash },
			{ type: 'submitted', hash: replacementHash },
			{ type: 'receipt', hash, status: 'success' },
		])

		expect(pending).toEqual({ phase: 'pending', hash: replacementHash })
	})

	test('keeps the broadcast hash on a failure and refines the message without changing its cause', () => {
		const failed = run({ phase: 'wallet' }, [
			{ type: 'submitted', hash },
			{ type: 'receipt', hash, status: 'reverted' },
			{ type: 'failed', failure: { kind: 'error', message: 'Transaction used its full gas limit.' } },
		])

		expect(failed).toEqual({ phase: 'failed', failure: { kind: 'reverted', message: 'Transaction used its full gas limit.' }, hash })
	})

	test('fails before broadcast without a hash and never un-confirms a transaction', () => {
		const rejected = transitionTransactionLifecycle({ phase: 'wallet' }, { type: 'failed', failure: { kind: 'rejected', message: 'Action canceled in wallet.' } })
		const confirmed: TransactionLifecycle = { phase: 'confirmed', hash }

		expect(rejected).toEqual({ phase: 'failed', failure: { kind: 'rejected', message: 'Action canceled in wallet.' }, hash: undefined })
		expect(transitionTransactionLifecycle(confirmed, { type: 'failed', failure: { kind: 'error', message: 'late' } })).toBe(confirmed)
	})

	test('leaves the state unchanged for events that do not apply', () => {
		const review: TransactionLifecycle = { phase: 'review' }
		const pending: TransactionLifecycle = { phase: 'pending', hash }

		expect(transitionTransactionLifecycle(review, { type: 'submitted', hash })).toBe(review)
		expect(transitionTransactionLifecycle(review, { type: 'receipt', hash, status: 'success' })).toBe(review)
		expect(transitionTransactionLifecycle(pending, { type: 'review-confirmed' })).toBe(pending)
	})

	test('classifies failures from typed errors and wallet rejections', () => {
		expect(getTransactionFailureKind(createTransactionFailureError('reverted', 'Transaction reverted'))).toBe('reverted')
		expect(getTransactionFailureKind(new Error('outer', { cause: createTransactionFailureError('replaced', 'Replaced') }))).toBe('replaced')
		expect(getTransactionFailureKind({ code: 4001, message: 'User rejected the request.' })).toBe('rejected')
		// A message that merely mentions a revert is not classified by its wording.
		expect(getTransactionFailureKind(new Error('Transaction reverted.'))).toBe('error')
		expect(createTransactionFailure({ code: 4001 }, 'Action canceled in wallet.')).toEqual({ kind: 'rejected', message: 'Action canceled in wallet.' })
	})
})
