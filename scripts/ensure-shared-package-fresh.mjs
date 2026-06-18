import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as url from 'node:url'

const scriptDirectoryPath = path.dirname(url.fileURLToPath(import.meta.url))
const repositoryRootPath = path.join(scriptDirectoryPath, '..')
const sharedPackagePath = path.join(repositoryRootPath, 'shared')
const installedSharedPackagePath = path.join(process.cwd(), 'node_modules', '@zoltar', 'shared')
const mode = process.argv.includes('--refresh') ? 'refresh' : 'check'

const readPackageJson = async packagePath => JSON.parse(await fs.readFile(packagePath, 'utf8'))

const listFilesRecursively = async directoryPath => {
	const entries = await fs.readdir(directoryPath, { withFileTypes: true })
	const filePaths = await Promise.all(
		entries.map(async entry => {
			const entryPath = path.join(directoryPath, entry.name)
			if (entry.isDirectory()) return await listFilesRecursively(entryPath)
			if (!entry.isFile()) return []
			return [entryPath]
		}),
	)
	return filePaths.flat().sort()
}

const hashFile = async filePath =>
	createHash('sha256')
		.update(await fs.readFile(filePath))
		.digest('hex')

const getPublishedSharedFiles = async () => {
	const sharedPackageJson = await readPackageJson(path.join(sharedPackagePath, 'package.json'))
	const publishedDirectories = Array.isArray(sharedPackageJson.files) ? sharedPackageJson.files : []
	const publishedFiles = await Promise.all(
		publishedDirectories.map(async directoryName => {
			const directoryPath = path.join(sharedPackagePath, directoryName)
			return await listFilesRecursively(directoryPath)
		}),
	)
	return [path.join(sharedPackagePath, 'package.json'), ...publishedFiles.flat()].sort()
}

const getSharedPackageManifest = async packageRootPath => {
	const files = await getPublishedSharedFiles()
	return await Promise.all(
		files.map(async sourcePath => {
			const relativePath = path.relative(sharedPackagePath, sourcePath)
			return {
				hash: await hashFile(path.join(packageRootPath, relativePath)),
				relativePath,
			}
		}),
	)
}

const manifestsMatch = async () => {
	try {
		const [sourceManifest, installedManifest] = await Promise.all([getSharedPackageManifest(sharedPackagePath), getSharedPackageManifest(installedSharedPackagePath)])
		if (sourceManifest.length !== installedManifest.length) return false
		return sourceManifest.every((sourceEntry, index) => {
			const installedEntry = installedManifest[index]
			return installedEntry !== undefined && sourceEntry.relativePath === installedEntry.relativePath && sourceEntry.hash === installedEntry.hash
		})
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
		throw error
	}
}

const copyCurrentSharedPackageInstall = async () => {
	if (path.resolve(installedSharedPackagePath) === path.resolve(sharedPackagePath)) return
	await fs.rm(installedSharedPackagePath, { force: true, recursive: true })
	const files = await getPublishedSharedFiles()
	for (const sourcePath of files) {
		const relativePath = path.relative(sharedPackagePath, sourcePath)
		const destinationPath = path.join(installedSharedPackagePath, relativePath)
		await fs.mkdir(path.dirname(destinationPath), { recursive: true })
		await fs.copyFile(sourcePath, destinationPath)
	}
}

const refreshSharedPackageInstall = async () => {
	console.warn(`Refreshing stale @zoltar/shared install in ${process.cwd()}`)
	const result = spawnSync('bun', ['install', '--frozen-lockfile'], {
		cwd: process.cwd(),
		stdio: 'inherit',
	})
	if (result.status !== 0) process.exit(result.status ?? 1)
	await copyCurrentSharedPackageInstall()
}

if (!(await manifestsMatch())) {
	if (mode === 'check') {
		throw new Error(`Installed @zoltar/shared package in ${process.cwd()} does not match ${sharedPackagePath}. Run 'bun install --frozen-lockfile' in ${process.cwd()} to refresh it.`)
	}
	await refreshSharedPackageInstall()
	if (!(await manifestsMatch())) {
		throw new Error(`Installed @zoltar/shared package in ${process.cwd()} still does not match ${sharedPackagePath} after reinstall`)
	}
}
