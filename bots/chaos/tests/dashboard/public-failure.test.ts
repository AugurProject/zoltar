import { expect, spyOn, test } from 'bun:test'
import { ExecutionSignerLockHeldError, signerLockConflictMessage } from '@zoltar/bot-shared/execution/process-lock'
import { publicFailure } from '../../src/dashboard/public-failure.ts'
import { SignerOperationBusy } from '../../src/runtime/configuration-commit.ts'

test('signer contention returns recovery copy while raw ownership metadata stays in the protected log', async () => {
	const logged = spyOn(console, 'error').mockImplementation(() => undefined)
	try {
		const error = new ExecutionSignerLockHeldError('Signer', '{"bot":"liquidator","secret":"private-value"}', '/protected/signer.lock')
		const response = publicFailure('mutation:/api/configuration', error)
		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({ error: signerLockConflictMessage(error) })
		expect(logged).toHaveBeenCalled()
	} finally {
		logged.mockRestore()
	}
})

test('a busy signer returns 423 with the pause-specific or no-change message', async () => {
	const logged = spyOn(console, 'error').mockImplementation(() => undefined)
	try {
		const pausing = publicFailure('mutation:/api/paused', new SignerOperationBusy())
		expect(pausing.status).toBe(423)
		expect(await pausing.json()).toEqual({ error: 'The operator is completing a transaction boundary. A requested pause is active in memory; retry to persist the change.' })
		const configuring = publicFailure('mutation:/api/configuration', new SignerOperationBusy())
		expect(configuring.status).toBe(423)
		expect(await configuring.json()).toEqual({ error: 'The operator is completing a transaction boundary. No configuration change was applied; retry shortly.' })
	} finally {
		logged.mockRestore()
	}
})
