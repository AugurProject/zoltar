import * as path from 'path'
import * as url from 'url'
import { promises as fs } from 'fs'
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
import { copyProjectArtifacts } from './projectArtifacts.mts'

const directoryOfThisFile = path.dirname(url.fileURLToPath(import.meta.url))
const UI_ROOT_PATH = path.join(directoryOfThisFile, '..')
const VENDOR_OUTPUT_PATH = path.join(UI_ROOT_PATH, 'vendor')

type Dependency = { packageName: string; packageToVendor?: string; subfolderToVendor: string; mainEntrypointFile: string; alternateEntrypoints: Record<string, string> }
const dependencyPaths: Dependency[] = [
	{ packageName: 'preact', subfolderToVendor: 'dist', mainEntrypointFile: 'preact.module.js', alternateEntrypoints: {} },
	{ packageName: 'preact/jsx-runtime', subfolderToVendor: 'dist', mainEntrypointFile: 'jsxRuntime.module.js', alternateEntrypoints: {} },
	{ packageName: 'preact/hooks', subfolderToVendor: 'dist', mainEntrypointFile: 'hooks.module.js', alternateEntrypoints: {} },
	{ packageName: '@preact/signals', subfolderToVendor: 'dist', mainEntrypointFile: 'signals.module.js', alternateEntrypoints: {} },
	{ packageName: '@preact/signals-core', subfolderToVendor: 'dist', mainEntrypointFile: 'signals-core.module.js', alternateEntrypoints: {} },
	{ packageName: 'abitype', subfolderToVendor: 'dist/esm', mainEntrypointFile: 'exports/index.js', alternateEntrypoints: {} },
	{ packageName: '@noble/hashes', subfolderToVendor: '', mainEntrypointFile: 'index.js', alternateEntrypoints: { webcrypto: 'webcrypto.js', sha3: 'sha3.js', utils: 'utils.js', _assert: 'utils.js', sha256: 'sha2.js', sha512: 'sha2.js', pbkdf2: 'pbkdf2.js', hmac: 'hmac.js', ripemd160: 'legacy.js' } },
	{ packageName: '@noble/curves', subfolderToVendor: '', mainEntrypointFile: 'index.js', alternateEntrypoints: { secp256k1: 'secp256k1.js', p256: 'nist.js', p384: 'nist.js', p521: 'nist.js', 'abstract/modular': 'abstract/modular.js', 'abstract/utils': 'utils.js', utils: 'utils.js' } },
	{ packageName: '@scure/base', subfolderToVendor: '', mainEntrypointFile: 'index.js', alternateEntrypoints: {} },
	{ packageName: 'funtypes', subfolderToVendor: 'lib', mainEntrypointFile: 'index.mjs', alternateEntrypoints: {} },
	{ packageName: 'isows', subfolderToVendor: '_esm', mainEntrypointFile: 'native.js', alternateEntrypoints: {} },
	{ packageName: 'micro-eth-signer', subfolderToVendor: '', mainEntrypointFile: 'index.js', alternateEntrypoints: {} },
	{ packageName: 'micro-packed', subfolderToVendor: '', mainEntrypointFile: 'index.js', alternateEntrypoints: {} },
	{ packageName: 'ox', subfolderToVendor: '_esm', mainEntrypointFile: 'index.js', alternateEntrypoints: { BlockOverrides: 'core/BlockOverrides.js', AbiConstructor: 'core/AbiConstructor.js', AbiFunction: 'core/AbiFunction.js' } },
]

async function vendorDependencies() {
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
	for (const { packageName, packageToVendor, mainEntrypointFile } of dependencyPaths) {
		const resolvedEntrypointPath = resolveBundlerSpecifierPath(packageName)
		let sourceDirectoryPath = path.dirname(resolvedEntrypointPath)
		const mainEntrypointSegments = mainEntrypointFile.split('/').length
		for (let segmentIndex = 1; segmentIndex < mainEntrypointSegments; segmentIndex++) {
			sourceDirectoryPath = path.dirname(sourceDirectoryPath)
		}
		const destinationDirectoryPath = path.join(VENDOR_OUTPUT_PATH, packageToVendor || packageName)
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

async function bundleTevm() {
	const tevmOutRoot = path.join(VENDOR_OUTPUT_PATH, 'tevm')
	await Promise.all([
		Bun.build({
			entrypoints: [resolveBundlerSpecifierPath('tevm')],
			naming: { entry: 'index.js' },
			outdir: tevmOutRoot,
			target: 'browser',
			sourcemap: 'linked',
		}),
		Bun.build({
			entrypoints: [resolveBundlerSpecifierPath('tevm/common')],
			naming: { entry: 'index.js' },
			outdir: normalizeBundlerPath(path.join(tevmOutRoot, 'common')),
			target: 'browser',
			sourcemap: 'linked',
		}),
	])
}

const defaultVendorBuildSteps: VendorBuildSteps = {
	clearVendorOutput,
	bundleTevm,
	vendorDependencies,
	copyProjectArtifacts,
}

export async function vendor(steps: VendorBuildSteps = defaultVendorBuildSteps) {
	await steps.clearVendorOutput()
	await steps.bundleTevm()
	await steps.vendorDependencies()
	await steps.copyProjectArtifacts()
}

export async function clearVendorOutput(vendorOutputPath = VENDOR_OUTPUT_PATH) {
	await fs.rm(vendorOutputPath, { recursive: true, force: true })
}

const currentScriptPath = url.fileURLToPath(import.meta.url)
const invokedScriptPath = process.argv[1]

if (invokedScriptPath !== undefined && path.resolve(invokedScriptPath) === currentScriptPath) {
	vendor().catch(error => {
		console.error(error)
		debugger
		process.exit(1)
	})
}
