import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { buildTypeScriptCoverage, calculateChangedLineCoverage, classifyTypeScriptSource, evaluateCoveragePolicy, mergeLcovRecords, parseChangedLines, parseLcov, readTaskChangedLines, readTrackedTypeScriptSources, resolveCoverageBaseRef, summarizeSolidityCoverage, type CoveragePolicy } from './coverage-report.mts'

describe('TypeScript coverage accounting', () => {
	test('uses weighted executable totals instead of averaging file percentages', () => {
		const records = parseLcov(`SF:ui/ts/large.ts
DA:1,1
DA:2,1
DA:3,1
DA:4,0
LF:4
LH:3
FNF:2
FNH:1
end_of_record
SF:ui/ts/small.ts
DA:1,1
LF:1
LH:1
FNF:1
FNH:1
end_of_record
`)
		const report = buildTypeScriptCoverage(records, [
			{ file: 'ui/ts/large.ts', source: 'export const large = () => 1' },
			{ file: 'ui/ts/small.ts', source: 'export const small = () => 1' },
		])

		expect(report.surfaces.ui.lines).toEqual({ covered: 4, total: 5, percentage: 80 })
		expect(report.surfaces.ui.functions).toEqual({ covered: 2, total: 3, percentage: 66.67 })
	})

	test('merges line hits and does not double-count totals', () => {
		const first = parseLcov(`SF:shared/ts/example.ts
DA:1,1
DA:2,0
LF:2
LH:1
end_of_record
`)
		const second = parseLcov(`SF:shared/ts/example.ts
DA:1,0
DA:2,2
LF:2
LH:1
end_of_record
`)

		const merged = mergeLcovRecords([first, second])
		expect(merged.get('shared/ts/example.ts')?.lineHits).toEqual(
			new Map([
				[1, 1],
				[2, 2],
			]),
		)
	})

	test('lists unloaded runtime source while excluding tests, generated files, and type-only modules', () => {
		const report = buildTypeScriptCoverage(new Map(), [
			{ file: 'shared/ts/runtime.ts', source: 'export const answer = () => 42\nanswer()' },
			{ file: 'shared/ts/types.ts', source: 'export interface Answer { value: number }' },
			{ file: 'shared/ts/runtime.test.ts', source: 'test("answer", () => {})' },
			{ file: 'ui/ts/contractArtifact.ts', source: 'export const artifact = {}' },
		])

		expect(report.surfaces.shared.unloadedFiles).toEqual(['shared/ts/runtime.ts'])
		expect(report.surfaces.shared.sourceFiles).toBe(1)
		expect(report.surfaces.shared.lines).toEqual({ covered: 0, total: 2, percentage: 0 })
		expect(report.surfaces.shared.functions).toEqual({ covered: 0, total: 1, percentage: 0 })
		expect(report.excludedFiles).toContain('shared/ts/types.ts')
		expect(report.excludedFiles).toContain('shared/ts/runtime.test.ts')
		expect(report.excludedFiles).toContain('ui/ts/contractArtifact.ts')
	})

	test('classifies application, shared, and executable tooling surfaces', () => {
		expect(classifyTypeScriptSource('ui/ts/app.ts', 'export const app = true')).toBe('ui')
		expect(classifyTypeScriptSource('shared/ts/model.ts', 'export const model = true')).toBe('shared')
		expect(classifyTypeScriptSource('scripts/task.mts', 'console.log("run")')).toBe('tooling')
		expect(classifyTypeScriptSource('solidity/ts/client.ts', 'export const client = true')).toBe('tooling')
		expect(classifyTypeScriptSource('shared/ts/model.ts', 'export type Model = string')).toBeUndefined()
		expect(classifyTypeScriptSource('shared/ts/model.ts', "export type { Model } from './types'")).toBeUndefined()
		expect(classifyTypeScriptSource('shared/ts/model.ts', "export { type Model } from './types'")).toBeUndefined()
		expect(classifyTypeScriptSource('scripts/augment.d.mts', "import './runtime-types'")).toBeUndefined()
		expect(classifyTypeScriptSource('scripts/model.cts', "import type Model = require('./model-types')")).toBeUndefined()
	})

	test('omits tracked TypeScript files deleted from the worktree while retaining untracked source', async () => {
		const repositoryRoot = await mkdtemp(join(tmpdir(), 'coverage-source-manifest-'))
		try {
			await runTemporaryGit(repositoryRoot, ['init', '--quiet'])
			await writeFile(join(repositoryRoot, 'kept.ts'), 'export const kept = true\n')
			await writeFile(join(repositoryRoot, 'deleted.ts'), 'export const deleted = true\n')
			await runTemporaryGit(repositoryRoot, ['add', 'kept.ts', 'deleted.ts'])
			await rm(join(repositoryRoot, 'deleted.ts'))
			await writeFile(join(repositoryRoot, 'untracked.ts'), 'export const untracked = true\n')

			const sources = await readTrackedTypeScriptSources(repositoryRoot)

			expect(sources.map(source => source.file)).toEqual(['kept.ts', 'untracked.ts'])
		} finally {
			await rm(repositoryRoot, { recursive: true, force: true })
		}
	})
})

describe('coverage policy', () => {
	const policy: CoveragePolicy = {
		version: 1,
		typescript: {
			ui: { minimumLines: 80, minimumFunctions: 70, allowedUnloadedFiles: [] },
			shared: { minimumLines: 75, minimumFunctions: 65, allowedUnloadedFiles: ['shared/ts/known.ts'] },
			tooling: { minimumLines: 35, minimumFunctions: 30, allowedUnloadedFiles: [] },
		},
		solidity: { minimumFirstPartyLines: 99.9 },
		changedLines: { minimum: 90 },
	}

	test('rejects threshold regressions and newly unloaded files', () => {
		const result = evaluateCoveragePolicy(
			{
				typescript: {
					surfaces: {
						ui: surface(79, 71),
						shared: { ...surface(80, 70), unloadedFiles: ['shared/ts/new.ts'] },
						tooling: surface(40, 35),
					},
					excludedFiles: [],
				},
				solidity: {
					firstParty: metric(99.5),
					imported: metric(90),
					all: metric(98),
					uncoveredFirstPartyLines: [],
					uncoveredImportedLines: [],
				},
				changedLines: metric(85),
			},
			policy,
		)

		expect(result.failures).toContain('TypeScript ui line coverage 79.0000% is below 80.000%')
		expect(result.failures).toContain('TypeScript shared has newly unloaded executable source: shared/ts/new.ts')
		expect(result.failures).toContain('TypeScript shared policy still allows source that is no longer unloaded: shared/ts/known.ts')
		expect(result.failures).toContain('First-party Solidity line coverage 99.5000% is below 99.900%')
		expect(result.failures).toContain('Changed product TypeScript line coverage 85.0000% is below 90.000%')
	})

	test('rejects an unavailable configured changed-line metric', () => {
		const result = evaluateCoveragePolicy(
			{
				typescript: {
					surfaces: {
						ui: surface(80, 70),
						shared: { ...surface(75, 65), unloadedFiles: ['shared/ts/known.ts'] },
						tooling: surface(35, 30),
					},
					excludedFiles: [],
				},
				changedLines: { available: false },
			},
			policy,
		)

		expect(result.failures).toContain('Changed product TypeScript line coverage is unavailable')
	})

	test('compares exact ratios instead of rounded display percentages', () => {
		const result = evaluateCoveragePolicy(
			{
				typescript: {
					surfaces: {
						ui: { ...surface(88.06, 70), lines: { covered: 28_105, total: 31_917, percentage: 88.06 } },
						shared: { ...surface(75, 65), unloadedFiles: ['shared/ts/known.ts'] },
						tooling: surface(35, 30),
					},
					excludedFiles: [],
				},
				changedLines: metric(100),
			},
			{ ...policy, typescript: { ...policy.typescript, ui: { ...policy.typescript.ui, minimumLines: 88.06 } } },
		)

		expect(result.failures).toContain('TypeScript ui line coverage 88.0565% is below 88.060%')
	})
})

describe('changed-line and Solidity coverage', () => {
	test('uses origin/main as the standard changed-line base while honoring overrides', () => {
		expect(resolveCoverageBaseRef(['bun', 'coverage-report.mts'], undefined)).toBe('origin/main')
		expect(resolveCoverageBaseRef(['bun', 'coverage-report.mts'], 'upstream/main')).toBe('upstream/main')
		expect(resolveCoverageBaseRef(['bun', 'coverage-report.mts', '--base-ref', 'HEAD~1'], 'upstream/main')).toBe('HEAD~1')
		expect(() => resolveCoverageBaseRef(['bun', 'coverage-report.mts', '--base-ref'], undefined)).toThrow('--base-ref requires a git ref')
	})

	test('parses added line numbers from zero-context git diffs', () => {
		const changed = parseChangedLines(`diff --git a/ui/ts/app.ts b/ui/ts/app.ts
--- a/ui/ts/app.ts
+++ b/ui/ts/app.ts
@@ -10,2 +10,3 @@
+one
 context
+two
diff --git a/shared/ts/new.ts b/shared/ts/new.ts
--- /dev/null
+++ b/shared/ts/new.ts
@@ -0,0 +1,2 @@
+first
+second
`)

		expect(changed.get('ui/ts/app.ts')).toEqual(new Set([10, 12]))
		expect(changed.get('shared/ts/new.ts')).toEqual(new Set([1, 2]))
	})

	test('counts committed, staged, unstaged, and untracked product additions', async () => {
		const repositoryRoot = await mkdtemp(join(tmpdir(), 'coverage-changed-lines-'))
		try {
			await runTemporaryGit(repositoryRoot, ['init', '--quiet'])
			await runTemporaryGit(repositoryRoot, ['config', 'user.email', 'coverage@example.com'])
			await runTemporaryGit(repositoryRoot, ['config', 'user.name', 'Coverage Test'])
			await mkdir(join(repositoryRoot, 'ui/ts'), { recursive: true })
			await mkdir(join(repositoryRoot, 'shared/ts'), { recursive: true })
			await writeFile(join(repositoryRoot, 'ui/ts/existing.ts'), 'export const baseline = 1\n')
			await runTemporaryGit(repositoryRoot, ['add', 'ui/ts/existing.ts'])
			await runTemporaryGit(repositoryRoot, ['commit', '--quiet', '-m', 'baseline'])
			await runTemporaryGit(repositoryRoot, ['branch', 'coverage-baseline'])

			await writeFile(join(repositoryRoot, 'ui/ts/committed.ts'), 'export const committed = 1\n')
			await runTemporaryGit(repositoryRoot, ['add', 'ui/ts/committed.ts'])
			await runTemporaryGit(repositoryRoot, ['commit', '--quiet', '-m', 'committed'])
			await writeFile(join(repositoryRoot, 'shared/ts/staged.ts'), 'export const staged = 1\n')
			await runTemporaryGit(repositoryRoot, ['add', 'shared/ts/staged.ts'])
			await writeFile(join(repositoryRoot, 'ui/ts/existing.ts'), 'export const baseline = 1\nexport const unstaged = 2\n')
			await writeFile(join(repositoryRoot, 'ui/ts/untracked.ts'), '// untracked product source\nexport const untracked = 3\n')

			const changedLines = await readTaskChangedLines(repositoryRoot, 'coverage-baseline')
			const trackedSources = await readTrackedTypeScriptSources(repositoryRoot)
			const productSources = new Map<string, string>(
				trackedSources
					.filter(source => {
						const surfaceName = classifyTypeScriptSource(source.file, source.source)
						return surfaceName === 'ui' || surfaceName === 'shared'
					})
					.map(source => [source.file, source.source]),
			)
			const records = parseLcov(`SF:ui/ts/committed.ts
DA:1,1
FNF:0
FNH:0
end_of_record
SF:shared/ts/staged.ts
DA:1,1
FNF:0
FNH:0
end_of_record
SF:ui/ts/existing.ts
DA:1,1
DA:2,1
FNF:0
FNH:0
end_of_record
`)

			expect(changedLines.get('ui/ts/committed.ts')).toEqual(new Set([1]))
			expect(changedLines.get('shared/ts/staged.ts')).toEqual(new Set([1]))
			expect(changedLines.get('ui/ts/existing.ts')).toEqual(new Set([2]))
			expect(changedLines.get('ui/ts/untracked.ts')).toEqual(new Set([1, 2]))
			expect(calculateChangedLineCoverage(changedLines, records, productSources)).toEqual({ covered: 3, total: 4, percentage: 75 })
		} finally {
			await rm(repositoryRoot, { recursive: true, force: true })
		}
	})

	test('separates imported compatibility contracts from first-party Solidity', () => {
		const report = summarizeSolidityCoverage(
			{
				totalLines: 0,
				totalCoveredLines: 0,
				files: {
					'/repo/solidity/contracts/Protocol.sol': {
						file: '/repo/solidity/contracts/Protocol.sol',
						totalLines: 2,
						coveredLines: 1,
						lineHits: { '1': 1, '2': 0 },
					},
					'/repo/solidity/contracts/peripherals/WETH9.sol': {
						file: '/repo/solidity/contracts/peripherals/WETH9.sol',
						totalLines: 1,
						coveredLines: 0,
						lineHits: { '1': 0 },
					},
				},
			},
			'/repo',
		)

		expect(report.firstParty).toEqual({ covered: 1, total: 2, percentage: 50 })
		expect(report.imported).toEqual({ covered: 0, total: 1, percentage: 0 })
		expect(report.uncoveredFirstPartyLines).toEqual(['solidity/contracts/Protocol.sol:2'])
	})
})

function metric(percentage: number) {
	return { covered: percentage, total: 100, percentage }
}

function surface(linePercentage: number, functionPercentage: number) {
	return {
		lines: metric(linePercentage),
		functions: metric(functionPercentage),
		branches: { available: false as const },
		sourceFiles: 1,
		loadedFiles: 1,
		unloadedFiles: [],
	}
}

async function runTemporaryGit(repositoryRoot: string, args: string[]) {
	const child = Bun.spawn(['git', ...args], { cwd: repositoryRoot, stdout: 'pipe', stderr: 'pipe' })
	const stderr = await new Response(child.stderr).text()
	expect(await child.exited).toBe(0)
	expect(stderr).toBe('')
}
