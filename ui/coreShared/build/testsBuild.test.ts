import { describe, expect, test } from 'bun:test'
import * as path from 'node:path'
import { existsSync, promises as fs } from 'node:fs'
import { buildTests, getTestBuildRoots, isTestBuildTarget, parseTestBuildTarget } from './tests.mts'
import { UI_APP_IDS, getUiAppPaths, getUiCoreSharedPaths } from './appPaths.mts'

describe('UI test build target parsing', () => {
	test('accepts every supported app ID and coreShared', () => {
		expect(parseTestBuildTarget('coreShared', 'the test')).toBe('coreShared')
		for (const appId of UI_APP_IDS) expect(parseTestBuildTarget(appId, 'the test')).toBe(appId)
	})

	test('rejects missing and unknown IDs with a clear error', () => {
		expect(() => parseTestBuildTarget(undefined, 'the UI test build')).toThrow(/Missing UI app ID.*zoltar, statoblast/)
		expect(() => parseTestBuildTarget('', 'the UI test build')).toThrow(/Missing UI app ID/)
		expect(() => parseTestBuildTarget('core-shared', 'the UI test build')).toThrow(/Unknown UI app ID 'core-shared'/)
		expect(() => parseTestBuildTarget('ui', 'the UI test build')).toThrow(/Unknown UI app ID 'ui'/)
	})

	test('isTestBuildTarget matches only the supported targets', () => {
		expect(isTestBuildTarget('coreShared')).toBe(true)
		expect(isTestBuildTarget('zoltar')).toBe(true)
		expect(isTestBuildTarget('statoblast')).toBe(true)
		expect(isTestBuildTarget('monolith')).toBe(false)
	})
})

describe('UI test build output paths', () => {
	test('each target compiles into its own package output tree', () => {
		const coreShared = getUiCoreSharedPaths()
		expect(getTestBuildRoots('coreShared')).toEqual({ testSourceRoot: coreShared.coreSharedTestSourceRoot, testOutputRoot: coreShared.coreSharedTestOutputRoot })
		for (const appId of UI_APP_IDS) {
			const appPaths = getUiAppPaths(appId)
			expect(getTestBuildRoots(appId)).toEqual({ testSourceRoot: path.join(appPaths.appSourceRoot, 'tests'), testOutputRoot: path.join(appPaths.appGeneratedJsRoot, 'tests') })
		}
	})

	test('building a target emits compiled output into only that target tree', async () => {
		for (const appId of UI_APP_IDS) {
			const { testSourceRoot, testOutputRoot } = getTestBuildRoots(appId)
			if (!existsSync(testSourceRoot)) continue
			const builtCount = await buildTests(appId)
			expect(builtCount).toBeGreaterThan(0)
			expect(existsSync(testOutputRoot)).toBe(true)
			const compiledFiles = (await fs.readdir(testOutputRoot, { recursive: true })).filter(entry => String(entry).endsWith('.js'))
			expect(compiledFiles.length).toBe(builtCount)
		}
		const { coreSharedTestSourceRoot, coreSharedTestOutputRoot } = getUiCoreSharedPaths()
		if (existsSync(coreSharedTestSourceRoot)) {
			const builtCount = await buildTests('coreShared')
			expect(builtCount).toBeGreaterThan(0)
			expect(existsSync(coreSharedTestOutputRoot)).toBe(true)
		}
	}, 60000)
})
