import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import { privateKeyToAccount } from '../support/bot-shared.ts'
import { acquireChaosProcessLocks, ChaosProcessLockAcquisitionError } from '../../src/core/process-locks.ts'

const directories: string[] = []
const releases: Array<() => Promise<void>> = []

afterEach(async () => {
	for (const release of releases.splice(0).reverse()) await release()
	await Promise.all(directories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

async function stateFile(name: string) {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-chaos-lock-'))
	directories.push(directory)
	return join(directory, name)
}

describe('chaos-bot process locks', () => {
	test('allows only one process to own a durable state journal', async () => {
		const state = await stateFile('state.json')
		const first = await acquireChaosProcessLocks({ chainId: 1, execute: false, privateKey: undefined, stateFile: state })
		releases.push(first.release)
		await expect(acquireChaosProcessLocks({ chainId: 1, execute: false, privateKey: undefined, stateFile: state })).rejects.toThrow('already locked')
	})

	test('uses the shared global chain-and-signer lock across separate journals', async () => {
		const privateKey = `0x${'33'.repeat(32)}` as const
		const firstState = await stateFile('first.json')
		const secondState = await stateFile('second.json')
		const first = await acquireChaosProcessLocks({ chainId: 1, execute: true, privateKey, stateFile: firstState })
		releases.push(first.release)
		await expect(acquireChaosProcessLocks({ chainId: 1, execute: true, privateKey, stateFile: secondState })).rejects.toThrow('already locked')
		const stateWasReleased = await acquireChaosProcessLocks({ chainId: 1, execute: false, privateKey: undefined, stateFile: secondState })
		releases.push(stateWasReleased.release)
	})

	test('uses a configured durable lock root to coordinate one signer across instances', async () => {
		const privateKey = `0x${'66'.repeat(32)}` as const
		const lockRoot = join(await mkdtemp(join(tmpdir(), 'zoltar-chaos-signer-lock-')), 'locks')
		directories.push(lockRoot.slice(0, -'/locks'.length))
		const first = await acquireChaosProcessLocks({ chainId: 11_155_111, execute: true, privateKey, signerLockRoot: lockRoot, stateFile: await stateFile('durable-first.json') })
		releases.push(first.release)
		await expect(acquireChaosProcessLocks({ chainId: 11_155_111, execute: true, privateKey, signerLockRoot: lockRoot, stateFile: await stateFile('durable-second.json') })).rejects.toThrow('already locked')
	})

	test('acquires global signer exclusivity when a dry-run process transitions to live execution', async () => {
		const privateKey = `0x${'55'.repeat(32)}` as const
		const address = privateKeyToAccount(privateKey).address
		const first = await acquireChaosProcessLocks({ chainId: 1, execute: false, privateKey, stateFile: await stateFile('dry-run.json') })
		releases.push(first.release)
		const liveSignerLock = await first.acquireSigner(address)
		await first.commitSigner(address, liveSignerLock)
		const competitor = await acquireChaosProcessLocks({ chainId: 1, execute: false, privateKey, stateFile: await stateFile('competitor.json') })
		releases.push(competitor.release)
		await expect(competitor.acquireSigner(address)).rejects.toThrow('already locked')
	})

	test('retains a failed partial-cleanup handle for an explicit retry', async () => {
		let releasesAttempted = 0
		let failure: unknown
		try {
			await acquireChaosProcessLocks(
				{ chainId: 1, execute: true, privateKey: `0x${'44'.repeat(32)}`, stateFile: 'state.json' },
				{
					acquireSigner: async () => {
						throw new Error('signer already locked')
					},
					acquireState: async () => ({
						path: 'state.lock',
						release: async () => {
							releasesAttempted += 1
							if (releasesAttempted === 1) throw new Error('transient cleanup failure')
						},
					}),
				},
			)
		} catch (error) {
			failure = error
		}
		expect(failure).toBeInstanceOf(ChaosProcessLockAcquisitionError)
		if (!(failure instanceof ChaosProcessLockAcquisitionError)) throw new Error('Expected a retained process-lock cleanup failure')
		await failure.releaseProcessLocks()
		expect(releasesAttempted).toBe(2)
	})
})
