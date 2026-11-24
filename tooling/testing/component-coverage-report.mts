import { readFile, writeFile } from 'node:fs/promises'
import { relative, resolve, dirname } from 'node:path'
import * as ts from 'typescript'
import { createComponentCiPlan } from '../ci/run-component-ci.mts'
import { projects, componentProjects, type Project } from '../repo/projects.ts'
import { listRepositoryFiles, runGit } from '../repo/git.mts'
import { walkFiles } from '../repo/walk.mts'
import { hasRuntimeStatement } from './runtime-source.mts'
import { mergeLcovRecords, parseLcov, type LcovRecord } from './lcov.mts'
import { parseJunitTestCaseSeconds, validateJunitDocument } from './test-timings.mts'

const owners = new Set(['bot-shared', 'chaos', 'arbitrager', 'liquidator', 'augur-scan'])
export function assertComponentCoverageOwners(registry: readonly Project[] = projects) {
	for (const project of registry.filter(project => project.path.startsWith('bots/') || project.path === 'augurScan')) {
		if (!owners.has(project.ci?.componentName ?? '')) throw new Error(`Executable component ${project.id} has no declared coverage owner`)
	}
}

export function summarizeComponentCoverage(records: Map<string, LcovRecord>, sources: readonly { file: string; source: string }[]) {
	let covered = 0
	let measured = 0
	const unloaded: string[] = []
	for (const { file, source } of sources) {
		const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
		if (!ast.statements.some(hasRuntimeStatement)) continue
		const record = records.get(file)
		if (record === undefined) unloaded.push(file)
		else {
			measured += record.lineHits.size
			covered += [...record.lineHits.values()].filter(hits => hits > 0).length
		}
	}
	return { instrumentedLines: { covered, measured }, unloadedExecutableFiles: unloaded.sort() }
}

export async function reportComponentCoverage(packageName: string, reportDirectory: string, repositoryRoot = process.cwd()) {
	assertComponentCoverageOwners()
	const owner = componentProjects().find(project => project.ci?.componentName === packageName)
	if (owner === undefined) throw new Error(`Unknown component coverage package: ${packageName}`)
	const packageRoot = resolve(repositoryRoot, owner.path)
	const output = resolve(repositoryRoot, reportDirectory)
	const commit = (await readFile(resolve(output, 'commit.txt'), 'utf8')).trim()
	if (commit !== runGit(['rev-parse', 'HEAD'], { cwd: repositoryRoot })) throw new Error('Component coverage belongs to another commit')
	const reports = (await walkFiles(output)).filter(file => file.endsWith('/lcov.info')).sort()
	if (reports.length === 0) throw new Error('Component coverage has no LCOV evidence')
	const captures = []
	const records: Map<string, LcovRecord>[] = []
	for (const report of reports) {
		const junit = await readFile(resolve(dirname(report), 'junit.xml'), 'utf8')
		validateJunitDocument(junit)
		const timings = parseJunitTestCaseSeconds(junit)
		if (timings.size === 0) throw new Error('Component coverage has no executed test-file manifest')
		const contents = await readFile(report, 'utf8')
		const normalized = new Map<string, LcovRecord>()
		for (const record of parseLcov(contents, packageRoot).values()) {
			const file = relative(repositoryRoot, resolve(packageRoot, record.file)).replaceAll('\\', '/')
			normalized.set(file, { ...record, file })
		}
		if (normalized.size === 0) throw new Error('Component coverage has no instrumented line records')
		records.push(normalized)
		captures.push({ report: relative(output, report), bytes: Buffer.byteLength(contents), files: [...timings.keys()].sort(), summedTestSeconds: [...timings.values()].reduce((sum, seconds) => sum + seconds, 0) })
	}
	const sourceFiles = listRepositoryFiles({ cwd: repositoryRoot, pathspec: [owner.path] }).filter(file => /\/(src|browser|scripts)\/.+\.[cm]?tsx?$/.test(file) && !/\.d\.[cm]?ts$|\.generated\.[cm]?tsx?$/.test(file) && !owner.generatedFiles?.includes(file))
	const sources = await Promise.all(sourceFiles.map(async file => ({ file, source: await readFile(resolve(repositoryRoot, file), 'utf8') })))
	const summary = {
		package: packageName,
		commit,
		worktreeDirty: runGit(['status', '--porcelain', '--untracked-files=normal'], { cwd: repositoryRoot }) !== '',
		mode: 'report-only',
		sourceRoots: ['src', 'browser', 'scripts'],
		captures,
		ciPlan: createComponentCiPlan(packageName),
		...summarizeComponentCoverage(mergeLcovRecords(records), sources),
		prerequisites: 'Existing component CI setup and package test commands; PostgreSQL and Chromium evidence remain separate captures.',
		limitations: [
			'Instrumented lines are not a package-wide coverage percentage.',
			'Unloaded executable files have no inferred line denominator.',
			'Subprocess and browser execution is excluded unless independently instrumented.',
			'Summed test time excludes setup, builds and runner overhead.',
			'No coverage threshold is imposed; package results do not join the root aggregate.',
		],
	}
	await writeFile(resolve(output, 'component-summary.json'), `${JSON.stringify(summary, undefined, 2)}\n`)
	return summary
}

if (import.meta.main) {
	const [packageName, directory] = process.argv.slice(2)
	if (packageName === undefined || directory === undefined) throw new Error('Usage: component-coverage-report.mts <component> <coverage directory>')
	const report = await reportComponentCoverage(packageName, directory)
	console.log(`${report.package}: ${report.instrumentedLines.covered}/${report.instrumentedLines.measured} instrumented source lines; ${report.unloadedExecutableFiles.length} unloaded executable files. Report only.`)
}
