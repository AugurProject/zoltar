import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { privateKeyToAccount } from '../src/ethereum.ts'
import { acquireBotProcessLocks, BotProcessLockAcquisitionError, createBotShutdownController, type BotProcessLockOptions } from '../src/execution/bot-process-locks.ts'

const directories: string[] = []
const releases: (() => Promise<void>)[] = []

afterEach(async () => {
	for (const release of releases.splice(0).reverse()) await release()
	await Promise.all(directories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

async function stateFile(name: string) {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-bot-lock-'))
	directories.push(directory)
	return join(directory, name)
}

const LIVE_ONLY: BotProcessLockOptions = { label: 'liquidator', signerLocksInDryRun: false }
const ALWAYS: BotProcessLockOptions = { label: 'chaos-bot', signerLocksInDryRun: true }
const acquireLiquidatorProcessLocks = (settings: Parameters<typeof acquireBotProcessLocks>[0], acquirers?: BotProcessLockOptions['acquirers']) => acquireBotProcessLocks(settings, acquirers === undefined ? LIVE_ONLY : { ...LIVE_ONLY, acquirers })
const acquireChaosProcessLocks = (settings: Parameters<typeof acquireBotProcessLocks>[0], acquirers?: BotProcessLockOptions['acquirers']) => acquireBotProcessLocks(settings, acquirers === undefined ? ALWAYS : { ...ALWAYS, acquirers })

describe('bot process locks', () => {
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
		expect(failure).toBeInstanceOf(BotProcessLockAcquisitionError)
		if (!(failure instanceof BotProcessLockAcquisitionError)) throw new Error('Expected retained acquisition failure')
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

	test('releases state and signer locks after graceful SIGTERM shutdown and dashboard drain', async () => {
		const state = await stateFile('state.json')
		const privateKey = `0x${'44'.repeat(32)}` as const
		const moduleUrl = pathToFileURL(resolve(import.meta.dir, '../src/execution/bot-process-locks.ts')).href
		const script = `
			import { acquireBotProcessLocks, createBotShutdownController, botDashboardLifecycle } from ${JSON.stringify(moduleUrl)}
			{
				using shutdown = createBotShutdownController()
				const locks = await acquireBotProcessLocks({ chainId: 1, execute: true, privateKey: ${JSON.stringify(privateKey)}, stateFile: ${JSON.stringify(state)} }, { label: 'liquidator', signerLocksInDryRun: false })
				try {
					await using dashboardLifecycle = botDashboardLifecycle({
						stop: async () => {
							console.log('draining')
							await Bun.sleep(250)
						},
					})
					console.log('ready')
					while (!shutdown.isRequested()) await shutdown.wait(60_000)
				} finally {
					await locks.release()
				}
			}
		`
		const child = Bun.spawn([process.execPath, '--eval', script], { cwd: resolve(import.meta.dir, '..'), stderr: 'pipe', stdout: 'pipe' })
		try {
			const reader = child.stdout.getReader()
			const decoder = new TextDecoder()
			let output = ''
			const readUntil = async (target: string) => {
				while (!output.includes(target)) {
					const next = await reader.read()
					if (next.done) throw new Error(`Lock subprocess stopped before reporting ${target}: ${await new Response(child.stderr).text()}`)
					output += decoder.decode(next.value, { stream: true })
				}
			}
			await readUntil('ready')
			child.kill('SIGTERM')
			await readUntil('draining')
			await expect(acquireLiquidatorProcessLocks({ chainId: 1, execute: true, privateKey, stateFile: state })).rejects.toThrow('already locked')
			reader.releaseLock()
			expect(await child.exited).toBe(0)
		} finally {
			if (child.exitCode === null) child.kill('SIGKILL')
			await child.exited
		}
		const replacement = await acquireLiquidatorProcessLocks({ chainId: 1, execute: true, privateKey, stateFile: state })
		releases.push(replacement.release)
	})

	test('cleans up when SIGTERM arrives before asynchronous lock acquisition returns', async () => {
		const state = await stateFile('state.json')
		const privateKey = `0x${'55'.repeat(32)}` as const
		const moduleUrl = pathToFileURL(resolve(import.meta.dir, '../src/execution/bot-process-locks.ts')).href
		const script = `
			import { acquireBotProcessLocks, acquireBotProcessLocksForShutdown, createBotShutdownController } from ${JSON.stringify(moduleUrl)}
			using shutdown = createBotShutdownController()
			const options = { label: 'liquidator', signerLocksInDryRun: false }
			const settings = { chainId: 1, execute: true, privateKey: ${JSON.stringify(privateKey)}, stateFile: ${JSON.stringify(state)} }
			const locks = await acquireBotProcessLocksForShutdown(settings, options, shutdown, async (current, currentOptions) => {
				const acquired = await acquireBotProcessLocks(current, currentOptions)
				console.log('locked-before-return')
				await shutdown.wait(60_000)
				return acquired
			})
			await locks?.release()
		`
		const child = Bun.spawn([process.execPath, '--eval', script], { cwd: resolve(import.meta.dir, '..'), stderr: 'pipe', stdout: 'pipe' })
		try {
			const reader = child.stdout.getReader()
			const next = await reader.read()
			if (next.done || !new TextDecoder().decode(next.value).includes('locked-before-return')) throw new Error(`Lock subprocess stopped before acquisition pause: ${await new Response(child.stderr).text()}`)
			reader.releaseLock()
			child.kill('SIGTERM')
			expect(await child.exited).toBe(0)
		} finally {
			if (child.exitCode === null) child.kill('SIGKILL')
			await child.exited
		}
		const replacement = await acquireLiquidatorProcessLocks({ chainId: 1, execute: true, privateKey, stateFile: state })
		releases.push(replacement.release)
	})

	test('wakes the scheduler wait without requesting shutdown', async () => {
		using shutdown = createBotShutdownController()
		const waiting = shutdown.wait(60_000)
		shutdown.wake()
		await waiting
		expect(shutdown.isRequested()).toBe(false)
		await shutdown.wait(1)
	})

	test('allows only one chaos process to own a durable state journal', async () => {
		const state = await stateFile('state.json')
		const first = await acquireChaosProcessLocks({ chainId: 1, execute: false, privateKey: undefined, stateFile: state })
		releases.push(first.release)
		await expect(acquireChaosProcessLocks({ chainId: 1, execute: false, privateKey: undefined, stateFile: state })).rejects.toThrow('already locked')
	})

	test('uses the shared global chain-and-signer lock across separate chaos journals', async () => {
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

	test('does not reserve a signer for a dry-run process whose policy locks signers only when executing', async () => {
		const privateKey = `0x${'77'.repeat(32)}` as const
		const address = privateKeyToAccount(privateKey).address
		const dryRun = await acquireLiquidatorProcessLocks({ chainId: 1, execute: false, privateKey, stateFile: await stateFile('dry-run.json') })
		releases.push(dryRun.release)
		expect(await dryRun.acquireSigner(address)).toBeUndefined()
		const live = await acquireLiquidatorProcessLocks({ chainId: 1, execute: true, privateKey, stateFile: await stateFile('live.json') })
		releases.push(live.release)
	})

	test('shutdown request interrupts a long polling wait and remains idempotent', async () => {
		using shutdown = createBotShutdownController()
		const startedAt = Date.now()
		const waiting = shutdown.wait(60_000)
		shutdown.requestShutdown()
		shutdown.requestShutdown()
		await expect(Promise.race([waiting.then(() => 'stopped'), Bun.sleep(250).then(() => 'timed-out')])).resolves.toBe('stopped')
		expect(Date.now() - startedAt).toBeLessThan(1_000)
		expect(shutdown.isRequested()).toBe(true)
	})
})
