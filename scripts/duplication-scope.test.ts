import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import { duplicationSourcePaths, isDuplicationSource, isDuplicationTest } from './duplication-scope.mts'

test('includes maintained build and coverage tooling and its tests', () => {
	for (const path of ['ui/coreShared/build/apps.mts', 'ui/coreShared/build/productionBuild.test.ts', 'ui/trading/build/core-deployments.mts', 'solidity/ts/coverage/reporter.ts']) {
		expect(isDuplicationSource(path)).toBe(true)
	}
})

test('excludes dependencies, generated artifacts, vendored files and compiled output', () => {
	for (const path of [
		'node_modules/a/index.ts',
		'bots/chaos/node_modules/a/index.ts',
		'ui/zoltar/vendor/index.ts',
		'vendored/code.ts',
		'ui/trading/ts/generated/contractArtifact.ts',
		'bots/open-oracle-arbitrager/src/contracts/executor-abi.generated.ts',
		'solidity/ts/types/contractArtifact.ts',
		'ui/coreShared/ts/abis.ts',
		'ui/zoltar/dist/app.ts',
		'shared/js/index.js',
		'solidity/artifacts/index.ts',
		'coverage/report.ts',
		'solidity/coverage/report.ts',
		'bots/chaos/coverage/report.ts',
		'.git/example.ts',
		'ui/coreShared/build/apps.js',
	]) {
		expect(isDuplicationSource(path)).toBe(false)
	}
})

test('reports build tests and fixtures separately from production tooling', () => {
	for (const path of ['ui/coreShared/build/productionBuild.test.ts', 'scripts/lint-source-files.test.ts', 'bots/chaos/tests/config/settings.test.ts', 'solidity/ts/testSupport/fixture.ts', 'scripts/fixtures/example.ts']) expect(isDuplicationTest(path)).toBe(true)
	for (const path of ['ui/coreShared/build/apps.mts', 'ui/trading/build/core-deployments.mts', 'scripts/test-impact.mts', 'bots/shared/src/config/validation.ts']) expect(isDuplicationTest(path)).toBe(false)
})

test('Git candidates omit deleted files and retain unstaged rename destinations', async () => {
	const root = await mkdtemp(join(tmpdir(), 'duplication-paths-'))
	try {
		execFileSync('git', ['init', '--quiet'], { cwd: root })
		await mkdir(join(root, 'ui/coreShared/build'), { recursive: true })
		for (const path of ['deleted.ts', 'before.ts', 'ui/coreShared/build/tool.mts']) await writeFile(join(root, path), 'export const value = 1')
		execFileSync('git', ['add', '.'], { cwd: root })
		await rm(join(root, 'deleted.ts'))
		await rename(join(root, 'before.ts'), join(root, 'after.ts'))
		expect(duplicationSourcePaths(root)).toEqual(['after.ts', 'ui/coreShared/build/tool.mts'])
	} finally {
		await rm(root, { force: true, recursive: true })
	}
})
