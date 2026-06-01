import { promises as fs } from 'fs'
import * as path from 'path'
import * as process from 'node:process'
import * as url from 'node:url'
import esbuild from 'esbuild'

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

const sharedBuildOptions = {
	bundle: true,
	format: 'esm' as const,
	keepNames: true,
	minify: false,
	platform: 'browser' as const,
	sourcemap: true,
	sourcesContent: true,
	target: 'esnext',
}

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
	await esbuild.build({
		...sharedBuildOptions,
		chunkNames: 'chunks/[name]-[hash]',
		entryNames: 'app',
		entryPoints: [path.join(UI_ROOT_PATH, 'ts', 'index.ts')],
		outdir: DIST_ASSETS_PATH,
		splitting: false,
	})
}

async function buildProductionWorker() {
	await esbuild.build({
		...sharedBuildOptions,
		banner: {
			js: WORKER_BANNER,
		},
		entryPoints: [path.join(UI_ROOT_PATH, 'ts', 'simulation', 'tevmWorker.ts')],
		outfile: path.join(DIST_ASSETS_PATH, 'tevmWorker.worker.js'),
	})
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
