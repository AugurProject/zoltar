import * as path from 'node:path'
import { promises as fs } from 'node:fs'
import { getUiAppContractProject, getUiAppPaths, parseUiAppIdFromProcess } from './appPaths.mts'
import { resolveBundlerSpecifierPath } from './bundlerPaths.mts'
import { copyProjectArtifacts } from './projectArtifacts.mts'

type FileType = 'file' | 'directory'
type VendorBuildSteps = {
	readonly clearVendorOutput: () => Promise<void>
	readonly vendorDependencies: () => Promise<void>
	readonly vendorFonts: () => Promise<void>
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

function getVendorOutputPath() {
	return path.join(getUiAppPaths(parseUiAppIdFromProcess('vendor build')).appRoot, 'vendor')
}

type Dependency = { packageName: string; mainEntrypointFile: string }
const dependencyPaths: Dependency[] = [
	{ packageName: 'preact', mainEntrypointFile: 'preact.module.js' },
	{ packageName: 'preact/jsx-runtime', mainEntrypointFile: 'jsxRuntime.module.js' },
	{ packageName: 'preact/hooks', mainEntrypointFile: 'hooks.module.js' },
	{ packageName: '@preact/signals', mainEntrypointFile: 'signals.module.js' },
	{ packageName: '@preact/signals-core', mainEntrypointFile: 'signals-core.module.js' },
	{ packageName: '@noble/hashes', mainEntrypointFile: 'index.js' },
	{ packageName: '@noble/curves', mainEntrypointFile: 'index.js' },
	{ packageName: '@scure/base', mainEntrypointFile: 'index.js' },
	{ packageName: 'micro-eth-signer', mainEntrypointFile: 'index.js' },
	{ packageName: 'micro-packed', mainEntrypointFile: 'index.js' },
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

// The shared stylesheet references its fonts relative to ui/coreShared/css, so the woff2 files are vendored next to it
// (ui/coreShared/vendor/fonts) rather than into the app vendor directory; the production build copies the same
// font files beside its css output so the relative URL resolves in both layouts.
const vendoredFontFiles: readonly { readonly specifier: string; readonly fileName: string }[] = [
	{ specifier: '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2', fileName: 'ibm-plex-mono-latin-400-normal.woff2' },
	{ specifier: '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2', fileName: 'ibm-plex-mono-latin-600-normal.woff2' },
]

function getVendoredFontsPath(appId = parseUiAppIdFromProcess('vendor build')) {
	return path.join(getUiAppPaths(appId).coreSharedRoot, 'vendor', 'fonts')
}

export async function vendorFonts(fontsOutputPath = getVendoredFontsPath()) {
	await fs.mkdir(fontsOutputPath, { recursive: true })
	for (const { specifier, fileName } of vendoredFontFiles) {
		await fs.copyFile(resolveBundlerSpecifierPath(specifier), path.join(fontsOutputPath, fileName))
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

function createDefaultVendorBuildSteps(): VendorBuildSteps {
	return {
		clearVendorOutput,
		vendorDependencies,
		vendorFonts,
		copyProjectArtifacts: async () => {
			const app = parseUiAppIdFromProcess('vendor build')
			const project = getUiAppContractProject(app)
			await copyProjectArtifacts({ project, includeTrading: app === 'trading' })
		},
	}
}

export async function vendor(steps: VendorBuildSteps = createDefaultVendorBuildSteps(), artifactsAreCurrent = false) {
	await steps.clearVendorOutput()
	await steps.vendorDependencies()
	await steps.vendorFonts()
	if (!artifactsAreCurrent) await steps.copyProjectArtifacts()
}

export async function clearVendorOutput(vendorOutputPath = getVendorOutputPath()) {
	await fs.rm(vendorOutputPath, { recursive: true, force: true })
}

/** Builds that already projected artifacts can reuse them. Standalone vendoring projects them for its app. */
export function assertVendorCommandArguments(args: readonly string[]) {
	if (args.length > 2 || (args.length === 2 && args[1] !== '--artifacts-current')) throw new Error(`Unexpected vendor build argument(s): ${args.slice(1).join(' ')}`)
	const [first] = args
	if (first?.startsWith('-') === true) throw new Error(`The vendor build accepts only an app ID; unexpected option: ${first}`)
}

if (import.meta.main) {
	assertVendorCommandArguments(process.argv.slice(2))
	vendor(undefined, process.argv[3] === '--artifacts-current').catch(error => {
		console.error(error)
		process.exit(1)
	})
}
