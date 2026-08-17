import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createAssetHandler } from './dockerServe.mts'

let fixtureRoot = ''

beforeAll(async () => {
	fixtureRoot = await mkdtemp(path.join(tmpdir(), 'zoltar-docker-serve-'))
	await mkdir(path.join(fixtureRoot, 'assets'))
	await writeFile(path.join(fixtureRoot, 'index.html'), '<h1>Zoltar</h1>')
	await writeFile(path.join(fixtureRoot, 'assets', 'app.js'), 'console.log("loaded")')
})

afterAll(async () => {
	await rm(fixtureRoot, { recursive: true, force: true })
})

describe('Docker static UI server', () => {
	test('serves the index and built assets without an IPFS path', async () => {
		const serveAsset = createAssetHandler(fixtureRoot)
		const indexResponse = await serveAsset(new Request('http://localhost:8080/'))
		expect(indexResponse.status).toBe(200)
		expect(indexResponse.headers.get('cache-control')).toBe('no-store')
		expect(await indexResponse.text()).toBe('<h1>Zoltar</h1>')

		const assetResponse = await serveAsset(new Request('http://localhost:8080/assets/app.js'))
		expect(assetResponse.status).toBe(200)
		expect(assetResponse.headers.get('cache-control')).toBe('public, max-age=3600')
		expect(await assetResponse.text()).toBe('console.log("loaded")')
	})

	test('rejects unsupported methods, missing files, and traversal', async () => {
		const serveAsset = createAssetHandler(fixtureRoot)
		expect((await serveAsset(new Request('http://localhost:8080/', { method: 'POST' }))).status).toBe(405)
		expect((await serveAsset(new Request('http://localhost:8080/missing.js'))).status).toBe(404)
		expect((await serveAsset(new Request('http://localhost:8080/%2e%2e%2fsecret'))).status).toBe(403)
		expect((await serveAsset(new Request('http://localhost:8080/%'))).status).toBe(400)
	})
})
