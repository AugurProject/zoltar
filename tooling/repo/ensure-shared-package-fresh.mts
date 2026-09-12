import { sharedPackages } from './sharedPackages.ts'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as url from 'node:url'

const scriptDirectoryPath = path.dirname(url.fileURLToPath(import.meta.url))
const repositoryRootPath = path.join(scriptDirectoryPath, '..', '..')
const mode = process.argv.includes('--refresh') ? 'refresh' : 'check'

interface PackageManifest {
	files: string[]
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const readPackageJson = async (packagePath: string): Promise<PackageManifest> => {
	const parsed: unknown = JSON.parse(await fs.readFile(packagePath, 'utf8'))
	if (!isRecord(parsed) || !Array.isArray(parsed['files']) || !parsed['files'].every((file): file is string => typeof file === 'string')) {
		throw new Error(`Package manifest ${packagePath} must contain a string files array`)
	}
	return { files: parsed['files'] }
}

const listFilesRecursively = async (directoryPath: string): Promise<string[]> => {
	const entries = await fs.readdir(directoryPath, { withFileTypes: true })
	const filePaths: string[][] = await Promise.all(
		entries.map(async entry => {
			const entryPath = path.join(directoryPath, entry.name)
			if (entry.isSymbolicLink()) return []
			if (entry.isDirectory()) return await listFilesRecursively(entryPath)
			if (!entry.isFile()) return []
			return [entryPath]
		}),
	)
	return filePaths.flat().sort()
}

const listPackageFilesRecursively = async (packageRootPath: string): Promise<string[]> => {
	const filePaths = await listFilesRecursively(packageRootPath)
	return filePaths.filter(filePath => {
		const relativePath = path.relative(packageRootPath, filePath)
		return !relativePath.split(path.sep).includes('node_modules')
	})
}

const hashFile = async (filePath: string): Promise<string> =>
	createHash('sha256')
		.update(await fs.readFile(filePath))
		.digest('hex')

const consumerManifest: unknown = JSON.parse(await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf8'))
if (!isRecord(consumerManifest)) throw new Error('Expected a package manifest object')
const consumerDependencies = consumerManifest['dependencies']
const consumerDevDependencies = consumerManifest['devDependencies']
for (const entry of sharedPackages) {
	if (!(isRecord(consumerDependencies) && entry.name in consumerDependencies) && !(isRecord(consumerDevDependencies) && entry.name in consumerDevDependencies)) continue
	const sharedPackagePath = path.join(repositoryRootPath, entry.path)
	const installedSharedPackagePath = path.join(process.cwd(), 'node_modules', entry.name)
	const installedSharedNodeModulesPath = path.join(installedSharedPackagePath, 'node_modules')
	const sourceSharedNodeModulesPath = path.join(sharedPackagePath, 'node_modules')
	try {
		if ((await fs.realpath(installedSharedPackagePath)) === (await fs.realpath(sharedPackagePath))) continue
	} catch (error) {
		if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
	}
	const getPublishedSharedFiles = async () => {
		const sharedPackageJson = await readPackageJson(path.join(sharedPackagePath, 'package.json'))
		const publishedDirectories = sharedPackageJson.files
		const publishedFiles = await Promise.all(
			publishedDirectories.map(async directoryName => {
				const directoryPath = path.join(sharedPackagePath, directoryName)
				return await listFilesRecursively(directoryPath)
			}),
		)
		return [path.join(sharedPackagePath, 'package.json'), ...publishedFiles.flat()].sort()
	}

	const getSharedPackageManifest = async (packageRootPath: string, files: readonly string[]): Promise<string[]> => {
		return await Promise.all(
			files.map(async sourcePath => {
				const relativePath = path.relative(sharedPackagePath, sourcePath)
				return await hashFile(path.join(packageRootPath, relativePath))
			}),
		)
	}

	const manifestsMatch = async () => {
		try {
			const sourceFiles = await getPublishedSharedFiles()
			const installedFiles = await listPackageFilesRecursively(installedSharedPackagePath)
			if (
				sourceFiles.map(filePath => path.relative(sharedPackagePath, filePath)).join('\n') !==
				installedFiles
					.map(filePath => path.relative(installedSharedPackagePath, filePath))
					.sort()
					.join('\n')
			)
				return false
			const [sourceManifest, installedManifest] = await Promise.all([getSharedPackageManifest(sharedPackagePath, sourceFiles), getSharedPackageManifest(installedSharedPackagePath, sourceFiles)])
			return sourceManifest.every((hash, index) => hash === installedManifest[index])
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

	const linkSharedPackageNodeModules = async () => {
		if (path.resolve(installedSharedPackagePath) === path.resolve(sharedPackagePath)) return
		try {
			const sourceNodeModulesStat = await fs.stat(sourceSharedNodeModulesPath)
			if (!sourceNodeModulesStat.isDirectory()) return
		} catch (error) {
			if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
			throw error
		}
		await fs.rm(installedSharedNodeModulesPath, { force: true, recursive: true })
		const relativeNodeModulesPath = path.relative(installedSharedPackagePath, sourceSharedNodeModulesPath)
		await fs.symlink(relativeNodeModulesPath, installedSharedNodeModulesPath, 'dir')
	}

	const refreshSharedPackageInstall = async () => {
		console.warn(`Refreshing stale ${entry.name} install in ${process.cwd()}`)
		await copyCurrentSharedPackageInstall()
		await linkSharedPackageNodeModules()
	}

	if (!(await manifestsMatch())) {
		if (mode === 'check') {
			throw new Error(`Installed ${entry.name} package in ${process.cwd()} does not match ${sharedPackagePath}. Run the shared dependency refresh for this workspace to sync it.`)
		}
		await refreshSharedPackageInstall()
		if (!(await manifestsMatch())) {
			throw new Error(`Installed ${entry.name} package in ${process.cwd()} still does not match ${sharedPackagePath} after reinstall`)
		}
	}
}
