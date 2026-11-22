import { lstat, readlink, stat } from 'node:fs/promises'
import { dirname, parse, relative, resolve, sep } from 'node:path'
import { isErrorCode } from '../infrastructure/error-code.ts'

type PersistentPathIdentity = {
	canonicalPath: string
	fileIdentity: string | undefined
}

/** Matches the kernel's ELOOP bound: a lookup that follows more links than this fails on the filesystem too. */
const MAXIMUM_FOLLOWED_LINKS = 40

/**
 * `resolving` holds only the links whose targets are still being resolved, so a link revisited after its target has
 * resolved (such as `here -> .` in `here/here/file`) is not a cycle; `budget` bounds the total links followed.
 */
async function canonicalPath(path: string, resolving = new Set<string>(), budget = { followed: 0 }): Promise<string> {
	const absolute = resolve(path)
	const root = parse(absolute).root
	const segments = relative(root, absolute).split(sep).filter(Boolean)
	let current = root
	for (const [index, segment] of segments.entries()) {
		const candidate = resolve(current, segment)
		let metadata: Awaited<ReturnType<typeof lstat>>
		try {
			metadata = await lstat(candidate)
		} catch (error) {
			if (!isErrorCode(error, 'ENOENT', 'ENOTDIR')) throw error
			return resolve(current, ...segments.slice(index))
		}
		if (!metadata.isSymbolicLink()) {
			current = candidate
			continue
		}
		budget.followed += 1
		if (resolving.has(candidate) || budget.followed > MAXIMUM_FOLLOWED_LINKS) throw new Error(`Persistent path contains a symbolic-link cycle at ${candidate}`)
		resolving.add(candidate)
		const target = await readlink(candidate)
		current = await canonicalPath(resolve(dirname(candidate), target), resolving, budget)
		resolving.delete(candidate)
	}
	return current
}

export async function persistentPathIdentity(path: string): Promise<PersistentPathIdentity> {
	const resolved = resolve(path)
	let fileIdentity: string | undefined
	try {
		const metadata = await stat(resolved)
		fileIdentity = `${metadata.dev.toString()}:${metadata.ino.toString()}`
	} catch (error) {
		if (!isErrorCode(error, 'ENOENT', 'ENOTDIR')) throw error
	}
	return { canonicalPath: await canonicalPath(resolved), fileIdentity }
}

export function persistentPathIdentitiesMatch(left: PersistentPathIdentity, right: PersistentPathIdentity) {
	return left.canonicalPath === right.canonicalPath || (left.fileIdentity !== undefined && left.fileIdentity === right.fileIdentity)
}
