import { expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as url from 'node:url'
import { UI_APP_IDS, getUiAppPaths, getUiCoreSharedPaths, isUiAppId, parseUiAppId } from './appPaths.mts'

const repositoryRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..', '..')

test('UI_APP_IDS lists exactly the supported applications', () => {
	expect(UI_APP_IDS).toEqual(['zoltar', 'statoblast'])
})

test('isUiAppId accepts supported applications and rejects unknown values', () => {
	expect(isUiAppId('zoltar')).toBe(true)
	expect(isUiAppId('statoblast')).toBe(true)
	expect(isUiAppId('')).toBe(false)
	expect(isUiAppId('coreShared')).toBe(false)
	expect(isUiAppId('Zoltar')).toBe(false)
})

test('parseUiAppId rejects missing and unknown IDs with the supported list', () => {
	expect(() => parseUiAppId(undefined, 'the test')).toThrow(/Missing UI app ID for the test.*zoltar, statoblast/)
	expect(() => parseUiAppId('coreShared', 'the test')).toThrow(/Unknown UI app ID 'coreShared'.*zoltar, statoblast/)
	expect(parseUiAppId('zoltar', 'the test')).toBe('zoltar')
	expect(parseUiAppId('statoblast', 'the test')).toBe('statoblast')
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
