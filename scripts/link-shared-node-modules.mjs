import { promises as fs } from 'node:fs'
import { execFileSync } from 'node:child_process'
import * as path from 'node:path'

const cwd = process.cwd()
const localNodeModulesPath = path.join(cwd, 'node_modules')

function isGitPathLookupFailure(error) {
	if (!(error instanceof Error)) return false
	const execError = error
	return execError.code === 'ENOENT' || execError.status !== undefined || execError.signal !== undefined
}

function isMissingPathError(error) {
	return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function tryGetGitPath(args) {
	try {
		return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
	} catch (error) {
		if (!isGitPathLookupFailure(error)) throw error
		return undefined
	}
}

const worktreeRoot = tryGetGitPath(['rev-parse', '--show-toplevel'])
const commonGitDir = tryGetGitPath(['rev-parse', '--git-common-dir'])
const sharedNodeModulesPath =
	worktreeRoot === undefined || commonGitDir === undefined
		? localNodeModulesPath
		: (() => {
				const sharedRoot = path.resolve(commonGitDir, '..')
				const packageRelativePath = path.relative(worktreeRoot, cwd)
				const sharedPackageRoot = packageRelativePath === '' ? sharedRoot : path.join(sharedRoot, packageRelativePath)
				return path.join(sharedPackageRoot, 'node_modules')
			})()

const ensureDirectory = async directoryPath => {
	let stat
	try {
		stat = await fs.lstat(directoryPath)
	} catch (error) {
		if (!isMissingPathError(error)) throw error
		stat = undefined
	}
	if (stat?.isDirectory()) return
	if (stat !== undefined) {
		await fs.rm(directoryPath, { force: true, recursive: true })
	}
	await fs.mkdir(directoryPath, { recursive: true })
}

async function ensureSharedNodeModules() {
	if (localNodeModulesPath === sharedNodeModulesPath) {
		await ensureDirectory(sharedNodeModulesPath)
		return
	}
	let localStat
	try {
		localStat = await fs.lstat(localNodeModulesPath)
	} catch (error) {
		if (!isMissingPathError(error)) throw error
		localStat = undefined
	}
	if (localStat?.isSymbolicLink()) {
		const linkedTarget = await fs.readlink(localNodeModulesPath)
		const resolvedTarget = path.resolve(path.dirname(localNodeModulesPath), linkedTarget)
		if (resolvedTarget === sharedNodeModulesPath) {
			await ensureDirectory(sharedNodeModulesPath)
			return
		}
		await fs.rm(localNodeModulesPath, { force: true, recursive: true })
	} else if (localStat !== undefined) {
		await fs.rm(localNodeModulesPath, { force: true, recursive: true })
	}

	await ensureDirectory(sharedNodeModulesPath)
	await fs.symlink(sharedNodeModulesPath, localNodeModulesPath, 'dir')
}

await ensureSharedNodeModules()
