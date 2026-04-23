/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getErrorMessage, isCloseableErrorMessage } from '../lib/errors.js'

void describe('error helpers', () => {
	void test('marks user-rejected wallet errors as closeable', () => {
		expect(getErrorMessage(new Error('User rejected the request.'), 'Couldn’t deploy SecurityPoolUtils.')).toBe('Action canceled in wallet.')
		expect(isCloseableErrorMessage(getErrorMessage(new Error('User rejected the request.'), 'Couldn’t deploy SecurityPoolUtils.'))).toBe(true)
		expect(isCloseableErrorMessage('Wallet connection failed: User denied account authorization')).toBe(true)
	})

	void test('recognizes serialized EIP-1193 rejection codes', () => {
		expect(isCloseableErrorMessage('Failed to deploy SecurityPoolUtils: {"code":4001,"message":"Request rejected"}')).toBe(true)
	})

	void test('hides raw technical details for unknown failures', () => {
		expect(getErrorMessage(new Error('execution reverted: bad stuff'), 'Couldn’t refresh pools.')).toBe('Couldn’t refresh pools.')
	})

	void test('keeps blocking guidance errors non-closeable', () => {
		expect(isCloseableErrorMessage('Augur PLACEHOLDER contracts are not deployed yet. Deploy them before the application works.')).toBe(false)
		expect(isCloseableErrorMessage('Deploy SecurityPoolUtils first')).toBe(false)
	})
})
