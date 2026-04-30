/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { formatRefreshErrorMessage, formatWriteErrorMessage, getErrorMessage, isCloseableErrorMessage } from '../lib/errors.js'

void describe('error helpers', () => {
	void test('marks user-rejected wallet errors as closeable', () => {
		expect(getErrorMessage(new Error('User rejected the request.'), 'Couldn’t deploy SecurityPoolUtils.')).toBe('Action canceled in wallet.')
		expect(isCloseableErrorMessage(getErrorMessage(new Error('User rejected the request.'), 'Couldn’t deploy SecurityPoolUtils.'))).toBe(true)
		expect(isCloseableErrorMessage('Wallet connection failed: User denied account authorization')).toBe(true)
	})

	void test('recognizes serialized EIP-1193 rejection codes', () => {
		expect(isCloseableErrorMessage('Failed to deploy SecurityPoolUtils: {"code":4001,"message":"Request rejected"}')).toBe(true)
	})

	void test('appends sanitized technical details to load failures', () => {
		expect(getErrorMessage(new Error('execution reverted: bad stuff'), 'Couldn’t refresh pools.')).toBe('Couldn’t refresh pools. Reason: bad stuff')
	})

	void test('falls through nested error details when wrapper messages are useless', () => {
		expect(getErrorMessage({ cause: { shortMessage: 'RPC unavailable' }, message: 'execution reverted' }, 'Failed to refresh wallet state')).toBe('Failed to refresh wallet state. Reason: RPC unavailable')
	})

	void test('formats write failures with transaction-oriented wording', () => {
		expect(formatWriteErrorMessage(new Error('execution reverted: insufficient funds for gas * price + value'), 'Failed to report on outcome')).toBe('Transaction failed while attempting to report on outcome. Reason: insufficient funds for gas * price + value')
		expect(formatWriteErrorMessage(new Error('No market found for that ID'), 'Failed to create security pool')).toBe('No market found for that ID')
	})

	void test('formats refresh failures with appended reasons', () => {
		expect(formatRefreshErrorMessage(new Error('RPC unavailable'), 'Reporting transaction succeeded, but refreshing reporting details failed')).toBe('Reporting transaction succeeded, but refreshing reporting details failed. Reason: RPC unavailable')
	})

	void test('keeps blocking guidance errors non-closeable', () => {
		expect(isCloseableErrorMessage('Augur PLACEHOLDER contracts are not deployed yet. Deploy them before the application works.')).toBe(false)
		expect(isCloseableErrorMessage('Deploy SecurityPoolUtils first')).toBe(false)
	})
})
