import { createHash, randomUUID } from 'node:crypto'
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
