import { constants } from 'node:fs'
import { lstat, mkdir, open, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { dlopen } from 'bun:ffi'
import { getAddress, type Address } from '../ethereum.ts'

type ProcessLockFileHandle = {
	chmod: (mode: number) => Promise<unknown>
	close: () => Promise<unknown>
	fd: number
	sync: () => Promise<unknown>
	truncate: (length?: number) => Promise<unknown>
	writeFile: (data: string, options: { encoding: 'utf8' }) => Promise<unknown>
}

export type ProcessLockFilesystem = {
	lstat?: (path: string) => Promise<{ isDirectory: () => boolean; isSymbolicLink: () => boolean; mode: number; uid: number }>
	mkdir: (path: string, options: { mode: number; recursive: true }) => Promise<unknown>
	open: (path: string, flags: number, mode: number) => Promise<ProcessLockFileHandle>
	readFile: (path: string, encoding: 'utf8') => Promise<string>
	tryLock: (fileDescriptor: number) => boolean
}

function platformFlockCandidates() {
	if (process.platform === 'darwin') return ['/usr/lib/libSystem.B.dylib']
	if (process.platform !== 'linux') return []
	let architectureLibraries: string[] = []
	if (process.arch === 'x64') architectureLibraries = ['/lib/libc.musl-x86_64.so.1', '/lib/ld-musl-x86_64.so.1']
	else if (process.arch === 'arm64') architectureLibraries = ['/lib/libc.musl-aarch64.so.1', '/lib/ld-musl-aarch64.so.1']
	return ['libc.so.6', ...architectureLibraries]
}

const nativeFlockCandidates = platformFlockCandidates()

let nativeFlock: ((fileDescriptor: number) => number) | undefined

function tryNativeFileLock(fileDescriptor: number) {
	if (nativeFlock === undefined) {
		const failures: unknown[] = []
		for (const candidate of nativeFlockCandidates) {
			try {
				const library = dlopen(candidate, { flock: { args: ['i32', 'i32'], returns: 'i32' } })
				nativeFlock = descriptor => library.symbols.flock(descriptor, 6)
				break
			} catch (error) {
				failures.push(error)
			}
		}
		if (nativeFlock === undefined) throw new AggregateError(failures, 'Native process locking is unavailable on this platform')
	}
	return nativeFlock(fileDescriptor) === 0
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
	tryLock: tryNativeFileLock,
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
		handle = await filesystem.open(lockPath, constants.O_CREAT | constants.O_NOFOLLOW | constants.O_RDWR, 0o600)
	} catch (error) {
		throw error
	}
	let acquired: boolean
	try {
		acquired = filesystem.tryLock(handle.fd)
	} catch (error) {
		try {
			await handle.close()
		} catch (cleanupError) {
			throw new AggregateError([error, cleanupError], `Failed to acquire and clean up process lock ${lockPath}`)
		}
		throw error
	}
	if (!acquired) {
		let owner = 'owner metadata unavailable'
		try {
			owner = (await filesystem.readFile(lockPath, 'utf8')).trim()
		} catch (readError) {
			void readError
		}
		await handle.close()
		throw new Error(`${subject} is already locked (${owner}). Stop the other process before removing ${lockPath}.`)
	}
	const payload = `${JSON.stringify({ acquiredAt: new Date().toISOString(), ...metadata, pid: process.pid })}\n`
	try {
		await handle.truncate(0)
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
		if (cleanupErrors.length !== 0) throw new AggregateError([error, ...cleanupErrors], `Failed to initialize and clean up process lock ${lockPath}`)
		throw error
	}
	let released = false
	let releaseAttempt: Promise<void> | undefined
	return {
		path: lockPath,
		release: () => {
			if (released) return Promise.resolve()
			if (releaseAttempt !== undefined) return releaseAttempt
			releaseAttempt = (async () => {
				let current: string
				try {
					current = await filesystem.readFile(lockPath, 'utf8')
				} catch (error) {
					throw new Error(`Process lock ${lockPath} disappeared before release: ${error instanceof Error ? error.message : String(error)}`)
				}
				if (current !== payload) throw new Error(`Process lock ${lockPath} changed ownership before release`)
				await handle.close()
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

export function executionSignerLockPath(chainId: number, account: Address, lockRoot = join(tmpdir(), 'zoltar-bot-locks')) {
	if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error('Execution signer lock chain id is invalid')
	const signer = getAddress(account)
	if (lockRoot.trim() === '') throw new Error('Execution signer lock root cannot be empty')
	return join(resolve(lockRoot), `${chainId.toString()}-${signer.toLowerCase()}.lock`)
}

export function acquireExecutionSignerLock(chainId: number, account: Address, lockRoot?: string, filesystem?: ProcessLockFilesystem) {
	const signer = getAddress(account)
	const lockPath = executionSignerLockPath(chainId, signer, lockRoot)
	return acquireExclusiveProcessLock(lockPath, `Execution signer ${signer} on chain ${chainId.toString()}`, { chainId, signer }, filesystem)
}
