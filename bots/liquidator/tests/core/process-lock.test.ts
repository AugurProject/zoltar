import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { acquireLiquidatorExecutionLocks, liquidatorDashboardLifecycle } from '../../src/core/process-lock.ts'

const temporaryDirectories: string[] = []
const releases: Array<() => Promise<void>> = []

afterEach(async () => {
	await Promise.all(releases.splice(0).map(release => release()))
	await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

test('prevents duplicate state-file and signer execution processes', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-liquidator-lock-'))
	temporaryDirectories.push(directory)
	const signer = '0x0000000000000000000000000000000000000001'
	const first = await acquireLiquidatorExecutionLocks(join(directory, 'state.json'), 1, signer)
	releases.push(first.release)
	await expect(acquireLiquidatorExecutionLocks(join(directory, 'state.json'), 1, signer)).rejects.toThrow('already locked')
	await expect(acquireLiquidatorExecutionLocks(join(directory, 'other-state.json'), 1, signer)).rejects.toThrow('already locked')
	await first.release()
	releases.splice(0)
	const replacement = await acquireLiquidatorExecutionLocks(join(directory, 'state.json'), 1, signer)
	releases.push(replacement.release)
})

test('prevents a state-only process from overlapping a live process', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-liquidator-lock-'))
	temporaryDirectories.push(directory)
	const stateFile = join(directory, 'state.json')
	const signer = '0x0000000000000000000000000000000000000001'
	const live = await acquireLiquidatorExecutionLocks(stateFile, 1, signer)
	releases.push(live.release)
	await expect(acquireLiquidatorExecutionLocks(stateFile, 1, undefined)).rejects.toThrow('already locked')
	await live.release()
	releases.splice(0)
	const stateOnly = await acquireLiquidatorExecutionLocks(stateFile, 1, undefined)
	releases.push(stateOnly.release)
})

test('reserves live signer replacements and releases failed reservations', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-liquidator-lock-'))
	temporaryDirectories.push(directory)
	const originalSigner = '0x0000000000000000000000000000000000000001'
	const replacementSigner = '0x0000000000000000000000000000000000000002'
	{
		await using locks = await acquireLiquidatorExecutionLocks(join(directory, 'state.json'), 1, originalSigner)
		await expect(
			locks.withSignerReservation(replacementSigner, async () => {
				throw new Error('settings write failed')
			}),
		).rejects.toThrow('settings write failed')
		const temporary = await acquireLiquidatorExecutionLocks(join(directory, 'other-state.json'), 1, replacementSigner)
		await temporary.release()
		await locks.withSignerReservation(replacementSigner, () => Promise.resolve())
		await expect(acquireLiquidatorExecutionLocks(join(directory, 'other-state.json'), 1, replacementSigner)).rejects.toThrow('already locked')
	}
	const replacement = await acquireLiquidatorExecutionLocks(join(directory, 'state.json'), 1, originalSigner)
	releases.push(replacement.release)
})

test('releases state and signer locks after graceful SIGTERM shutdown', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-liquidator-lock-'))
	temporaryDirectories.push(directory)
	const stateFile = join(directory, 'state.json')
	const signer = '0x0000000000000000000000000000000000000003'
	const moduleUrl = pathToFileURL(resolve(import.meta.dir, '../../src/core/process-lock.ts')).href
	const script = `
		import { acquireLiquidatorExecutionLocks, createLiquidatorShutdownController, liquidatorDashboardLifecycle } from ${JSON.stringify(moduleUrl)}
		{
			using shutdown = createLiquidatorShutdownController()
			await using locks = await acquireLiquidatorExecutionLocks(${JSON.stringify(stateFile)}, 1, ${JSON.stringify(signer)})
			await using dashboardLifecycle = liquidatorDashboardLifecycle({
				stop: async () => {
					console.log('draining')
					await Bun.sleep(500)
				},
			})
			console.log('ready')
			while (!shutdown.isRequested()) await shutdown.wait(60_000)
		}
	`
	const child = Bun.spawn([process.execPath, '--eval', script], {
		cwd: resolve(import.meta.dir, '../..'),
		stderr: 'pipe',
		stdout: 'pipe',
	})
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
		await expect(acquireLiquidatorExecutionLocks(stateFile, 1, signer)).rejects.toThrow('already locked')
		reader.releaseLock()
		expect(await child.exited).toBe(0)
	} finally {
		if (child.exitCode === null) child.kill('SIGKILL')
		await child.exited
	}
	const replacement = await acquireLiquidatorExecutionLocks(stateFile, 1, signer)
	releases.push(replacement.release)
})

test('cleans up when SIGTERM arrives before asynchronous lock acquisition returns', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-liquidator-lock-'))
	temporaryDirectories.push(directory)
	const stateFile = join(directory, 'state.json')
	const signer = '0x0000000000000000000000000000000000000004'
	const moduleUrl = pathToFileURL(resolve(import.meta.dir, '../../src/core/process-lock.ts')).href
	const script = `
		import { acquireLiquidatorExecutionLocks, acquireLiquidatorExecutionLocksForShutdown, createLiquidatorShutdownController } from ${JSON.stringify(moduleUrl)}
		using shutdown = createLiquidatorShutdownController()
		const locks = await acquireLiquidatorExecutionLocksForShutdown(${JSON.stringify(stateFile)}, 1, ${JSON.stringify(signer)}, shutdown, async () => {
			const acquired = await acquireLiquidatorExecutionLocks(${JSON.stringify(stateFile)}, 1, ${JSON.stringify(signer)})
			console.log('locked-before-return')
			await shutdown.wait(60_000)
			return acquired
		})
		await locks?.release()
	`
	const child = Bun.spawn([process.execPath, '--eval', script], {
		cwd: resolve(import.meta.dir, '../..'),
		stderr: 'pipe',
		stdout: 'pipe',
	})
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
	const replacement = await acquireLiquidatorExecutionLocks(stateFile, 1, signer)
	releases.push(replacement.release)
})

test('always drains the dashboard when polling fails', async () => {
	let stopped = false
	await expect(
		(async () => {
			await using dashboardLifecycle = liquidatorDashboardLifecycle({
				stop: () => {
					stopped = true
					return Promise.resolve()
				},
			})
			void dashboardLifecycle
			throw new Error('poll failed')
		})(),
	).rejects.toThrow('poll failed')
	expect(stopped).toBe(true)
})
