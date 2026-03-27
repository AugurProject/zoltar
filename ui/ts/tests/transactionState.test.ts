/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { createInitialTransactionState, markTransactionFinished, markTransactionRequested, markTransactionSubmitted } from '../lib/transactionState.js'

void describe('transaction state', () => {
	void test('tracks a single transaction through request, submission, and confirmation', () => {
		const requested = markTransactionRequested(createInitialTransactionState())
		const submitted = markTransactionSubmitted(requested, '0x1234')
		const finished = markTransactionFinished(submitted)

		expect(requested.transactionInFlightCount).toBe(1)
		expect(requested.transactionSubmitted).toBe(false)
		expect(submitted.transactionInFlightCount).toBe(1)
		expect(submitted.transactionSubmitted).toBe(true)
		expect(submitted.lastTransactionHash).toBe('0x1234')
		expect(submitted.transactionUrl).toBe('https://etherscan.io/tx/0x1234')
		expect(finished.transactionInFlightCount).toBe(0)
		expect(finished.transactionSubmitted).toBe(true)
	})

	void test('does not underflow the in-flight count', () => {
		const finished = markTransactionFinished(createInitialTransactionState())

		expect(finished.transactionInFlightCount).toBe(0)
	})
})
