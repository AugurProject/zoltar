import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { isErrorCode } from '@zoltar/bot-shared/infrastructure/error-code'

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
