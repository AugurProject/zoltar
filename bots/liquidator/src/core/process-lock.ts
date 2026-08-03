import { mkdir, open, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { getAddress, type Address } from '@zoltar/bot-shared/ethereum'

type ProcessLock = {
	release: () => Promise<void>
}

async function acquireProcessLock(path: string, subject: string, metadata: Record<string, string | number>): Promise<ProcessLock> {
	await mkdir(dirname(path), { mode: 0o700, recursive: true })
	let handle: Awaited<ReturnType<typeof open>>
	try {
		handle = await open(path, 'wx', 0o600)
	} catch (error) {
		if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST') {
			let owner = 'owner metadata unavailable'
			try {
				owner = (await readFile(path, 'utf8')).trim()
			} catch (readError) {
				void readError
			}
			throw new Error(`${subject} is already locked (${owner}). Stop the other process before removing ${path}.`)
		}
		throw error
	}
	const payload = `${JSON.stringify({ acquiredAt: new Date().toISOString(), ...metadata, pid: process.pid })}\n`
	try {
		await handle.writeFile(payload, { encoding: 'utf8' })
		await handle.chmod(0o600)
		await handle.sync()
	} catch (error) {
		await handle.close()
		await rm(path, { force: true })
		throw error
	}
	let released = false
	return {
		release: async () => {
			if (released) return
			released = true
			await handle.close()
			const current = await readFile(path, 'utf8').catch(error => {
				throw new Error(`${subject} lock ${path} disappeared before release: ${error instanceof Error ? error.message : String(error)}`)
			})
			if (current !== payload) throw new Error(`${subject} lock ${path} changed ownership before release`)
			await rm(path, { force: true })
		},
	}
}

export async function acquireLiquidatorExecutionLocks(stateFile: string, chainId: number, account?: Address) {
	if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error('Execution signer lock chain id is invalid')
	const statePath = resolve(stateFile)
	const stateLock = await acquireProcessLock(`${statePath}.lock`, `Liquidator state ${statePath}`, { stateFile: statePath })
	const signerLocks: ProcessLock[] = []
	const signerAddresses = new Set<string>()
	if (account !== undefined) {
		const signer = getAddress(account)
		try {
			signerLocks.push(await acquireLiquidatorSignerLock(chainId, signer))
			signerAddresses.add(signer.toLowerCase())
		} catch (error) {
			await stateLock.release()
			throw error
		}
	}
	let released = false
	const release = async () => {
		if (released) return
		released = true
		let failure: unknown
		for (const lock of [...signerLocks].reverse()) {
			try {
				await lock.release()
			} catch (error) {
				failure ??= error
			}
		}
		try {
			await stateLock.release()
		} catch (error) {
			failure ??= error
		}
		if (failure !== undefined) throw failure
	}
	return {
		[Symbol.asyncDispose]: release,
		release,
		withSignerReservation: async <T>(nextAccount: Address, operation: () => Promise<T>) => {
			const nextSigner = getAddress(nextAccount)
			const key = nextSigner.toLowerCase()
			if (signerAddresses.has(key)) return operation()
			const lock = await acquireLiquidatorSignerLock(chainId, nextSigner)
			try {
				const result = await operation()
				signerLocks.push(lock)
				signerAddresses.add(key)
				return result
			} catch (error) {
				await lock.release()
				throw error
			}
		},
	}
}

export async function acquireLiquidatorExecutionLocksForShutdown(stateFile: string, chainId: number, account: Address | undefined, shutdown: { isRequested: () => boolean }, acquire: typeof acquireLiquidatorExecutionLocks = acquireLiquidatorExecutionLocks) {
	const locks = await acquire(stateFile, chainId, account)
	if (!shutdown.isRequested()) return locks
	await locks.release()
	return undefined
}

export function liquidatorDashboardLifecycle(dashboard: { stop: () => Promise<void> }) {
	return { [Symbol.asyncDispose]: () => dashboard.stop() }
}

export function createLiquidatorShutdownController() {
	let requested = false
	let disposed = false
	const waiters = new Set<() => void>()
	const requestShutdown = () => {
		requested = true
		for (const finish of [...waiters]) finish()
	}
	process.on('SIGINT', requestShutdown)
	process.on('SIGTERM', requestShutdown)
	return {
		[Symbol.dispose]: () => {
			if (disposed) return
			disposed = true
			process.off('SIGINT', requestShutdown)
			process.off('SIGTERM', requestShutdown)
			for (const finish of [...waiters]) finish()
		},
		isRequested: () => requested,
		wait: (milliseconds: number) => {
			if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) throw new Error('Shutdown wait must be a non-negative integer')
			if (requested) return Promise.resolve()
			return new Promise<void>(resolve => {
				let timer: ReturnType<typeof setTimeout>
				const finish = () => {
					clearTimeout(timer)
					waiters.delete(finish)
					resolve()
				}
				timer = setTimeout(finish, milliseconds)
				waiters.add(finish)
			})
		},
	}
}

export function acquireLiquidatorSignerLock(chainId: number, account: Address) {
	if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error('Execution signer lock chain id is invalid')
	const signer = getAddress(account)
	return acquireProcessLock(join(tmpdir(), 'zoltar-liquidator-locks', `${chainId.toString()}-${signer.toLowerCase()}.lock`), `Liquidator execution signer ${signer} on chain ${chainId.toString()}`, { chainId, signer })
}
