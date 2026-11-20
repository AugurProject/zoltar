import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseOperatorSettings } from '#config/settings-store'
import { settlementJournalPath } from '#state/settlement-store'
import example from '../../config/operator.example.json'
import { preflightOperatorProfile, runThenReleaseLocks } from '../../src/runtime/profile-preflight.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

test('preflight rejects a target profile whose settlement journal cannot be read at startup', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-arbitrager-preflight-'))
	temporaryDirectories.push(directory)
	const parsed = parseOperatorSettings(example)
	const target = {
		...parsed,
		networkConfigured: false,
		runtime: { ...parsed.runtime, historyFile: join(directory, 'history.jsonl'), positionFile: join(directory, 'positions.json'), priceHistoryFile: join(directory, 'prices.jsonl') },
	}
	const settingsFile = join(directory, 'operator.json')
	await preflightOperatorProfile(settingsFile, target)
	await writeFile(settlementJournalPath(target.runtime.positionFile), '{"truncated":')
	await expect(preflightOperatorProfile(settingsFile, target)).rejects.toThrow()
})

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
