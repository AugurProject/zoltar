import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as url from 'node:url'

const scriptDirectoryPath = path.dirname(url.fileURLToPath(import.meta.url))
const repositoryRootPath = path.join(scriptDirectoryPath, '..')
const sharedPackagePath = path.join(repositoryRootPath, 'shared')
const installedSharedPackagePath = path.join(process.cwd(), 'node_modules', '@zoltar', 'shared')
const mode = process.argv.includes('--refresh') ? 'refresh' : 'check'

const readPackageJson = async packagePath => JSON.parse(await fs.readFile(packagePath, 'utf8'))

const isMissingPathError = error => error instanceof Error && 'code' in error && error.code === 'ENOENT'

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

const getSourceSharedPackageManifest = async () => {
	const files = await getPublishedSharedFiles()
	return await Promise.all(
		files.map(async sourcePath => ({
			hash: await hashFile(sourcePath),
			relativePath: path.relative(sharedPackagePath, sourcePath),
		})),
	)
}

const getInstalledSharedPackageManifest = async () => {
	const files = await listFilesRecursively(installedSharedPackagePath)
	return await Promise.all(
		files.map(async filePath => ({
			hash: await hashFile(filePath),
			relativePath: path.relative(installedSharedPackagePath, filePath),
		})),
	)
}

const ensureDirectory = async directoryPath => {
	let stat
	try {
		stat = await fs.lstat(directoryPath)
	} catch (error) {
		if (!isMissingPathError(error)) throw error
		stat = undefined
	}
	if (stat?.isDirectory()) return
	if (stat !== undefined) await fs.rm(directoryPath, { force: true, recursive: true })
	await fs.mkdir(directoryPath, { recursive: true })
}

const removeExtraInstalledFiles = async allowedRelativePaths => {
	let installedFiles
	try {
		installedFiles = await listFilesRecursively(installedSharedPackagePath)
	} catch (error) {
		if (isMissingPathError(error)) return
		throw error
	}
	for (const filePath of installedFiles) {
		const relativePath = path.relative(installedSharedPackagePath, filePath)
		if (allowedRelativePaths.has(relativePath)) continue
		await fs.rm(filePath, { force: true })
	}
}

const pruneEmptyDirectories = async directoryPath => {
	let entries
	try {
		entries = await fs.readdir(directoryPath, { withFileTypes: true })
	} catch (error) {
		if (isMissingPathError(error)) return
		throw error
	}

	for (const entry of entries) {
		if (!entry.isDirectory()) continue
		await pruneEmptyDirectories(path.join(directoryPath, entry.name))
	}

	if (path.resolve(directoryPath) === path.resolve(installedSharedPackagePath)) return

	const remainingEntries = await fs.readdir(directoryPath)
	if (remainingEntries.length === 0) {
		await fs.rmdir(directoryPath)
	}
}

const copyCurrentSharedPackageInstall = async () => {
	if (path.resolve(installedSharedPackagePath) === path.resolve(sharedPackagePath)) return
	const files = await getPublishedSharedFiles()
	const publishedRelativePaths = new Set(files.map(sourcePath => path.relative(sharedPackagePath, sourcePath)))
	await ensureDirectory(installedSharedPackagePath)
	await removeExtraInstalledFiles(publishedRelativePaths)
	for (const sourcePath of files) {
		const relativePath = path.relative(sharedPackagePath, sourcePath)
		const destinationPath = path.join(installedSharedPackagePath, relativePath)
		await ensureDirectory(path.dirname(destinationPath))
		let destinationStat
		try {
			destinationStat = await fs.lstat(destinationPath)
		} catch (error) {
			if (!isMissingPathError(error)) throw error
			destinationStat = undefined
		}
		if (destinationStat !== undefined && !destinationStat.isFile()) {
			await fs.rm(destinationPath, { force: true, recursive: true })
		}
		await fs.copyFile(sourcePath, destinationPath)
	}
	await pruneEmptyDirectories(installedSharedPackagePath)
}

const manifestsMatch = async () => {
	try {
		const [sourceManifest, installedManifest] = await Promise.all([getSourceSharedPackageManifest(), getInstalledSharedPackageManifest()])
		if (sourceManifest.length !== installedManifest.length) return false
		return sourceManifest.every((sourceEntry, index) => {
			const installedEntry = installedManifest[index]
			return installedEntry !== undefined && sourceEntry.relativePath === installedEntry.relativePath && sourceEntry.hash === installedEntry.hash
		})
	} catch (error) {
		if (isMissingPathError(error)) return false
		throw error
	}
}

const refreshSharedPackageInstall = async () => {
	console.warn(`Refreshing stale @zoltar/shared install in ${process.cwd()}`)
	await copyCurrentSharedPackageInstall()
}

if (!(await manifestsMatch())) {
	if (mode === 'check') {
		throw new Error(`Installed @zoltar/shared package in ${process.cwd()} does not match ${sharedPackagePath}. Run the shared dependency refresh for this workspace to sync it.`)
	}
	await refreshSharedPackageInstall()
	if (!(await manifestsMatch())) {
		throw new Error(`Installed @zoltar/shared package in ${process.cwd()} still does not match ${sharedPackagePath} after refresh`)
	}
}
