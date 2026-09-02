import { promises as fs } from 'fs'
import * as path from 'path'
import * as process from 'node:process'
import { normalizeBundlerPath, resolveBundlerSpecifierPath } from './bundlerPaths.mts'
import { parseUiAppIdFromProcess, getUiAppPaths, type UiAppPaths } from './appPaths.mts'

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
		[/^tevm$/, resolveBundlerSpecifierPath('@tevm/memory-client')],
		[/^tevm\/common$/, resolveBundlerSpecifierPath('@tevm/common')],
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
	const templatePath = path.join(paths.coreSharedRoot, 'build', 'index.production.html')
	let html = await fs.readFile(templatePath, 'utf8')
	const appTitle = APP_TITLES[appId]
	if (appTitle === undefined) throw new Error(`No production title recorded for ${appId}`)
	html = html.replace('Zoltar + Augur Statoblast', appTitle)
	if (appId === 'trading') html = html.replace('<link rel="stylesheet" href="./css/index.css" />', '<link rel="stylesheet" href="./css/index.css" />\n\t\t<link rel="stylesheet" href="./css/app.css" />')
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
	const BANNER_LINE_COUNT = WORKER_BANNER.split('\n').length

	const result = await Bun.build({
		entrypoints: [normalizeBundlerPath(paths.workerEntrypoint)],
		naming: { entry: 'tevmWorker.worker.js' },
		outdir: paths.appDistAssetsRoot,
		plugins: [createBrowserVendorAliasPlugin()],
		target: 'browser',
		sourcemap: 'linked',
	})
	assertBuildSucceeded('Production worker bundle', result)

	for (const output of result.outputs) {
		if (output.path.endsWith('.js')) {
			const originalCode = await output.text()
			await Bun.write(output.path, WORKER_BANNER + '\n' + originalCode)
		}
	}

	const { SourceMapConsumer, SourceMapGenerator } = await import('source-map')
	for (const output of result.outputs) {
		if (!output.path.endsWith('.js.map')) continue

		const rawMap = JSON.parse(await output.text()) as unknown as import('source-map').RawSourceMap
		const consumer = await new SourceMapConsumer(rawMap)
		const generator = new SourceMapGenerator(rawMap.file ? { file: rawMap.file } : {})

		for (let i = 0; i < rawMap.sources.length; i++) {
			const source = rawMap.sources[i]
			const content = rawMap.sourcesContent?.[i]
			if (source && content) generator.setSourceContent(source, content)
		}

		consumer.eachMapping(mapping => {
			if (!mapping.source) return

			generator.addMapping({
				source: mapping.source,
				original: { line: mapping.originalLine, column: mapping.originalColumn },
				generated: { line: mapping.generatedLine + BANNER_LINE_COUNT, column: mapping.generatedColumn },
				name: mapping.name ?? undefined,
			})
		})

		await fs.writeFile(output.path, generator.toString())
	}
}

export async function buildProductionBundle() {
	await fs.rm(paths.appDistRoot, { recursive: true, force: true })
	await fs.mkdir(paths.appDistAssetsRoot, { recursive: true })

	await Promise.all([
		buildProductionApp(paths),
		buildProductionWorker(paths),
		writeProductionIndexHtml(paths),
		copyStaticAsset(path.join(paths.coreSharedCssRoot, 'index.css'), path.join(paths.appDistRoot, 'css', 'index.css')),
		copyStaticAsset(path.join(paths.coreSharedCssRoot, 'tokens.css'), path.join(paths.appDistRoot, 'css', 'tokens.css')),
		...['base.css', 'protocol-surfaces.css', 'reporting-visualizations.css', 'application-surfaces.css', 'controls-and-responsive.css'].map(stylesheet => copyStaticAsset(path.join(paths.coreSharedCssRoot, stylesheet), path.join(paths.appDistRoot, 'css', stylesheet))),
		copyStaticAsset(paths.faviconSvg, path.join(paths.appDistRoot, 'favicon.svg')),
		...(appId === 'trading'
			? [
					copyStaticAsset(path.join(paths.appRoot, 'css', 'app.css'), path.join(paths.appDistRoot, 'css', 'app.css')),
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
