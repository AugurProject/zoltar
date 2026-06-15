import { promises as fs } from 'fs'
import * as path from 'path'
import * as process from 'node:process'
import * as url from 'node:url'

const directoryOfThisFile = path.dirname(url.fileURLToPath(import.meta.url))
const UI_ROOT_PATH = path.join(directoryOfThisFile, '..')
const DIST_ROOT_PATH = path.join(UI_ROOT_PATH, 'dist')
const DIST_ASSETS_PATH = path.join(DIST_ROOT_PATH, 'assets')
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

async function copyStaticAsset(sourcePath: string, destinationPath: string) {
	await fs.mkdir(path.dirname(destinationPath), { recursive: true })
	await fs.copyFile(sourcePath, destinationPath)
}

async function writeProductionIndexHtml() {
	const templatePath = path.join(UI_ROOT_PATH, 'build', 'index.production.html')
	const html = await fs.readFile(templatePath, 'utf8')
	await fs.mkdir(DIST_ROOT_PATH, { recursive: true })
	await fs.writeFile(path.join(DIST_ROOT_PATH, 'index.html'), html)
}

async function buildProductionApp() {
	await Bun.build({
		entrypoints: [path.join(UI_ROOT_PATH, 'ts', 'index.ts')],
		naming: {
			entry: 'app.js',
			chunk: 'chunks/[name]-[hash].js',
		},
		outdir: DIST_ASSETS_PATH,
		target: 'browser',
		sourcemap: 'linked',
	})
}

async function buildProductionWorker() {
	const result = await Bun.build({
		entrypoints: [path.join(UI_ROOT_PATH, 'ts', 'simulation', 'tevmWorker.ts')],
		naming: { entry: 'tevmWorker.worker.js' },
		outdir: DIST_ASSETS_PATH,
		target: 'browser',
		sourcemap: 'linked',
	})
	for (const output of result.outputs) {
		if (output.path.endsWith('.js')) {
			const originalCode = await output.text()
			await Bun.write(output.path, WORKER_BANNER + '\n' + originalCode)
		}
	}
}

export async function buildProductionBundle() {
	await fs.rm(DIST_ROOT_PATH, { recursive: true, force: true })
	await fs.mkdir(DIST_ASSETS_PATH, { recursive: true })

	await Promise.all([
		buildProductionApp(),
		buildProductionWorker(),
		writeProductionIndexHtml(),
		copyStaticAsset(path.join(UI_ROOT_PATH, 'css', 'index.css'), path.join(DIST_ROOT_PATH, 'css', 'index.css')),
		copyStaticAsset(path.join(UI_ROOT_PATH, 'favicon.ico'), path.join(DIST_ROOT_PATH, 'favicon.ico')),
		copyStaticAsset(path.join(UI_ROOT_PATH, 'favicon.svg'), path.join(DIST_ROOT_PATH, 'favicon.svg')),
	])
}

buildProductionBundle().catch(error => {
	console.error(error)
	process.exit(1)
})
