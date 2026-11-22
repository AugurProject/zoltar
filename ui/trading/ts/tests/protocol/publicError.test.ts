import { expect, test } from 'bun:test'
import { publicErrorMessage } from '../../protocol/publicError.js'

test('classifies wallet cancellation before filtering technical provider detail', () => {
	for (const error of [{ code: 4001, message: 'Request declined' }, Object.assign(new Error('call args: private payload'), { code: 4001 }), new Error('Provider failed', { cause: { code: '4001' } })]) {
		expect(publicErrorMessage(error, 'Transaction failed')).toBe('Canceled in wallet.')
	}
	expect(publicErrorMessage(new Error('RPC unavailable'), 'Transaction failed')).toBe('RPC unavailable.')
	expect(publicErrorMessage(new Error('call args: private payload'), 'Transaction failed')).toBe('Transaction failed.')
	// Every result is a closed sentence, and a fallback that already ends one is not closed twice.
	expect(publicErrorMessage(new Error('call args: private payload'), 'Transaction failed.')).toBe('Transaction failed.')
	expect(publicErrorMessage('not an error', 'Transaction failed')).toBe('Transaction failed.')
})

test('#1495: ShareToken contract reverts retain their actionable explanation', () => {
	expect(publicErrorMessage(new Error('ShareToken universe has not forked'), 'Migration failed')).toBe('ShareToken universe has not forked.')
})
