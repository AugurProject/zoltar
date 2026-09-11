import { expect, test } from 'bun:test'
import type { ReporterOptions } from 'knip'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { applyKnownKnipFindings } from './knip-baseline.mts'

type Issue = ReporterOptions['issues']['exports'][string][string]

function finding(overrides: Partial<Issue> = {}): Issue {
	return { type: 'exports', filePath: '/repo/src/api.ts', workspace: '.', symbol: 'enumerateChildren', severity: 'error', fixes: [], ...overrides }
}

const known = new Set([JSON.stringify(['exports', 'src/api.ts', '', 'enumerateChildren'])])

test('known findings stay visible but do not fail the gate', () => {
	const issue = finding()
	const issues = { exports: { 'src/api.ts': { enumerateChildren: issue } } }
	const counters = { exports: 1 }
	expect(applyKnownKnipFindings(issues, counters, known, '/repo')).toEqual({ accepted: 1, unmatched: [] })
	expect(issue.severity).toBe('warn')
	expect(issues.exports['src/api.ts'].enumerateChildren).toBe(issue)
	expect(counters.exports).toBe(0)
})

test('a replacement finding fails even when the total count has not increased', () => {
	const issue = finding({ symbol: 'newUnusedExport' })
	const counters = { exports: 1 }
	expect(applyKnownKnipFindings({ exports: { 'src/api.ts': { newUnusedExport: issue } } }, counters, known, '/repo')).toEqual({ accepted: 0, unmatched: [...known] })
	expect(issue.severity).toBe('error')
	expect(counters.exports).toBe(1)
})

test('baseline identity includes file, issue type, and parent symbol', () => {
	for (const overrides of [{ filePath: '/repo/src/other.ts' }, { type: 'types' }, { parentSymbol: 'AnotherApi' }] satisfies Partial<Issue>[]) {
		const issue = finding(overrides)
		const counters = { exports: 1, types: 1 }
		expect(applyKnownKnipFindings({ [issue.type]: { 'src/api.ts': { item: issue } } }, counters, known, '/repo').accepted).toBe(0)
		expect(issue.severity).toBe('error')
	}
})

test('repository location and line changes do not create new findings', () => {
	const issue = finding({ filePath: '/ci/checkout/src/api.ts', line: 400, col: 2 })
	const counters = { exports: 1 }
	expect(applyKnownKnipFindings({ exports: { 'src/api.ts': { item: issue } } }, counters, known, '/ci/checkout').accepted).toBe(1)
	expect(counters.exports).toBe(0)
})

test('new files and dependencies remain errors', () => {
	for (const type of ['files', 'dependencies', 'unresolved'] as const) {
		const issue = finding({ type })
		const counters = { [type]: 1 }
		expect(applyKnownKnipFindings({ [type]: { 'src/api.ts': { item: issue } } }, counters, known, '/repo').accepted).toBe(0)
		expect(issue.severity).toBe('error')
		expect(counters[type]).toBe(1)
	}
})

test('inconsistent counters cannot hide a new finding', () => {
	for (const counters of [{}, { exports: 0 }]) {
		expect(() => applyKnownKnipFindings({ exports: { 'src/api.ts': { item: finding() } } }, counters, known, '/repo')).toThrow('Invalid Knip counter')
	}
})

test('reapplying the preprocessor does not discount an issue twice', () => {
	const issue = finding()
	const issues = { exports: { 'src/api.ts': { item: issue } } }
	const counters = { exports: 1 }
	applyKnownKnipFindings(issues, counters, known, '/repo')
	expect(applyKnownKnipFindings(issues, counters, known, '/repo')).toEqual({ accepted: 0, unmatched: [] })
	expect(counters.exports).toBe(0)
})

test('baseline entries that match no finding are reported as unmatched', () => {
	const stale = JSON.stringify(['exports', 'src/removed.ts', '', 'gone'])
	const result = applyKnownKnipFindings({ exports: { 'src/api.ts': { item: finding() } } }, { exports: 1 }, new Set([...known, stale]), '/repo')
	expect(result).toEqual({ accepted: 1, unmatched: [stale] })
})

test('a baseline entry already reported as a warning still counts as matched', () => {
	const issue = finding({ severity: 'warn' })
	expect(applyKnownKnipFindings({ exports: { 'src/api.ts': { item: issue } } }, { exports: 0 }, known, '/repo')).toEqual({ accepted: 0, unmatched: [] })
})

test('the real Knip CLI passes retained findings, fails new findings, and fails stale baseline entries', async () => {
	const fixtureRoot = await mkdtemp(join(tmpdir(), 'zoltar-knip-baseline-'))
	const repositoryRoot = resolve(import.meta.dir, '../..')
	const retained = ['exports', 'augurScan/browser/api-validation.ts', '', 'isStringOrNumber']
	try {
		await mkdir(join(fixtureRoot, 'augurScan/browser'), { recursive: true })
		await writeFile(join(fixtureRoot, 'package.json'), JSON.stringify({ name: 'knip-baseline-fixture', private: true, type: 'module' }))
		await writeFile(join(fixtureRoot, 'knip.json'), JSON.stringify({ entry: ['index.ts!'], project: ['**/*.ts!'], ignore: ['preprocessor.ts'] }))
		await writeFile(join(fixtureRoot, 'index.ts'), "import { used } from './augurScan/browser/api-validation.ts'\nconsole.log(used)\n")
		await writeFile(
			join(fixtureRoot, 'preprocessor.ts'),
			`import { createKnipBaselinePreprocessor } from ${JSON.stringify(join(import.meta.dir, 'knip-baseline.mts'))}\nexport default createKnipBaselinePreprocessor({ normal: [${JSON.stringify(retained)}], production: [${JSON.stringify(retained)}] }, 'fixture-baseline.json')\n`,
		)
		const runKnip = async (production: boolean) => {
			const child = Bun.spawn([process.execPath, join(repositoryRoot, 'node_modules/knip/bin/knip.js'), '--directory', fixtureRoot, '--config', join(fixtureRoot, 'knip.json'), '--preprocessor', join(fixtureRoot, 'preprocessor.ts'), '--no-progress', ...(production ? ['--production'] : [])], {
				stdout: 'pipe',
				stderr: 'pipe',
			})
			const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
			return { stdout, stderr, exitCode }
		}
		for (const production of [false, true]) {
			const mode = production ? 'production' : 'normal'
			await writeFile(join(fixtureRoot, 'augurScan/browser/api-validation.ts'), 'export const used = 1\nexport const isStringOrNumber = 2\n')
			const retainedOnly = await runKnip(production)
			expect(retainedOnly.stdout).toContain('isStringOrNumber')
			expect(retainedOnly.stderr).toContain(`Knip ${mode}: 1 retained baseline findings`)
			expect(retainedOnly.stderr).not.toContain('stale baseline entry')
			expect(retainedOnly.exitCode).toBe(0)

			await writeFile(join(fixtureRoot, 'augurScan/browser/api-validation.ts'), 'export const used = 1\nexport const isStringOrNumber = 2\nexport const newUnusedExport = 3\n')
			const withNewFinding = await runKnip(production)
			expect(withNewFinding.stdout).toContain('newUnusedExport')
			expect(withNewFinding.stderr).toContain(`Knip ${mode}: 1 retained baseline findings`)
			expect(withNewFinding.stderr).not.toContain('stale baseline entry')
			expect(withNewFinding.exitCode).toBe(1)

			await writeFile(join(fixtureRoot, 'augurScan/browser/api-validation.ts'), 'export const used = 1\n')
			const stale = await runKnip(production)
			expect(stale.stderr).toContain(`stale baseline entry: ${JSON.stringify(retained)}`)
			expect(stale.stderr).toContain(`Knip ${mode}: 1 baseline entries in fixture-baseline.json matched no current finding`)
			expect(stale.exitCode).not.toBe(0)
		}
	} finally {
		await rm(fixtureRoot, { recursive: true, force: true })
	}
}, 30_000)
