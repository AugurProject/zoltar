/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { RpcError } from '@zoltar/core-shared/evm/ethereum'
import { formatRefreshErrorMessage, formatWriteErrorMessage, getErrorMessage, isCloseableErrorMessage, isRecoverableContractReadError } from '../lib/errors.js'

void describe('error helpers', () => {
	void test('drops library diagnostic trailers from revert details', () => {
		const tevmRevert = new Error('revert Docs: https://tevm.sh/reference/tevm/errors/classes/reverterror/ Details: {"error":"revert","errorType":"EVMError"} Version: 1.0.0-next.148')
		expect(formatWriteErrorMessage(tevmRevert, 'Failed to deposit REP')).toBe('Transaction failed while attempting to deposit REP.')
		const nonceError = new Error('Transaction creation failed. Details: the tx doesn’t have the correct nonce. account has nonce of: 24 tx has nonce of: 25 Version: 1.0.0-next.148')
		expect(formatWriteErrorMessage(nonceError, 'Failed to deposit REP')).toBe('Transaction failed while attempting to deposit REP. Reason: Transaction creation failed')
	})

	void test('marks user-rejected wallet errors as closeable', () => {
		expect(getErrorMessage(new Error('User rejected the request.'), 'Couldn’t deploy SecurityPoolUtils.')).toBe('Action canceled in wallet.')
		expect(isCloseableErrorMessage(getErrorMessage(new Error('User rejected the request.'), 'Couldn’t deploy SecurityPoolUtils.'))).toBe(true)
		expect(isCloseableErrorMessage('Wallet connection failed: User denied account authorization')).toBe(true)
	})

	void test('recognizes serialized EIP-1193 rejection codes', () => {
		expect(isCloseableErrorMessage('Failed to deploy SecurityPoolUtils: {"code":4001,"message":"Request rejected"}')).toBe(true)
	})

	void test('recognizes structured wallet rejection codes through causes without relying on message text', () => {
		for (const error of [{ code: 4001, message: 'Request declined' }, Object.assign(new Error('Request declined'), { code: '4001' }), new Error('Provider failed', { cause: { code: 4001 } })]) {
			expect(getErrorMessage(error, 'Connection failed')).toBe('Action canceled in wallet.')
			expect(formatWriteErrorMessage(error, 'Failed to submit')).toBe('Action canceled in wallet.')
			expect(formatRefreshErrorMessage(error, 'Refresh failed')).toBe('Action canceled in wallet.')
		}
		const cycle = new Error('RPC unavailable')
		cycle.cause = cycle
		expect(getErrorMessage(cycle, 'Refresh failed')).toContain('RPC unavailable')
	})

	void test('appends sanitized technical details to load failures', () => {
		expect(getErrorMessage(new Error('execution reverted: bad stuff'), 'Couldn’t refresh pools.')).toBe('Couldn’t refresh pools. Reason: bad stuff')
	})

	void test('rewrites no-data contract read failures with recovery guidance', () => {
		expect(getErrorMessage(new Error('The contract function "nextReportId" returned no data ("0x").'), 'Failed to load oracle reports')).toBe('Failed to load oracle reports. Reason: No contract data was returned. Check that the selected network or simulation scenario has deployed contracts, then refresh.')
	})

	void test('falls through nested error details when wrapper messages are useless', () => {
		expect(getErrorMessage({ cause: { shortMessage: 'RPC unavailable' }, message: 'execution reverted' }, 'Failed to refresh wallet state')).toBe('Failed to refresh wallet state. Reason: RPC unavailable')
	})

	void test('preserves diagnosed transaction failures across dialog and notification formatters', () => {
		for (const message of [
			'Transaction failed after using its full gas limit. Open the transaction details before retrying.',
			'Transaction canceled or replaced.',
			'Could not confirm the transaction. Check its status before retrying.',
			'Approval confirmed, but it is below the report requirement. Review funding again to approve the required total before continuing.',
		]) {
			for (const error of [new Error(message), new Error('Provider failed', { cause: new Error(message) })]) {
				expect(getErrorMessage(error, 'Transaction failed.')).toBe(message)
				expect(formatWriteErrorMessage(error, 'Failed to request price')).toBe(message)
			}
		}
	})

	void test('formats write failures with transaction-oriented wording', () => {
		expect(formatWriteErrorMessage(new Error('execution reverted: insufficient funds for gas * price + value'), 'Failed to report on outcome')).toBe('Transaction failed while attempting to report on outcome. Reason: insufficient funds for gas * price + value')
		expect(formatWriteErrorMessage(new Error('No market found for that ID'), 'Failed to create security pool')).toBe('No market found for that ID')
	})

	void test('maps stale-price provider failures to an actionable recovery step', () => {
		const error = {
			message: 'An unknown RPC error occurred. Details: execution reverted: Stale price Version: viem@2.53.1',
			shortMessage: 'An unknown RPC error occurred.',
		}
		expect(formatWriteErrorMessage(error, 'Failed to report on outcome')).toBe("The pool's oracle price expired. Request a new price in price oracle, then retry.")
	})

	void test('formats refresh failures with appended reasons', () => {
		expect(formatRefreshErrorMessage(new Error('RPC unavailable'), 'Reporting transaction succeeded, but refreshing reporting details failed')).toBe('Reporting transaction succeeded, but refreshing reporting details failed. Reason: RPC unavailable')
	})

	void test('classifies compatibility-layer RPC failures as recoverable contract reads', () => {
		expect(isRecoverableContractReadError(new RpcError('HTTP 522 while calling eth_call'))).toBe(true)
	})

	void test('keeps blocking guidance errors non-closeable', () => {
		expect(isCloseableErrorMessage('Augur Statoblast contracts are not deployed yet. Deploy them before the application works.')).toBe(false)
		expect(isCloseableErrorMessage('Deploy SecurityPoolUtils first')).toBe(false)
	})
})
