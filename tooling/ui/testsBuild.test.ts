import { describe, expect, test } from 'bun:test'
import * as path from 'node:path'
import { tmpdir } from 'node:os'
import { existsSync, promises as fs } from 'node:fs'
import { buildTests, getTestBuildRoots, isTestBuildTarget, parseTestBuildTarget } from './tests.mts'
import { UI_APP_IDS, getUiAppPaths, getUiCoreSharedPaths } from './appPaths.mts'

describe('UI test build target parsing', () => {
	test('accepts every supported app ID and coreShared', () => {
		expect(parseTestBuildTarget('coreShared', 'the test')).toBe('coreShared')
		for (const appId of UI_APP_IDS) expect(parseTestBuildTarget(appId, 'the test')).toBe(appId)
	})

	test('rejects missing and unknown IDs with a clear error', () => {
		expect(() => parseTestBuildTarget(undefined, 'the UI test build')).toThrow(/Missing UI app ID.*zoltar, statoblast, trading/)
		expect(() => parseTestBuildTarget('', 'the UI test build')).toThrow(/Missing UI app ID/)
		expect(() => parseTestBuildTarget('core-shared', 'the UI test build')).toThrow(/Unknown UI app ID 'core-shared'/)
		expect(() => parseTestBuildTarget('ui', 'the UI test build')).toThrow(/Unknown UI app ID 'ui'/)
	})

	test('isTestBuildTarget matches only the supported targets', () => {
		expect(isTestBuildTarget('coreShared')).toBe(true)
		expect(isTestBuildTarget('zoltar')).toBe(true)
		expect(isTestBuildTarget('statoblast')).toBe(true)
		expect(isTestBuildTarget('trading')).toBe(true)
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
		// Compile into a sandbox: writing the real output trees from inside a
		// test run creates a partial js tree that later imports can resolve into.
		const sandboxRoot = await fs.mkdtemp(path.join(tmpdir(), 'zoltar-ui-tests-build-'))
		try {
			for (const appId of UI_APP_IDS) {
				const { testSourceRoot } = getTestBuildRoots(appId)
				if (!existsSync(testSourceRoot)) continue
				const sandboxOutputRoot = path.join(sandboxRoot, appId)
				const builtCount = await buildTests(appId, sandboxOutputRoot)
				expect(builtCount).toBeGreaterThan(0)
				expect(existsSync(sandboxOutputRoot)).toBe(true)
				const compiledFiles = (await fs.readdir(sandboxOutputRoot, { recursive: true })).filter(entry => String(entry).endsWith('.js'))
				expect(compiledFiles.length).toBe(builtCount)
			}
			const { coreSharedTestSourceRoot } = getUiCoreSharedPaths()
			if (existsSync(coreSharedTestSourceRoot)) {
				const sandboxOutputRoot = path.join(sandboxRoot, 'coreShared')
				const builtCount = await buildTests('coreShared', sandboxOutputRoot)
				expect(builtCount).toBeGreaterThan(0)
				expect(existsSync(sandboxOutputRoot)).toBe(true)
			}
		} finally {
			await fs.rm(sandboxRoot, { force: true, recursive: true })
		}
	}, 60000)
})
