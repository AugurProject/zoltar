import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { isErrorCode } from '../infrastructure/error-code.ts'

const OWNER_ONLY_FILE_MODE = 0o600
const OWNER_ONLY_DIRECTORY_MODE = 0o700

type SyncableHandle = {
	close: () => Promise<unknown>
	sync: () => Promise<unknown>
}

type DirectoryFilesystem = {
	open: (path: string, flags: 'r') => Promise<SyncableHandle>
}

type DirectoryCreationFilesystem = DirectoryFilesystem & {
	mkdir: (path: string, options: { mode: number; recursive: true }) => Promise<unknown>
}

type DurableFileHandle = SyncableHandle & {
	chmod: (mode: number) => Promise<unknown>
	writeFile: (data: string, options: { encoding: 'utf8' }) => Promise<unknown>
}

export type DurableWriteFilesystem = {
	mkdir: (path: string, options: { mode: number; recursive: true }) => Promise<unknown>
	open: (path: string, flags: 'r' | 'wx', mode?: number) => Promise<DurableFileHandle>
	rename: (oldPath: string, newPath: string) => Promise<unknown>
	rm: (path: string, options: { force: true }) => Promise<unknown>
}

type ReadFilesystem = {
	readFile: (path: string, encoding: 'utf8') => Promise<string>
}

export type RevisionedFileFilesystem = DurableWriteFilesystem & ReadFilesystem

type DurableAppendHandle = SyncableHandle & {
	appendFile: (data: string, options: { encoding: 'utf8' }) => Promise<unknown>
	chmod: (mode: number) => Promise<unknown>
}

export type DurableAppendFilesystem = {
	mkdir: (path: string, options: { mode: number; recursive: true }) => Promise<unknown>
	open: (path: string, flags: 'a' | 'r', mode?: number) => Promise<DurableAppendHandle>
}

export const durableFilesystem = { mkdir, open, readFile, rename, rm }

export async function syncDirectory(path: string, filesystem: DirectoryFilesystem = durableFilesystem) {
	const handle = await filesystem.open(path, 'r')
	try {
		await handle.sync()
	} finally {
		await handle.close()
	}
}

/** Creates a missing directory chain and syncs every parent that gained a new entry. */
async function createDirectoryDurably(path: string, filesystem: DirectoryCreationFilesystem = durableFilesystem) {
	const missingDirectories: string[] = []
	let existingDirectory = path
	for (;;) {
		let handle: SyncableHandle
		try {
			handle = await filesystem.open(existingDirectory, 'r')
		} catch (error) {
			if (!isErrorCode(error, 'ENOENT')) throw error
			const parent = dirname(existingDirectory)
			if (parent === existingDirectory) throw error
			missingDirectories.push(existingDirectory)
			existingDirectory = parent
			continue
		}
		await handle.close()
		break
	}
	if (missingDirectories.length === 0) return
	await filesystem.mkdir(path, { mode: OWNER_ONLY_DIRECTORY_MODE, recursive: true })
	for (const directory of missingDirectories) await syncDirectory(dirname(directory), filesystem)
}

type AtomicWriteOptions = {
	/** Runs after the temporary file is durable and before it replaces the destination; a throw aborts the replacement. */
	beforeCommit?: ((temporaryPath: string) => Promise<unknown>) | undefined
	filesystem?: DurableWriteFilesystem | undefined
	/** Sync the parent of every directory this write creates, instead of a plain recursive mkdir. */
	syncCreatedDirectories?: boolean | undefined
}

/**
 * Replaces `path` with owner-only `contents`: write a temporary sibling, fsync it, rename it over the destination and
 * fsync the directory. The temporary file is removed on failure. A failure after the rename does not mean the
 * destination was left unchanged.
 */
export async function writeFileAtomically(path: string, contents: string, options: AtomicWriteOptions = {}) {
	const filesystem = options.filesystem ?? durableFilesystem
	const directory = dirname(path)
	if (options.syncCreatedDirectories === true) await createDirectoryDurably(directory, filesystem)
	else await filesystem.mkdir(directory, { mode: OWNER_ONLY_DIRECTORY_MODE, recursive: true })
	const temporaryPath = `${path}.${process.pid.toString()}.${randomUUID()}.tmp`
	try {
		const handle = await filesystem.open(temporaryPath, 'wx', OWNER_ONLY_FILE_MODE)
		try {
			await handle.writeFile(contents, { encoding: 'utf8' })
			await handle.chmod(OWNER_ONLY_FILE_MODE)
			await handle.sync()
		} finally {
			await handle.close()
		}
		await options.beforeCommit?.(temporaryPath)
		await filesystem.rename(temporaryPath, path)
		await syncDirectory(directory, filesystem)
	} catch (error) {
		await filesystem.rm(temporaryPath, { force: true })
		throw error
	}
}

type BoundedWriteOptions = AtomicWriteOptions & {
	/** Names the file in the size-limit error, such as `Liquidator state`. */
	label: string
	maximumBytes: number
}

/** `writeFileAtomically`, refusing contents above `maximumBytes` before anything touches the disk. */
async function writeBoundedFileAtomically(path: string, contents: string, { label, maximumBytes, ...options }: BoundedWriteOptions) {
	if (Buffer.byteLength(contents, 'utf8') > maximumBytes) throw new Error(`${label} exceeds the ${maximumBytes.toString()}-byte safety limit`)
	await writeFileAtomically(path, contents, options)
}

/**
 * Persists a bot's durable state file: the caller renders `contents` synchronously from the state it holds now, then
 * this queues the write behind every earlier write to the same path in this process, enforces the size cap, and
 * replaces the file atomically. Readers should pass the same `maximumBytes` to `readOwnerFileIfPresent`.
 */
export async function writeDurableStateFile(path: string, contents: string, options: BoundedWriteOptions) {
	const resolvedPath = resolve(path)
	await serializeWritesToPath(resolvedPath, () => writeBoundedFileAtomically(resolvedPath, contents, options))
}

/** Appends to an owner-only file and syncs it and its directory; without contents it only ensures the file exists. */
export async function appendFileDurably(path: string, contents: string | undefined, filesystem: DurableAppendFilesystem = durableFilesystem) {
	await filesystem.mkdir(dirname(path), { mode: OWNER_ONLY_DIRECTORY_MODE, recursive: true })
	const handle = await filesystem.open(path, 'a', OWNER_ONLY_FILE_MODE)
	try {
		await handle.chmod(OWNER_ONLY_FILE_MODE)
		if (contents !== undefined) await handle.appendFile(contents, { encoding: 'utf8' })
		await handle.sync()
	} finally {
		await handle.close()
	}
	await syncDirectory(dirname(path), filesystem)
}

export async function readFileIfPresent(path: string, filesystem: ReadFilesystem = durableFilesystem) {
	try {
		return await filesystem.readFile(path, 'utf8')
	} catch (error) {
		if (isErrorCode(error, 'ENOENT')) return undefined
		throw error
	}
}

export function parseJsonDocument(contents: string, label: string): unknown {
	try {
		return JSON.parse(contents)
	} catch (error) {
		if (error instanceof SyntaxError) throw new Error(`${label} is not valid JSON: ${error.message}`)
		throw error
	}
}

export function contentRevision(contents: string) {
	return `sha256:${createHash('sha256').update(contents).digest('hex')}`
}

/** Error name every bot uses when a configuration save loses a revision race; dashboards map it to HTTP 409. */
export const CONFIGURATION_REVISION_CONFLICT = 'ConfigurationRevisionConflict'

export function configurationRevisionConflict(subject: string) {
	const error = new Error(`The ${subject} changed after this editor loaded. Reload it, review the newer values, and apply your change again.`)
	error.name = CONFIGURATION_REVISION_CONFLICT
	return error
}

type RevisionedWriteOptions = {
	conflict: () => Error
	expectedRevision?: string | undefined
	filesystem?: RevisionedFileFilesystem | undefined
}

/**
 * Atomically replaces `path` and returns the revision of the saved bytes. With an expected revision, the destination is
 * compared at commit time and a missing or changed file raises `conflict()` without replacing it.
 */
export async function writeRevisionedFile(path: string, contents: string, options: RevisionedWriteOptions) {
	const filesystem = options.filesystem ?? durableFilesystem
	const { expectedRevision } = options
	await writeFileAtomically(path, contents, {
		beforeCommit:
			expectedRevision === undefined
				? undefined
				: async () => {
						const current = await readFileIfPresent(path, filesystem)
						if (current === undefined || contentRevision(current) !== expectedRevision) throw options.conflict()
					},
		filesystem,
	})
	return contentRevision(contents)
}

const pathWriteQueues = new Map<string, Promise<unknown>>()

/** Runs `operation` after every earlier operation queued for the same resolved path in this process has settled. */
export async function serializeWritesToPath<Result>(path: string, operation: () => Promise<Result>) {
	const key = resolve(path)
	const previous = pathWriteQueues.get(key)
	const write = (previous === undefined ? Promise.resolve() : previous.catch(() => undefined)).then(operation)
	const tracked: Promise<Result> = write.finally(() => {
		if (pathWriteQueues.get(key) === tracked) pathWriteQueues.delete(key)
	})
	pathWriteQueues.set(key, tracked)
	return await tracked
}

export type OwnerFileHandle = {
	chmod: (mode: number) => Promise<unknown>
	close: () => Promise<unknown>
	readFile: (options: { encoding: 'utf8' }) => Promise<string>
	stat: () => Promise<{
		isDirectory: () => boolean
		isFile: () => boolean
		mode: number
		size: number
		uid: number
	}>
	sync: () => Promise<unknown>
	writeFile: (data: string, options: { encoding: 'utf8' }) => Promise<unknown>
}

export type OwnerFilesystem = {
	open: (path: string, flags: 'wx' | number, mode?: number) => Promise<OwnerFileHandle>
}

export const ownerFilesystem: OwnerFilesystem = { open }

function assertOwnerOnly(metadata: { mode: number; uid: number }, path: string, label: string, mode: number) {
	if ((metadata.mode & 0o777) !== mode) throw new Error(`${label} ${path} must have owner-only mode 0${mode.toString(8)}`)
	if (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) throw new Error(`${label} ${path} must be owned by the bot process user`)
}

async function inspectWithoutFollowingLinks<Result>(path: string, flags: number, filesystem: OwnerFilesystem, label: string, inspect: (handle: OwnerFileHandle) => Promise<Result>) {
	let handle: OwnerFileHandle | undefined
	try {
		handle = await filesystem.open(path, flags | constants.O_RDONLY | constants.O_NOFOLLOW)
		return await inspect(handle)
	} catch (error) {
		if (isErrorCode(error, 'ELOOP')) throw new Error(`${label} ${path} must not be a symbolic link`)
		throw error
	} finally {
		await handle?.close()
	}
}

/** Requires a real directory with mode 0700 owned by this process user. */
export async function ownerDirectory(path: string, filesystem: OwnerFilesystem, label: string) {
	await inspectWithoutFollowingLinks(path, constants.O_DIRECTORY, filesystem, label, async handle => {
		const metadata = await handle.stat()
		if (!metadata.isDirectory()) throw new Error(`${label} ${path} must be a directory`)
		assertOwnerOnly(metadata, path, label, 0o700)
	})
}

/** Reads a regular, non-symbolic-link file with mode 0600 owned by this process user; a missing file rethrows ENOENT. */
export async function readOwnerFile(path: string, filesystem: OwnerFilesystem, label: string, maximumBytes?: number) {
	return await inspectWithoutFollowingLinks(path, 0, filesystem, label, async handle => {
		const metadata = await handle.stat()
		if (!metadata.isFile()) throw new Error(`${label} ${path} must be a regular file`)
		assertOwnerOnly(metadata, path, label, 0o600)
		const oversized = () => new Error(`${label} ${path} exceeds its ${String(maximumBytes)}-byte safety limit`)
		if (maximumBytes !== undefined && (!Number.isSafeInteger(metadata.size) || metadata.size < 0 || metadata.size > maximumBytes)) throw oversized()
		const contents = await handle.readFile({ encoding: 'utf8' })
		if (maximumBytes !== undefined && Buffer.byteLength(contents, 'utf8') > maximumBytes) throw oversized()
		return contents
	})
}

/** Reads an owner-only regular file like `readOwnerFile`, returning `undefined` when it does not exist. */
export async function readOwnerFileIfPresent(path: string, label: string, maximumBytes?: number, filesystem: OwnerFilesystem = ownerFilesystem) {
	try {
		return await readOwnerFile(path, filesystem, label, maximumBytes)
	} catch (error) {
		if (isErrorCode(error, 'ENOENT')) return undefined
		throw error
	}
}

/** Creates a new owner-only file and syncs its contents; it never replaces an existing file. */
export async function writeOwnerFile(path: string, contents: string, filesystem: OwnerFilesystem) {
	const handle = await filesystem.open(path, 'wx', 0o600)
	try {
		await handle.writeFile(contents, { encoding: 'utf8' })
		await handle.chmod(0o600)
		await handle.sync()
	} finally {
		await handle.close()
	}
}

export async function syncOwnerDirectory(path: string, filesystem: OwnerFilesystem) {
	const handle = await filesystem.open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
	try {
		await handle.sync()
	} finally {
		await handle.close()
	}
}

/** A rename onto an existing generation directory: another writer already committed the same immutable content. */
export function isExistingTargetError(error: unknown) {
	return isErrorCode(error, 'EEXIST', 'ENOTEMPTY')
}
