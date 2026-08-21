import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as url from 'node:url'

export const uiPackageIds = ['coreShared', 'zoltar', 'statoblast', 'trading'] as const
export const preactSingletonDependencyPaths = ['preact', '@preact/signals', '@preact/signals-core'] as const

const scriptDirectoryPath = path.dirname(url.fileURLToPath(import.meta.url))
const repositoryRootPath = path.join(scriptDirectoryPath, '..')

const isMissingPathError = (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ENOENT'

async function ensureDirectory(directoryPath: string) {
	const stat = await fs.stat(directoryPath).catch(error => {
		if (isMissingPathError(error)) return undefined
		throw error
	})
	if (!stat?.isDirectory()) throw new Error(`Required dependency directory is missing: ${directoryPath}`)
}

export async function ensureUiPreactSingleton(rootPath = repositoryRootPath) {
	for (const dependencyPath of preactSingletonDependencyPaths) {
		const sharedDependencyPath = path.join(rootPath, 'node_modules', dependencyPath)
		await ensureDirectory(sharedDependencyPath)
		const canonicalSharedDependencyPath = await fs.realpath(sharedDependencyPath)

		for (const packageId of uiPackageIds) {
			const packageDependencyPath = path.join(rootPath, 'ui', packageId, 'node_modules', dependencyPath)
			const currentTarget = await fs.realpath(packageDependencyPath).catch(error => {
				if (isMissingPathError(error)) return undefined
				throw error
			})
			if (currentTarget === canonicalSharedDependencyPath) continue

			await fs.rm(packageDependencyPath, { force: true, recursive: true })
			await fs.mkdir(path.dirname(packageDependencyPath), { recursive: true })
			const linkTarget = process.platform === 'win32' ? sharedDependencyPath : path.relative(path.dirname(packageDependencyPath), sharedDependencyPath)
			await fs.symlink(linkTarget, packageDependencyPath, process.platform === 'win32' ? 'junction' : 'dir')
		}
	}
}

if (import.meta.main) await ensureUiPreactSingleton()
