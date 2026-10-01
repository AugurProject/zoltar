import { expect, test } from 'bun:test'
import { errorMessage } from './errorMessage.js'

test('errorMessage prefers Error messages and stringifies other thrown values', () => {
	expect(errorMessage(new Error('failure'))).toBe('failure')
	expect(errorMessage('plain')).toBe('plain')
	expect(errorMessage(42)).toBe('42')
})
