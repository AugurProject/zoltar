import * as path from 'path'
import { promises as fs } from 'fs'
import { fileURLToPath } from 'node:url'
import { getUiAppPaths, parseUiAppIdFromProcess } from './appPaths.mts'
import { normalizeBundlerPath, resolveBundlerSpecifierPath } from './bundlerPaths.mts'
type FileType = 'file' | 'directory'
type VendorBuildSteps = {
	readonly clearVendorOutput: () => Promise<void>
	readonly bundleTevm: () => Promise<void>
	readonly vendorDependencies: () => Promise<void>
	readonly copyProjectArtifacts: () => Promise<void>
}

async function recursiveDirectoryCopy(source: string, destination: string, inclusionPredicate: (path: string, fileType: FileType) => boolean | Promise<boolean>, rewriteCallback?: (sourcePath: string, destinationPath: string) => Promise<void>): Promise<void> {
	await fs.mkdir(destination, { recursive: true })
	const entries = await fs.readdir(source, { withFileTypes: true })
	for (const entry of entries) {
		const sourcePath = path.join(source, entry.name)
		const destinationPath = path.join(destination, entry.name)
		if (entry.isDirectory()) {
			if (await inclusionPredicate(sourcePath, 'directory')) {
				await recursiveDirectoryCopy(sourcePath, destinationPath, inclusionPredicate, rewriteCallback)
			}
		} else if (entry.isFile()) {
			if (await inclusionPredicate(sourcePath, 'file')) {
				await fs.copyFile(sourcePath, destinationPath)
				if (rewriteCallback) await rewriteCallback(sourcePath, destinationPath)
			}
		}
	}
}
import { copyProjectArtifacts, defaultProjectArtifactPaths } from './projectArtifacts.mts'

function getVendorOutputPath() {
	return path.join(getUiAppPaths(parseUiAppIdFromProcess('vendor build')).appRoot, 'vendor')
}

type Dependency = { packageName: string; mainEntrypointFile: string }
const dependencyPaths: Dependency[] = [
	{ packageName: 'preact', mainEntrypointFile: 'preact.module.js' },
	{ packageName: 'preact/jsx-runtime', mainEntrypointFile: 'jsxRuntime.module.js' },
	{ packageName: 'preact/hooks', mainEntrypointFile: 'hooks.module.js' },
	{ packageName: 'preact/compat', mainEntrypointFile: 'compat.module.js' },
	{ packageName: '@preact/signals', mainEntrypointFile: 'signals.module.js' },
	{ packageName: '@preact/signals-core', mainEntrypointFile: 'signals-core.module.js' },
	{ packageName: 'abitype', mainEntrypointFile: 'exports/index.js' },
	{ packageName: '@noble/hashes', mainEntrypointFile: 'index.js' },
	{ packageName: '@noble/curves', mainEntrypointFile: 'index.js' },
	{ packageName: '@scure/base', mainEntrypointFile: 'index.js' },
	{ packageName: 'isows', mainEntrypointFile: 'native.js' },
	{ packageName: 'micro-eth-signer', mainEntrypointFile: 'index.js' },
	{ packageName: 'micro-packed', mainEntrypointFile: 'index.js' },
	{ packageName: 'ox', mainEntrypointFile: 'index.js' },
]

async function vendorDependencies(vendorOutputPath = getVendorOutputPath()) {
	async function inclusionPredicate(path: string, fileType: FileType) {
		if (path.endsWith('.js')) return true
		if (path.endsWith('.ts')) return true
		if (path.endsWith('.mjs')) return true
		if (path.endsWith('.mts')) return true
		if (path.endsWith('.map')) return true
		if (path.endsWith('.git') || path.endsWith('.git/') || path.endsWith('.git\\')) return false
		if (path.endsWith('node_modules') || path.endsWith('node_modules/') || path.endsWith('node_modules\\')) return false
		if (fileType === 'directory') return true
		return false
	}
	for (const { packageName, mainEntrypointFile } of dependencyPaths) {
		const resolvedEntrypointPath = resolveBundlerSpecifierPath(packageName)
		let sourceDirectoryPath = path.dirname(resolvedEntrypointPath)
		const mainEntrypointSegments = mainEntrypointFile.split('/').length
		for (let segmentIndex = 1; segmentIndex < mainEntrypointSegments; segmentIndex++) {
			sourceDirectoryPath = path.dirname(sourceDirectoryPath)
		}
		const destinationDirectoryPath = path.join(vendorOutputPath, packageName)
		await recursiveDirectoryCopy(sourceDirectoryPath, destinationDirectoryPath, inclusionPredicate, rewriteSourceMapSourcePath.bind(undefined, packageName))
	}
}

// rewrite the source paths in sourcemap files so they show up in the debugger in a reasonable location and if two source maps refer to the same (relative) path, we end up with them distinguished in the browser debugger
async function rewriteSourceMapSourcePath(packageName: string, sourcePath: string, destinationPath: string) {
	const fileExtension = path.extname(sourcePath)
	if (fileExtension !== '.map') return
	const fileContents = JSON.parse(await fs.readFile(sourcePath, 'utf-8')) as { sources: Array<string> }
	for (let i = 0; i < fileContents.sources.length; ++i) {
		const source = fileContents.sources[i]
		if (source === undefined) continue
		// we want to ensure all source files show up in the appropriate directory and don't leak out of our directory tree, so we strip leading '../' references
		const cleanSourcePath = source.replace(/^(?:\.\/)*/, '').replace(/^(?:\.\.\/)*/, '')
		fileContents.sources[i] = ['dependencies://dependencies', packageName, cleanSourcePath].join('/')
	}
	await fs.writeFile(destinationPath, JSON.stringify(fileContents))
}

type BuildResult = {
	readonly success: boolean
	readonly logs: readonly { readonly message: string }[]
}

export function assertSuccessfulBuilds(results: readonly BuildResult[], label: string) {
	const failures = results.filter(result => !result.success)
	if (failures.length === 0) return
	const messages = failures.flatMap(result => result.logs.map(log => log.message))
	throw new Error(`${label} failed${messages.length === 0 ? '' : `:\n${messages.join('\n')}`}`)
}

async function bundleTevm(vendorOutputPath = getVendorOutputPath()) {
	const tevmOutRoot = path.join(vendorOutputPath, 'tevm')
	const results = await Promise.all([
		Bun.build({
			entrypoints: [resolveBundlerSpecifierPath('@tevm/memory-client')],
			naming: { entry: 'index.js' },
			outdir: tevmOutRoot,
			target: 'browser',
			sourcemap: 'linked',
		}),
		Bun.build({
			entrypoints: [resolveBundlerSpecifierPath('@tevm/common')],
			naming: { entry: 'index.js' },
			outdir: normalizeBundlerPath(path.join(tevmOutRoot, 'common')),
			target: 'browser',
			sourcemap: 'linked',
		}),
	])
	assertSuccessfulBuilds(results, 'TEVM vendor bundle')
}

function createDefaultVendorBuildSteps(): VendorBuildSteps {
	return {
		clearVendorOutput,
		bundleTevm,
		vendorDependencies,
		copyProjectArtifacts: async () => {
			const app = parseUiAppIdFromProcess('vendor build')
			const { repositoryRoot } = getUiAppPaths(app)
			const scopedPath = path.join(repositoryRoot, 'solidity/artifacts', app, 'Contracts.json')
			const useScoped = process.argv.includes('--scoped-artifacts')
			await copyProjectArtifacts({ project: app, includeTrading: app === 'trading' }, useScoped ? { ...defaultProjectArtifactPaths, contractArtifactsJsonPath: scopedPath } : defaultProjectArtifactPaths)
		},
	}
}

export async function vendor(steps: VendorBuildSteps = createDefaultVendorBuildSteps()) {
	await steps.clearVendorOutput()
	await steps.bundleTevm()
	await steps.vendorDependencies()
	await steps.copyProjectArtifacts()
}

export async function clearVendorOutput(vendorOutputPath = getVendorOutputPath()) {
	await fs.rm(vendorOutputPath, { recursive: true, force: true })
}

const currentScriptPath = fileURLToPath(import.meta.url)
const invokedScriptPath = process.argv[1]

if (invokedScriptPath !== undefined && path.resolve(invokedScriptPath) === currentScriptPath) {
	vendor().catch(error => {
		console.error(error)
		debugger
		process.exit(1)
	})
}
