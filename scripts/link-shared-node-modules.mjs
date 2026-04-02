import { promises as fs } from 'node:fs'
import { execFileSync } from 'node:child_process'
import * as path from 'node:path'

const cwd = process.cwd()
const worktreeRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim()
const commonGitDir = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd, encoding: 'utf8' }).trim()
const sharedRoot = path.resolve(commonGitDir, '..')
const packageRelativePath = path.relative(worktreeRoot, cwd)
const sharedPackageRoot = packageRelativePath === '' ? sharedRoot : path.join(sharedRoot, packageRelativePath)
const localNodeModulesPath = path.join(cwd, 'node_modules')
const sharedNodeModulesPath = path.join(sharedPackageRoot, 'node_modules')

const ensureDirectory = async directoryPath => {
	const stat = await fs.lstat(directoryPath).catch(() => undefined)
	if (stat?.isDirectory()) return
	if (stat !== undefined) {
		await fs.rm(directoryPath, { force: true, recursive: true })
	}
	await fs.mkdir(directoryPath, { recursive: true })
}

async function ensureSharedNodeModules() {
	const localStat = await fs.lstat(localNodeModulesPath).catch(() => undefined)
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
