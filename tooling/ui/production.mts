import { promises as fs } from 'fs'
import * as path from 'path'
import * as process from 'node:process'
import { normalizeBundlerPath, resolveBundlerSpecifierPath } from './bundlerPaths.mts'
import { featureStylesheets, parseUiAppIdFromProcess, getUiAppPaths, type UiAppPaths } from './appPaths.mts'
import { createTevmBufferImportPlugin } from './tevmBufferImport.mts'
import { getVendoredFontsPath, vendoredFontFiles } from './vendor.mts'

const appId = parseUiAppIdFromProcess('the production build')
const paths = getUiAppPaths(appId)

// Bun records source paths relative to the current working directory in bundle
// comments and source maps. Normalize it so root and package scripts produce
// byte-identical deployable artifacts.
process.chdir(paths.appRoot)

const WORKER_BANNER = `
const process = globalThis.process ?? {
	env: {},
	nextTick(callback, ...args) {
		queueMicrotask(() => {
			callback(...args)
		})
	},
	stderr: undefined,
	stdout: undefined,
}
globalThis.process ??= process
globalThis.global ??= globalThis
`.trim()

const APP_TITLES: Record<string, string> = {
	zoltar: 'Zoltar',
	statoblast: 'Augur Statoblast',
	trading: 'Statoblast trading',
}

function createBrowserVendorAliasPlugin() {
	const aliasEntries: Array<[RegExp, string]> = [
		[/^pino$/, resolveBundlerSpecifierPath('pino/browser.js')],
		[/^@tevm\/memory-client$/, resolveBundlerSpecifierPath('@tevm/memory-client')],
		[/^@tevm\/common$/, resolveBundlerSpecifierPath('@tevm/common')],
	]
	type BrowserVendorBuild = {
		onResolve(options: { filter: RegExp }, callback: (args: { path: string }) => { path: string }): void
	}

	return {
		name: 'browser-vendor-alias',
		setup(build: BrowserVendorBuild) {
			for (const [filter, resolvedPath] of aliasEntries) {
				build.onResolve({ filter }, () => ({ path: resolvedPath }))
			}
		},
	}
}

export const coreSharedStylesheets = ['index.css', 'tokens.css', 'base.css', 'simulation-banner.css', 'protocol-surfaces.css', 'application-surfaces.css', 'controls-and-responsive.css', 'visual-foundation.css', 'protocol-apps.css'] as const

const featureStylesheetSources: Record<string, (paths: UiAppPaths) => string> = {
	'zoltar-shared.css': paths => path.join(paths.uiRoot, 'zoltarShared', 'css', 'index.css'),
	'statoblast-shared.css': paths => path.join(paths.uiRoot, 'statoblastShared', 'css', 'index.css'),
	'app.css': paths => path.join(paths.appRoot, 'css', 'app.css'),
}

async function copyStaticAsset(sourcePath: string, destinationPath: string) {
	await fs.mkdir(path.dirname(destinationPath), { recursive: true })
	const sourceFile = Bun.file(sourcePath)
	if (!(await sourceFile.exists())) {
		throw new Error(`Missing static asset: ${sourcePath}`)
	}
	await Bun.write(destinationPath, await sourceFile.arrayBuffer())
}

function assertBuildSucceeded(label: string, result: { success: boolean; logs: Array<unknown> }) {
	if (result.success) return
	const messages = result.logs.map(log => (typeof log === 'object' && log !== null && 'message' in log ? String(log.message) : String(log))).join('\n')
	throw new Error(`${label} failed for ${appId}\n${messages}`)
}

async function writeProductionIndexHtml(paths: UiAppPaths) {
	const templatePath = path.join(import.meta.dir, 'index.production.html')
	let html = await fs.readFile(templatePath, 'utf8')
	const appTitle = APP_TITLES[appId]
	if (appTitle === undefined) throw new Error(`No production title recorded for ${appId}`)
	html = html.replace('<html lang="en">', `<html lang="en" data-product="${appId}">`)
	html = html.replace('Zoltar + Augur Statoblast', appTitle)
	const featureStylesheetLinks = featureStylesheets[appId].map(stylesheet => `\n\t\t<link rel="stylesheet" href="./css/${stylesheet}" />`).join('')
	html = html.replace('<link rel="stylesheet" href="./css/index.css" />', `<link rel="stylesheet" href="./css/index.css" />${featureStylesheetLinks}`)
	await fs.mkdir(paths.appDistRoot, { recursive: true })
	await fs.writeFile(path.join(paths.appDistRoot, 'index.html'), html)
}

async function buildProductionApp(paths: UiAppPaths) {
	const result = await Bun.build({
		entrypoints: [normalizeBundlerPath(paths.appEntrypoint)],
		naming: {
			entry: 'app.js',
			chunk: 'chunks/[name]-[hash].js',
		},
		outdir: paths.appDistAssetsRoot,
		plugins: [createBrowserVendorAliasPlugin()],
		target: 'browser',
		sourcemap: 'linked',
	})
	assertBuildSucceeded('Production application bundle', result)
}

async function buildProductionWorker(paths: UiAppPaths) {
	const result = await Bun.build({
		banner: WORKER_BANNER,
		entrypoints: [normalizeBundlerPath(paths.workerEntrypoint)],
		naming: { entry: 'tevmWorker.worker.js' },
		outdir: paths.appDistAssetsRoot,
		plugins: [createBrowserVendorAliasPlugin(), createTevmBufferImportPlugin()],
		target: 'browser',
		sourcemap: 'linked',
	})
	assertBuildSucceeded('Production worker bundle', result)
}

export async function buildProductionBundle() {
	await fs.rm(paths.appDistRoot, { recursive: true, force: true })
	await fs.mkdir(paths.appDistAssetsRoot, { recursive: true })

	await Promise.all([
		buildProductionApp(paths),
		buildProductionWorker(paths),
		writeProductionIndexHtml(paths),
		...coreSharedStylesheets.map(stylesheet => copyStaticAsset(path.join(paths.coreSharedCssRoot, stylesheet), path.join(paths.appDistRoot, 'css', stylesheet))),
		...featureStylesheets[appId].map(stylesheet => {
			const resolveSource = featureStylesheetSources[stylesheet]
			if (resolveSource === undefined) throw new Error(`No source recorded for feature stylesheet ${stylesheet}`)
			return copyStaticAsset(resolveSource(paths), path.join(paths.appDistRoot, 'css', stylesheet))
		}),
		// The shared stylesheet resolves its fonts at ../vendor/fonts, so the vendored files sit beside css/ in the dist output too.
		...vendoredFontFiles.map(({ fileName }) => copyStaticAsset(path.join(getVendoredFontsPath(appId), fileName), path.join(paths.appDistRoot, 'vendor', 'fonts', fileName))),
		copyStaticAsset(paths.faviconSvg, path.join(paths.appDistRoot, 'favicon.svg')),
		...(appId === 'trading'
			? [
					import(path.join(paths.appRoot, 'build', 'core-deployments.mts')).then(async module => {
						const writer = module['writeCoreDeploymentRegistry']
						if (typeof writer !== 'function') throw new Error('Trading core deployment registry writer is missing')
						await writer(path.join(paths.appDistRoot, 'core-deployments.json'))
					}),
				]
			: []),
	])
}

buildProductionBundle().catch(error => {
	console.error(error)
	process.exit(1)
})
