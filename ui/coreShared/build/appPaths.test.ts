import { describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as url from 'node:url'
import { UI_APP_IDS, getUiAppDependencyOrder, getUiAppPaths, getUiCoreSharedPaths, isUiAppId, parseUiAppId, type UiAppId } from './appPaths.mts'

const repositoryRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..', '..')

test('UI_APP_IDS lists exactly the supported applications', () => {
	expect(UI_APP_IDS).toEqual(['zoltar', 'statoblast', 'trading'])
})

test('getUiAppDependencyOrder preserves the UI package DAG', () => {
	expect(getUiAppDependencyOrder('zoltar')).toEqual(['coreShared', 'zoltar'])
	expect(getUiAppDependencyOrder('statoblast')).toEqual(['coreShared', 'zoltar', 'statoblast'])
	expect(getUiAppDependencyOrder('trading')).toEqual(['coreShared', 'zoltar', 'statoblast', 'trading'])
})

test('isUiAppId accepts supported applications and rejects unknown values', () => {
	expect(isUiAppId('zoltar')).toBe(true)
	expect(isUiAppId('statoblast')).toBe(true)
	expect(isUiAppId('trading')).toBe(true)
	expect(isUiAppId('')).toBe(false)
	expect(isUiAppId('coreShared')).toBe(false)
	expect(isUiAppId('Zoltar')).toBe(false)
})

test('parseUiAppId rejects missing and unknown IDs with the supported list', () => {
	expect(() => parseUiAppId(undefined, 'the test')).toThrow(/Missing UI app ID for the test.*zoltar, statoblast, trading/)
	expect(() => parseUiAppId('coreShared', 'the test')).toThrow(/Unknown UI app ID 'coreShared'.*zoltar, statoblast, trading/)
	expect(parseUiAppId('zoltar', 'the test')).toBe('zoltar')
	expect(parseUiAppId('statoblast', 'the test')).toBe('statoblast')
	expect(parseUiAppId('trading', 'the test')).toBe('trading')
})

for (const appId of UI_APP_IDS) {
	test(`getUiAppPaths resolves existing locations for ${appId}`, () => {
		const paths = getUiAppPaths(appId)
		expect(paths.repositoryRoot).toBe(repositoryRoot)
		expect(paths.uiRoot).toBe(path.join(repositoryRoot, 'ui'))
		expect(paths.coreSharedRoot).toBe(path.join(repositoryRoot, 'ui', 'coreShared'))
		expect(paths.appRoot).toBe(path.join(repositoryRoot, 'ui', appId))
		expect(paths.appDistRoot).toBe(path.join(paths.appRoot, 'dist'))
		expect(paths.appDistAssetsRoot).toBe(path.join(paths.appRoot, 'dist', 'assets'))
		expect(paths.appIndexHtml).toBe(path.join(paths.appRoot, 'index.html'))
		expect(paths.appEntrypoint).toBe(path.join(paths.appSourceRoot, 'index.ts'))
		expect(paths.workerEntrypoint).toBe(path.join(paths.appSourceRoot, 'simulation', 'tevmWorker.ts'))

		for (const existingPath of [paths.appIndexHtml, paths.appEntrypoint, paths.workerEntrypoint, paths.faviconIco, paths.faviconSvg, paths.coreSharedCssRoot, paths.sharedSourceRoot]) {
			expect(fs.existsSync(existingPath), `expected ${existingPath} to exist`).toBe(true)
		}
	})
}

test('getUiCoreSharedPaths resolves the repository root from ui/coreShared/build', () => {
	const paths = getUiCoreSharedPaths()
	expect(paths.repositoryRoot).toBe(repositoryRoot)
	expect(paths.coreSharedTestSourceRoot).toBe(path.join(repositoryRoot, 'ui', 'coreShared', 'ts', 'tests'))
	expect(fs.existsSync(path.join(paths.repositoryRoot, 'package.json'))).toBe(true)
})

test('vendor and worker builders consume the centralized app path helper', () => {
	for (const buildScript of ['vendor.mts', 'workers.mts']) {
		const source = fs.readFileSync(path.join(import.meta.dir, buildScript), 'utf8')
		expect(source).toContain("from './appPaths.mts'")
		expect(source).not.toMatch(/const APP_IDS\s*=/)
	}
})

async function waitForDevelopmentServer(serverUrl: string) {
	for (let attempt = 0; attempt < 100; attempt++) {
		try {
			const response = await fetch(serverUrl)
			if (response.ok) return await response.text()
		} catch (error) {
			if (!(error instanceof Error) || !error.message.includes('Unable to connect')) throw error
		}
		await Bun.sleep(20)
	}
	throw new Error(`Development server did not start at ${serverUrl}`)
}

describe('split development server paths', () => {
	for (const [appId, port] of [
		['zoltar', 12346],
		['statoblast', 12347],
		['trading', 4163],
	] as const) {
		test(`serves the ${appId} application root`, async () => {
			const titles: Record<UiAppId, string> = { statoblast: '<title>Augur Statoblast</title>', trading: '<title>Statoblast trading</title>', zoltar: '<title>Zoltar</title>' }
			const paths = getUiAppPaths(appId)
			const processHandle = Bun.spawn([process.execPath, paths.devServerScript, appId], { stderr: 'pipe', stdout: 'pipe' })
			try {
				const html = await waitForDevelopmentServer(`http://127.0.0.1:${port.toString()}/`)
				expect(html).toContain(titles[appId])
			} finally {
				processHandle.kill()
				await processHandle.exited
			}
		})
	}

	for (const [label, args, expected] of [
		['missing', [], 'Missing UI app ID'],
		['unknown', ['unknown'], "Unknown UI app ID 'unknown'"],
	] as const) {
		test(`rejects a ${label} application ID`, async () => {
			const processHandle = Bun.spawn([process.execPath, getUiAppPaths('zoltar').devServerScript, ...args], { stderr: 'pipe', stdout: 'pipe' })
			const stderr = await new Response(processHandle.stderr).text()
			expect(await processHandle.exited).not.toBe(0)
			expect(stderr).toContain(expected)
		})
	}
})
