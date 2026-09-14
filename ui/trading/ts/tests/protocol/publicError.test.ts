import { expect, test } from 'bun:test'
import { publicErrorMessage } from '../../protocol/publicError.js'

test('classifies wallet cancellation before filtering technical provider detail', () => {
	for (const error of [{ code: 4001, message: 'Request declined' }, Object.assign(new Error('call args: private payload'), { code: 4001 }), new Error('Provider failed', { cause: { code: '4001' } })]) {
		expect(publicErrorMessage(error, 'Transaction failed')).toBe('Action canceled in wallet.')
	}
	expect(publicErrorMessage(new Error('RPC unavailable'), 'Transaction failed')).toBe('RPC unavailable')
	expect(publicErrorMessage(new Error('call args: private payload'), 'Transaction failed')).toBe('Transaction failed')
})
