import { afterAll, beforeAll, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as url from 'node:url'
import { buildProductionBundle } from './production.mts'

const directoryOfThisFile = path.dirname(url.fileURLToPath(import.meta.url))
const repositoryRootPath = path.join(directoryOfThisFile, '..', '..')
const distRootPath = path.join(repositoryRootPath, 'ui', 'dist')
const distAssetsPath = path.join(distRootPath, 'assets')
const appBundlePath = path.join(distAssetsPath, 'app.js')
const appSourceMapPath = path.join(distAssetsPath, 'app.js.map')
const workerBundlePath = path.join(distAssetsPath, 'tevmWorker.worker.js')
const workerSourceMapPath = path.join(distAssetsPath, 'tevmWorker.worker.js.map')
const productionIndexPath = path.join(distRootPath, 'index.html')
const productionCssPath = path.join(distRootPath, 'css', 'index.css')
const productionFaviconPaths = [path.join(distRootPath, 'favicon.ico'), path.join(distRootPath, 'favicon.svg')]

let server: Bun.Server | undefined

beforeAll(async () => {
	await buildProductionBundle()

	server = Bun.serve({
		fetch: async request => {
			const requestUrl = new URL(request.url)
			const relativePath = requestUrl.pathname === '/' ? 'index.html' : requestUrl.pathname.replace(/^\/+/, '')
			const filePath = path.join(distRootPath, relativePath)
			const file = Bun.file(filePath)
			if (!(await file.exists())) {
				return new Response('not found', { status: 404 })
			}
			return new Response(file)
		},
		port: 0,
	})
})

afterAll(() => {
	server?.stop(true)
})

test('production build emits the deployable artifact set', async () => {
	const expectedPaths = [productionIndexPath, productionCssPath, appBundlePath, appSourceMapPath, workerBundlePath, workerSourceMapPath, ...productionFaviconPaths]

	for (const expectedPath of expectedPaths) {
		await expect(fs.access(expectedPath)).resolves.toBeNull()
	}
})

test('production index html references the bundled app and does not use the dev import map', async () => {
	const html = await fs.readFile(productionIndexPath, 'utf8')

	expect(html).toContain("<script async type = 'module' src = './assets/app.js'></script>")
	expect(html).not.toContain('importmap')
	expect(html).not.toContain('./js/')
	expect(html).not.toContain('./vendor/')
})

test('production javascript is self-contained for deploys', async () => {
	const appBundle = await fs.readFile(appBundlePath, 'utf8')
	const workerBundle = await fs.readFile(workerBundlePath, 'utf8')
	const appSourceMap = JSON.parse(await fs.readFile(appSourceMapPath, 'utf8')) as { sources: string[] }
	const workerSourceMap = JSON.parse(await fs.readFile(workerSourceMapPath, 'utf8')) as { sources: string[] }

	expect(appBundle).not.toContain('./vendor/')
	expect(appBundle).not.toContain('./js/')
	expect(appBundle).toContain('new URL("./tevmWorker.worker.js", import.meta.url)')
	expect(workerBundle).not.toContain('./vendor/')
	expect(workerBundle).not.toContain('./js/')
	expect(appSourceMap.sources.some(source => source.startsWith('../../ts/'))).toBe(true)
	expect(workerSourceMap.sources.some(source => source.startsWith('../../ts/'))).toBe(true)
})

test('production build can be served as static files', async () => {
	if (server === undefined) {
		throw new Error('Production test server did not start')
	}

	const baseUrl = server.url.toString().replace(/\/$/, '')
	const responses = await Promise.all([fetch(`${baseUrl}/`), fetch(`${baseUrl}/assets/app.js`), fetch(`${baseUrl}/assets/tevmWorker.worker.js`), fetch(`${baseUrl}/css/index.css`)])

	for (const response of responses) {
		expect(response.status).toBe(200)
	}
})
