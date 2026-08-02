import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acquireLiquidatorProcessLocks, LiquidatorProcessLockAcquisitionError } from '../../src/core/process-locks.ts'
import { privateKeyToAccount } from '../helpers/ethereum.ts'

const directories: string[] = []
const releases: (() => Promise<void>)[] = []

afterEach(async () => {
	for (const release of releases.splice(0).reverse()) await release()
	await Promise.all(directories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

async function stateFile(name: string) {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-liquidator-lock-'))
	directories.push(directory)
	return join(directory, name)
}

describe('liquidator process locks', () => {
	test('retains a partially acquired state lock when its first cleanup attempt fails', async () => {
		let stateReleases = 0
		const stateLock = {
			path: 'state.lock',
			release: async () => {
				stateReleases += 1
				if (stateReleases === 1) throw new Error('transient state cleanup failure')
			},
		}
		let failure: unknown
		try {
			await acquireLiquidatorProcessLocks(
				{ chainId: 1, execute: true, privateKey: `0x${'11'.repeat(32)}`, stateFile: 'state.json' },
				{
					acquireSigner: async () => {
						throw new Error('signer already locked')
					},
					acquireState: async () => stateLock,
				},
			)
		} catch (error) {
			failure = error
		}
		expect(failure).toBeInstanceOf(LiquidatorProcessLockAcquisitionError)
		if (!(failure instanceof LiquidatorProcessLockAcquisitionError)) throw new Error('Expected retained acquisition failure')
		await failure.releaseProcessLocks()
		expect(stateReleases).toBe(2)
	})

	test('reuses a provisional signer lock after its first cleanup attempt fails', async () => {
		const firstKey = `0x${'11'.repeat(32)}` as const
		const secondKey = `0x${'22'.repeat(32)}` as const
		const firstAddress = privateKeyToAccount(firstKey).address
		const secondAddress = privateKeyToAccount(secondKey).address
		let signerAcquisitions = 0
		let secondReleases = 0
		const firstLock = { path: 'first.lock', release: async () => undefined }
		const secondLock = {
			path: 'second.lock',
			release: async () => {
				secondReleases += 1
				if (secondReleases === 1) throw new Error('transient signer cleanup failure')
			},
		}
		const locks = await acquireLiquidatorProcessLocks(
			{ chainId: 1, execute: true, privateKey: firstKey, stateFile: 'state.json' },
			{
				acquireSigner: async (_chainId, address) => {
					signerAcquisitions += 1
					return address.toLowerCase() === firstAddress.toLowerCase() ? firstLock : secondLock
				},
				acquireState: async () => ({ path: 'state.lock', release: async () => undefined }),
			},
		)
		const provisional = await locks.acquireSigner(secondAddress)
		await expect(locks.discardSigner(secondAddress, provisional)).rejects.toThrow('transient signer cleanup failure')
		const reused = await locks.acquireSigner(secondAddress)
		expect(reused).toBe(secondLock)
		expect(signerAcquisitions).toBe(2)
		await locks.commitSigner(secondAddress, reused)
		await locks.release()
		expect(secondReleases).toBe(2)
	})

	test('allows only one process to own a state journal', async () => {
		const state = await stateFile('state.json')
		const first = await acquireLiquidatorProcessLocks({ chainId: 1, execute: false, privateKey: undefined, stateFile: state })
		releases.push(first.release)
		await expect(acquireLiquidatorProcessLocks({ chainId: 1, execute: false, privateKey: undefined, stateFile: state })).rejects.toThrow('already locked')
	})

	test('allows only one live bot to use a signer on a chain and releases a partially acquired state lock', async () => {
		const privateKey = `0x${'11'.repeat(32)}` as const
		const firstState = await stateFile('first.json')
		const secondState = await stateFile('second.json')
		const first = await acquireLiquidatorProcessLocks({ chainId: 1, execute: true, privateKey, stateFile: firstState })
		releases.push(first.release)
		await expect(acquireLiquidatorProcessLocks({ chainId: 1, execute: true, privateKey, stateFile: secondState })).rejects.toThrow('already locked')
		const recoveredStateLock = await acquireLiquidatorProcessLocks({ chainId: 1, execute: false, privateKey: undefined, stateFile: secondState })
		releases.push(recoveredStateLock.release)
	})

	test('transfers signer exclusivity when the active signer changes', async () => {
		const firstKey = `0x${'11'.repeat(32)}` as const
		const secondKey = `0x${'22'.repeat(32)}` as const
		const competingKey = `0x${'33'.repeat(32)}` as const
		const firstState = await stateFile('first.json')
		const competingState = await stateFile('competing.json')
		const first = await acquireLiquidatorProcessLocks({ chainId: 1, execute: true, privateKey: firstKey, stateFile: firstState })
		releases.push(first.release)
		const competing = await acquireLiquidatorProcessLocks({ chainId: 1, execute: true, privateKey: competingKey, stateFile: competingState })
		releases.push(competing.release)
		const firstAddress = privateKeyToAccount(firstKey).address
		await expect(competing.acquireSigner(firstAddress)).rejects.toThrow('already locked')
		const secondAddress = privateKeyToAccount(secondKey).address
		const nextLock = await first.acquireSigner(secondAddress)
		await first.commitSigner(secondAddress, nextLock)
		const releasedFirstSigner = await competing.acquireSigner(firstAddress)
		await releasedFirstSigner?.release()
	})
})
