import { lstat, mkdir, open, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { getAddress, type Address } from '../ethereum.ts'

type ProcessLockFileHandle = {
	chmod: (mode: number) => Promise<unknown>
	close: () => Promise<unknown>
	sync: () => Promise<unknown>
	writeFile: (data: string, options: { encoding: 'utf8' }) => Promise<unknown>
}

export type ProcessLockFilesystem = {
	lstat?: (path: string) => Promise<{ isDirectory: () => boolean; isSymbolicLink: () => boolean; mode: number; uid: number }>
	mkdir: (path: string, options: { mode: number; recursive: true }) => Promise<unknown>
	open: (path: string, flags: 'wx', mode: number) => Promise<ProcessLockFileHandle>
	readFile: (path: string, encoding: 'utf8') => Promise<string>
	rm: (path: string, options: { force: true }) => Promise<unknown>
}

export type ExclusiveProcessLock = {
	path: string
	release: () => Promise<void>
}

const processLockFilesystem: ProcessLockFilesystem = {
	lstat,
	mkdir,
	open,
	readFile,
	rm,
}

async function assertSafeLockDirectory(path: string, filesystem: ProcessLockFilesystem) {
	if (filesystem.lstat === undefined) return
	const stats = await filesystem.lstat(path)
	if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error(`Process-lock directory ${path} is not a real directory`)
	const currentUid = process.getuid?.()
	if (currentUid !== undefined && stats.uid !== currentUid) throw new Error(`Process-lock directory ${path} is not owned by the current user`)
	if ((stats.mode & 0o7777) !== 0o700) throw new Error(`Process-lock directory ${path} has unsafe permissions; expected mode 0700`)
}

export async function acquireExclusiveProcessLock(lockPath: string, subject: string, metadata: Record<string, string | number>, filesystem: ProcessLockFilesystem = processLockFilesystem): Promise<ExclusiveProcessLock> {
	const lockDirectory = dirname(lockPath)
	await filesystem.mkdir(lockDirectory, { mode: 0o700, recursive: true })
	await assertSafeLockDirectory(lockDirectory, filesystem)
	let handle: ProcessLockFileHandle
	try {
		handle = await filesystem.open(lockPath, 'wx', 0o600)
	} catch (error) {
		if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST') {
			let owner = 'owner metadata unavailable'
			try {
				owner = (await filesystem.readFile(lockPath, 'utf8')).trim()
			} catch (readError) {
				void readError
			}
			throw new Error(`${subject} is already locked (${owner}). Stop the other process before removing ${lockPath}.`)
		}
		throw error
	}
	const payload = `${JSON.stringify({ acquiredAt: new Date().toISOString(), ...metadata, pid: process.pid })}\n`
	try {
		await handle.writeFile(payload, { encoding: 'utf8' })
		await handle.chmod(0o600)
		await handle.sync()
	} catch (error) {
		const cleanupErrors: unknown[] = []
		try {
			await handle.close()
		} catch (cleanupError) {
			cleanupErrors.push(cleanupError)
		}
		try {
			await filesystem.rm(lockPath, { force: true })
		} catch (cleanupError) {
			cleanupErrors.push(cleanupError)
		}
		if (cleanupErrors.length !== 0) throw new AggregateError([error, ...cleanupErrors], `Failed to initialize and clean up process lock ${lockPath}`)
		throw error
	}
	let released = false
	let handleClosed = false
	let releaseAttempt: Promise<void> | undefined
	return {
		path: lockPath,
		release: () => {
			if (released) return Promise.resolve()
			if (releaseAttempt !== undefined) return releaseAttempt
			releaseAttempt = (async () => {
				if (!handleClosed) {
					await handle.close()
					handleClosed = true
				}
				let current: string
				try {
					current = await filesystem.readFile(lockPath, 'utf8')
				} catch (error) {
					throw new Error(`Process lock ${lockPath} disappeared before release: ${error instanceof Error ? error.message : String(error)}`)
				}
				if (current !== payload) throw new Error(`Process lock ${lockPath} changed ownership before release`)
				await filesystem.rm(lockPath, { force: true })
				released = true
			})().finally(() => {
				if (!released) releaseAttempt = undefined
			})
			return releaseAttempt
		},
	}
}

export function acquireFileProcessLock(path: string, label: string, filesystem?: ProcessLockFilesystem) {
	const resolvedPath = resolve(path)
	return acquireExclusiveProcessLock(`${resolvedPath}.lock`, `${label} ${resolvedPath}`, { file: resolvedPath }, filesystem)
}

export function acquireExecutionSignerLock(chainId: number, account: Address, filesystem?: ProcessLockFilesystem) {
	if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error('Execution signer lock chain id is invalid')
	const signer = getAddress(account)
	const lockPath = join(tmpdir(), 'zoltar-bot-locks', `${chainId.toString()}-${signer.toLowerCase()}.lock`)
	return acquireExclusiveProcessLock(lockPath, `Execution signer ${signer} on chain ${chainId.toString()}`, { chainId, signer }, filesystem)
}
