import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projects } from '../repo/projects.ts'
import { parseLcov } from './lcov.mts'
import { assertComponentCoverageOwners, reportComponentCoverage, summarizeComponentCoverage } from './component-coverage-report.mts'

const lcov = 'SF:src/value.ts\nFNF:0\nFNH:0\nDA:1,2\nDA:2,0\nLF:2\nLH:1\nend_of_record\n'
test('#1523 counts instrumented lines and lists unloaded executable files separately', () => {
	const records = parseLcov(lcov)
	expect(
		summarizeComponentCoverage(records, [
			{ file: 'src/value.ts', source: 'export const value = 1' },
			{ file: 'src/missing.ts', source: 'export function missing() { return 1 }' },
			{ file: 'src/types.ts', source: 'export type Value = number' },
		]),
	).toEqual({ instrumentedLines: { covered: 1, measured: 2 }, unloadedExecutableFiles: ['src/missing.ts'] })
})
test('#1523 a new executable component needs an explicit coverage owner', () => {
	expect(() => assertComponentCoverageOwners()).not.toThrow()
	const template = projects.find(project => project.id === 'chaos')
	if (template === undefined) throw new Error('Missing component template')
	const { ci, ...withoutCi } = template
	if (ci === undefined) throw new Error('Missing component CI metadata')
	expect(() => assertComponentCoverageOwners([...projects, { ...template, id: 'new-bot', path: 'bots/new', ci: { ...ci, componentName: 'new-bot' } }])).toThrow('no declared coverage owner')
	expect(() => assertComponentCoverageOwners([...projects, { ...withoutCi, id: 'unowned-bot', path: 'bots/unowned' }])).toThrow('no declared coverage owner')
})
test('#1523 publishes exact test-file evidence and refuses missing or cross-commit captures', async () => {
	const root = await mkdtemp(join(tmpdir(), 'zoltar-component-coverage-'))
	const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
	try {
		await mkdir(join(root, 'bots/chaos/src'), { recursive: true })
		await mkdir(join(root, 'bots/chaos/coverage/ci/unit'), { recursive: true })
		await writeFile(join(root, 'bots/chaos/src/value.ts'), 'export const value = 1\n')
		git('init', '-q')
		git('add', '.')
		git('-c', 'user.name=Coverage', '-c', 'user.email=coverage@example.com', 'commit', '-qm', 'fixture')
		const directory = join(root, 'bots/chaos/coverage/ci')
		await writeFile(join(directory, 'commit.txt'), git('rev-parse', 'HEAD'))
		await writeFile(join(directory, 'unit/lcov.info'), lcov)
		await expect(reportComponentCoverage('chaos', directory, root)).rejects.toThrow()
		await writeFile(join(directory, 'unit/junit.xml'), '<testsuites><testsuite><testcase file="tests/value.test.ts" name="value" time="0.25"/></testsuite></testsuites>')
		const report = await reportComponentCoverage('chaos', directory, root)
		expect(report.instrumentedLines).toEqual({ covered: 1, measured: 2 })
		expect(report.captures).toMatchObject([{ files: ['tests/value.test.ts'], summedTestSeconds: 0.25 }])
		expect(JSON.parse(await readFile(join(directory, 'component-summary.json'), 'utf8'))).toMatchObject({ mode: 'report-only', package: 'chaos' })
		await mkdir(join(directory, 'api'))
		await writeFile(join(directory, 'api/lcov.info'), lcov.replace('DA:1,2\nDA:2,0', 'DA:1,0\nDA:2,3'))
		await writeFile(join(directory, 'api/junit.xml'), '<testsuites><testsuite><testcase file="tests/api.test.ts" name="api" time="0.5"/></testsuite></testsuites>')
		const merged = await reportComponentCoverage('chaos', directory, root)
		expect(merged.instrumentedLines).toEqual({ covered: 2, measured: 2 })
		expect(merged.captures).toHaveLength(2)
		await writeFile(join(directory, 'commit.txt'), 'another-commit')
		await expect(reportComponentCoverage('chaos', directory, root)).rejects.toThrow('another commit')
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})
