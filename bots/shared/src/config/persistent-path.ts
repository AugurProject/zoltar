import { lstat, readlink, stat } from 'node:fs/promises'
import { dirname, parse, relative, resolve, sep } from 'node:path'

type PersistentPathIdentity = {
	canonicalPath: string
	fileIdentity: string | undefined
}

function isMissingPath(error: unknown) {
	return typeof error === 'object' && error !== null && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')
}

async function canonicalPath(path: string, followedLinks = new Set<string>()): Promise<string> {
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
			if (!isMissingPath(error)) throw error
			return resolve(current, ...segments.slice(index))
		}
		if (!metadata.isSymbolicLink()) {
			current = candidate
			continue
		}
		if (followedLinks.has(candidate)) throw new Error(`Persistent path contains a symbolic-link cycle at ${candidate}`)
		followedLinks.add(candidate)
		const target = await readlink(candidate)
		current = await canonicalPath(resolve(dirname(candidate), target), followedLinks)
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
		if (!isMissingPath(error)) throw error
	}
	return { canonicalPath: await canonicalPath(resolved), fileIdentity }
}

export function persistentPathIdentitiesMatch(left: PersistentPathIdentity, right: PersistentPathIdentity) {
	return left.canonicalPath === right.canonicalPath || (left.fileIdentity !== undefined && left.fileIdentity === right.fileIdentity)
}
