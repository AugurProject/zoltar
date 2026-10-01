import { expect, test } from 'bun:test'
import { publicOperatorFailure, publicPollFailure } from '../src/dashboard/public-failures.ts'
import { publicDashboardError } from '../src/dashboard/public-error.ts'
import { ExecutionSignerLockHeldError, signerLockConflictMessage } from '../src/execution/process-lock.ts'

test('shows the known owner and dashboard recovery actions without exposing protected metadata', async () => {
	const error = new ExecutionSignerLockHeldError('Signer', '{"bot":"chaos-bot","secret":"private-value"}', '/protected/signer.lock')
	const message = signerLockConflictMessage(error)
	expect(message).toContain('chaos-bot')
	expect(message).toContain('Settings')
	expect(message).not.toContain('private-value')
	expect(message).not.toContain('/protected')
	expect(publicOperatorFailure(message)).toBe(message)
	expect(publicPollFailure(message)).toBe(message)
	const response = publicDashboardError('liquidator', error, 400, 'execution-update', 'Failed')
	expect(await response.json()).toEqual({ error: message })
	expect(response.status).toBe(400)
})

test('does not trust arbitrary owner names or message extensions as public dashboard copy', () => {
	const error = new ExecutionSignerLockHeldError('Signer', '{"bot":"https://secret.example/private"}', '/protected/signer.lock')
	const message = signerLockConflictMessage(error)
	expect(message).toContain('another bot')
	expect(message).not.toContain('secret.example')
	expect(publicOperatorFailure(`${message} password=private-value`)).not.toContain('private-value')
})
