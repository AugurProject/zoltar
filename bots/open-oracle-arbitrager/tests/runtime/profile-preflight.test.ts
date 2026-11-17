import { expect, test } from 'bun:test'
import { runThenReleaseLocks } from '../../src/runtime/profile-preflight.ts'

function recordingLock(name: string, released: string[], releaseError?: Error) {
	return {
		release: async () => {
			released.push(name)
			if (releaseError !== undefined) throw releaseError
		},
	}
}

test('a successful preflight releases every lock it acquired', async () => {
	const released: string[] = []
	await runThenReleaseLocks(
		async () => undefined,
		() => [recordingLock('signer', released), undefined, recordingLock('journal', released)],
	)
	expect(released).toEqual(['signer', 'journal'])
})

test('a failed preflight releases its locks and then reports the original failure', async () => {
	const released: string[] = []
	const failure = new Error('Execution requires an active signer')
	let held: ReturnType<typeof recordingLock> | undefined
	const run = runThenReleaseLocks(
		async () => {
			held = recordingLock('journal', released)
			throw failure
		},
		() => [held],
	)
	await expect(run).rejects.toBe(failure)
	expect(released).toEqual(['journal'])
})

test('a release failure takes precedence, still releases the other locks, and carries the preflight failure as its cause', async () => {
	const released: string[] = []
	const failure = new Error('position journal is corrupt')
	const releaseFailure = new Error('unlink failed')
	const run = runThenReleaseLocks(
		async () => {
			throw failure
		},
		() => [recordingLock('signer', released, releaseFailure), recordingLock('journal', released)],
	)
	const error = await run.then(
		() => undefined,
		(reason: unknown) => reason,
	)
	if (!(error instanceof AggregateError)) throw new Error('Expected an AggregateError')
	expect(error.message).toBe('Failed to release target chain profile preflight locks')
	expect(error.errors).toEqual([releaseFailure])
	expect(error.cause).toBe(failure)
	expect(released).toEqual(['signer', 'journal'])
})

test('a release failure after a successful preflight has no cause', async () => {
	const releaseFailure = new Error('unlink failed')
	const error = await runThenReleaseLocks(
		async () => undefined,
		() => [recordingLock('journal', [], releaseFailure)],
	).then(
		() => undefined,
		(reason: unknown) => reason,
	)
	if (!(error instanceof AggregateError)) throw new Error('Expected an AggregateError')
	expect(error.errors).toEqual([releaseFailure])
	expect(error.cause).toBeUndefined()
})
