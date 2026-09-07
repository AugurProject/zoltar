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
	expect(applyKnownKnipFindings(issues, counters, known, '/repo')).toBe(1)
	expect(issue.severity).toBe('warn')
	expect(issues.exports['src/api.ts'].enumerateChildren).toBe(issue)
	expect(counters.exports).toBe(0)
})

test('a replacement finding fails even when the total count has not increased', () => {
	const issue = finding({ symbol: 'newUnusedExport' })
	const counters = { exports: 1 }
	expect(applyKnownKnipFindings({ exports: { 'src/api.ts': { newUnusedExport: issue } } }, counters, known, '/repo')).toBe(0)
	expect(issue.severity).toBe('error')
	expect(counters.exports).toBe(1)
})

test('baseline identity includes file, issue type, and parent symbol', () => {
	for (const overrides of [{ filePath: '/repo/src/other.ts' }, { type: 'types' }, { parentSymbol: 'AnotherApi' }] satisfies Partial<Issue>[]) {
		const issue = finding(overrides)
		const counters = { exports: 1, types: 1 }
		expect(applyKnownKnipFindings({ [issue.type]: { 'src/api.ts': { item: issue } } }, counters, known, '/repo')).toBe(0)
		expect(issue.severity).toBe('error')
	}
})

test('repository location and line changes do not create new findings', () => {
	const issue = finding({ filePath: '/ci/checkout/src/api.ts', line: 400, col: 2 })
	const counters = { exports: 1 }
	expect(applyKnownKnipFindings({ exports: { 'src/api.ts': { item: issue } } }, counters, known, '/ci/checkout')).toBe(1)
	expect(counters.exports).toBe(0)
})

test('new files and dependencies remain errors', () => {
	for (const type of ['files', 'dependencies', 'unresolved'] as const) {
		const issue = finding({ type })
		const counters = { [type]: 1 }
		expect(applyKnownKnipFindings({ [type]: { 'src/api.ts': { item: issue } } }, counters, known, '/repo')).toBe(0)
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
	expect(applyKnownKnipFindings(issues, counters, known, '/repo')).toBe(0)
	expect(counters.exports).toBe(0)
})

test('the real Knip CLI passes retained findings and fails their same-count replacement', async () => {
	const fixtureRoot = await mkdtemp(join(tmpdir(), 'zoltar-knip-baseline-'))
	const repositoryRoot = resolve(import.meta.dir, '..')
	try {
		await mkdir(join(fixtureRoot, 'augurScan/browser'), { recursive: true })
		await writeFile(join(fixtureRoot, 'package.json'), JSON.stringify({ name: 'knip-baseline-fixture', private: true, type: 'module' }))
		await writeFile(join(fixtureRoot, 'knip.json'), JSON.stringify({ entry: ['index.ts!'], project: ['**/*.ts!'] }))
		await writeFile(join(fixtureRoot, 'index.ts'), "import { used } from './augurScan/browser/api-validation.ts'\nconsole.log(used)\n")
		for (const production of [false, true]) {
			for (const symbol of ['isStringOrNumber', 'newUnusedExport']) {
				await writeFile(join(fixtureRoot, 'augurScan/browser/api-validation.ts'), `export const used = 1\nexport const ${symbol} = 2\n`)
				const child = Bun.spawn([process.execPath, join(repositoryRoot, 'node_modules/knip/bin/knip.js'), '--directory', fixtureRoot, '--config', join(fixtureRoot, 'knip.json'), '--preprocessor', join(import.meta.dir, 'knip-baseline.mts'), '--no-progress', ...(production ? ['--production'] : [])], {
					stdout: 'pipe',
					stderr: 'pipe',
				})
				const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
				expect(stdout).toContain(symbol)
				expect(stderr).toContain(`Knip ${production ? 'production' : 'normal'}: ${symbol === 'isStringOrNumber' ? '1' : '0'} retained baseline findings`)
				expect(exitCode).toBe(symbol === 'isStringOrNumber' ? 0 : 1)
			}
		}
	} finally {
		await rm(fixtureRoot, { recursive: true, force: true })
	}
}, 30_000)
