import { describe, expect, test } from 'bun:test'
import * as path from 'node:path'
import { existsSync, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
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

	// Build into a temporary root: rewriting the real ui/*/js/tests trees mid-process changes how later tests in the same
	// process resolve @zoltar/ui-* test utilities (Bun prefers the compiled export target once it exists).
	test('building a target emits compiled output into only that target tree', async () => {
		const outputRoot = await fs.mkdtemp(path.join(tmpdir(), 'zoltar-ui-test-build-'))
		try {
			const builtTargets: string[] = []
			for (const target of ['coreShared', ...UI_APP_IDS] as const) {
				if (!existsSync(getTestBuildRoots(target).testSourceRoot)) continue
				const testOutputRoot = path.join(outputRoot, target)
				const builtCount = await buildTests(target, testOutputRoot)
				builtTargets.push(target)
				expect(builtCount).toBeGreaterThan(0)
				const compiledFiles = (await fs.readdir(testOutputRoot, { recursive: true })).filter(entry => String(entry).endsWith('.js'))
				expect(compiledFiles.length).toBe(builtCount)
				expect((await fs.readdir(outputRoot)).sort()).toEqual([...builtTargets].sort())
			}
			expect(builtTargets).toContain('coreShared')
		} finally {
			await fs.rm(outputRoot, { force: true, recursive: true })
		}
	}, 60000)
})
