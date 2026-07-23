import { readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import * as ts from 'typescript'
import { discoverTestFiles } from './test-discovery.mts'

export type CoverageMetric = {
	covered: number
	total: number
	percentage: number
}

type UnavailableMetric = {
	available: false
}

export type TypeScriptSurfaceName = 'ui' | 'shared' | 'tooling'

export type TypeScriptSurfaceCoverage = {
	lines: CoverageMetric
	functions: CoverageMetric
	branches: CoverageMetric | UnavailableMetric
	sourceFiles: number
	loadedFiles: number
	unloadedFiles: string[]
}

export type TypeScriptCoverage = {
	surfaces: Record<TypeScriptSurfaceName, TypeScriptSurfaceCoverage>
	excludedFiles: string[]
}

export type LcovRecord = {
	file: string
	lineHits: Map<number, number>
	functions: {
		covered: number
		total: number
	}
	branches?: {
		covered: number
		total: number
	}
}

export type CoveragePolicy = {
	version: 1
	typescript: Record<
		TypeScriptSurfaceName,
		{
			minimumLines: number
			minimumFunctions: number
			allowedUnloadedFiles: string[]
		}
	>
	solidity: {
		minimumFirstPartyLines: number
	}
	changedLines: {
		minimum: number
	}
}

export type SolidityCoverageInput = {
	totalLines: number
	totalCoveredLines: number
	files: Record<
		string,
		{
			file: string
			totalLines: number
			coveredLines: number
			lineHits: Record<string, number>
		}
	>
}

export type SolidityCoverage = {
	firstParty: CoverageMetric
	imported: CoverageMetric
	all: CoverageMetric
	uncoveredFirstPartyLines: string[]
	uncoveredImportedLines: string[]
}

type CompleteCoverage = {
	typescript: TypeScriptCoverage
	solidity?: SolidityCoverage
	changedLines?: CoverageMetric | UnavailableMetric
}

const sourceExtensions = /\.(ts|tsx|mts|cts)$/
const testSourcePattern = /\.(test|spec|fuzz)\.(ts|tsx|mts|cts)$/
const importedSolidityContracts = ['solidity/contracts/peripherals/WETH9.sol', 'solidity/contracts/peripherals/Multicall3.sol', 'solidity/contracts/peripherals/openOracle/']

function normalizePath(filePath: string, repositoryRoot = process.cwd()) {
	const normalized = filePath.replaceAll('\\', '/')
	if (!isAbsolute(normalized)) return normalized.replace(/^\.\//, '')
	return relative(repositoryRoot, normalized).replaceAll('\\', '/')
}

function percentage(covered: number, total: number) {
	if (total === 0) return 100
	return Math.round((covered / total) * 10_000) / 100
}

function exactPercentage(value: CoverageMetric) {
	if (value.total === 0) return 100
	return (value.covered / value.total) * 100
}

function metric(covered: number, total: number): CoverageMetric {
	return { covered, total, percentage: percentage(covered, total) }
}

export function parseLcov(contents: string, repositoryRoot = process.cwd()) {
	const records = new Map<string, LcovRecord>()
	let currentFile: string | undefined
	let lineHits = new Map<number, number>()
	let functionTotal = 0
	let functionCovered = 0
	let branchTotal = 0
	let branchCovered = 0
	let sawBranchData = false

	const finishRecord = () => {
		if (currentFile === undefined) return
		records.set(currentFile, {
			file: currentFile,
			lineHits,
			functions: { covered: functionCovered, total: functionTotal },
			...(sawBranchData ? { branches: { covered: branchCovered, total: branchTotal } } : {}),
		})
		currentFile = undefined
		lineHits = new Map()
		functionTotal = 0
		functionCovered = 0
		branchTotal = 0
		branchCovered = 0
		sawBranchData = false
	}

	for (const line of contents.split(/\r?\n/)) {
		if (line.startsWith('SF:')) {
			finishRecord()
			currentFile = normalizePath(line.slice(3), repositoryRoot)
			continue
		}
		if (line.startsWith('DA:')) {
			const [lineNumberValue, hitCountValue] = line.slice(3).split(',', 2)
			const lineNumber = Number.parseInt(lineNumberValue ?? '', 10)
			const hitCount = Number.parseInt(hitCountValue ?? '', 10)
			if (!Number.isNaN(lineNumber) && !Number.isNaN(hitCount)) lineHits.set(lineNumber, hitCount)
			continue
		}
		if (line.startsWith('FNF:')) {
			functionTotal = Number.parseInt(line.slice(4), 10)
			continue
		}
		if (line.startsWith('FNH:')) {
			functionCovered = Number.parseInt(line.slice(4), 10)
			continue
		}
		if (line.startsWith('BRDA:')) {
			sawBranchData = true
			branchTotal += 1
			const taken = line.slice(5).split(',')[3]
			if (taken !== undefined && taken !== '-' && Number.parseInt(taken, 10) > 0) branchCovered += 1
			continue
		}
		if (line === 'end_of_record') finishRecord()
	}
	finishRecord()
	return records
}

export function mergeLcovRecords(collections: readonly Map<string, LcovRecord>[]) {
	const merged = new Map<string, LcovRecord>()
	for (const records of collections) {
		for (const [file, record] of records) {
			const existing = merged.get(file)
			if (existing === undefined) {
				merged.set(file, {
					...record,
					lineHits: new Map(record.lineHits),
					...(record.branches === undefined ? {} : { branches: { ...record.branches } }),
				})
				continue
			}
			for (const [lineNumber, hitCount] of record.lineHits) {
				existing.lineHits.set(lineNumber, (existing.lineHits.get(lineNumber) ?? 0) + hitCount)
			}
			existing.functions.total = Math.max(existing.functions.total, record.functions.total)
			existing.functions.covered = Math.max(existing.functions.covered, record.functions.covered)
			if (record.branches !== undefined) {
				existing.branches = {
					total: Math.max(existing.branches?.total ?? 0, record.branches.total),
					covered: Math.max(existing.branches?.covered ?? 0, record.branches.covered),
				}
			}
		}
	}
	return merged
}

function isDeclareStatement(statement: ts.Statement) {
	return ts.canHaveModifiers(statement) && (ts.getModifiers(statement)?.some(modifier => modifier.kind === ts.SyntaxKind.DeclareKeyword) ?? false)
}

function hasRuntimeStatement(statement: ts.Statement): boolean {
	if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || (ts.isImportEqualsDeclaration(statement) && statement.isTypeOnly)) return false
	if (ts.isImportDeclaration(statement)) {
		if (statement.importClause === undefined) return true
		if (statement.importClause.isTypeOnly) return false
		if (statement.importClause.name !== undefined) return true
		const bindings = statement.importClause.namedBindings
		if (bindings === undefined || ts.isNamespaceImport(bindings)) return true
		return bindings.elements.some(element => !element.isTypeOnly)
	}
	if (ts.isExportDeclaration(statement)) return !statement.isTypeOnly && (statement.exportClause === undefined || !ts.isNamedExports(statement.exportClause) || statement.exportClause.elements.some(element => !element.isTypeOnly))
	if (ts.isFunctionDeclaration(statement)) return statement.body !== undefined
	if (ts.isVariableStatement(statement)) return !isDeclareStatement(statement)
	if (ts.isModuleDeclaration(statement)) return !isDeclareStatement(statement)
	if (ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) return !isDeclareStatement(statement)
	return !ts.isEmptyStatement(statement)
}

function unloadedSourceCoverage(file: string, source: string) {
	const scriptKind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
	const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, scriptKind)
	const executableLines = new Set<number>()
	let functions = 0
	const addLine = (node: ts.Node) => executableLines.add(sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1)
	const visit = (node: ts.Node) => {
		if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return
		if (ts.isStatement(node)) {
			if (!hasRuntimeStatement(node)) return
			if (!ts.isBlock(node)) addLine(node)
		}
		if (ts.isFunctionLike(node) && 'body' in node && node.body !== undefined) functions += 1
		if ((ts.isPropertyDeclaration(node) || ts.isParameter(node)) && node.initializer !== undefined) addLine(node)
		ts.forEachChild(node, visit)
	}
	visit(sourceFile)
	return { executableLines, functions }
}

function isGeneratedSource(file: string) {
	return file === 'ui/ts/contractArtifact.ts' || file === 'solidity/ts/types/contractArtifact.ts' || file.startsWith('ui/vendor/') || file.startsWith('ui/js/') || file.startsWith('shared/js/')
}

export function classifyTypeScriptSource(filePath: string, source: string): TypeScriptSurfaceName | undefined {
	const file = normalizePath(filePath)
	if (!sourceExtensions.test(file) || /\.d\.(ts|mts|cts)$/.test(file)) return undefined
	if (testSourcePattern.test(file) || file.includes('/tests/') || file.includes('/testSupport/') || file.includes('/testing/')) return undefined
	if (isGeneratedSource(file)) return undefined

	const scriptKind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
	const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, scriptKind)
	if (!sourceFile.statements.some(hasRuntimeStatement)) return undefined

	if (file.startsWith('ui/ts/') && file !== 'ui/ts/index.dev.ts' && file !== 'ui/ts/liveReload.ts') return 'ui'
	if (file.startsWith('shared/ts/')) return 'shared'
	if (file.startsWith('scripts/') || file.startsWith('ui/build/') || file === 'ui/dev-server.ts' || file === 'ui/ts/index.dev.ts' || file === 'ui/ts/liveReload.ts' || file.startsWith('solidity/ts/')) return 'tooling'
	return undefined
}

function emptySurface(): TypeScriptSurfaceCoverage {
	return {
		lines: metric(0, 0),
		functions: metric(0, 0),
		branches: { available: false },
		sourceFiles: 0,
		loadedFiles: 0,
		unloadedFiles: [],
	}
}

export function buildTypeScriptCoverage(records: Map<string, LcovRecord>, trackedSources: readonly { file: string; source: string }[]): TypeScriptCoverage {
	const surfaces: Record<TypeScriptSurfaceName, TypeScriptSurfaceCoverage> = {
		ui: emptySurface(),
		shared: emptySurface(),
		tooling: emptySurface(),
	}
	const excludedFiles: string[] = []
	const totals = {
		ui: { linesCovered: 0, linesTotal: 0, functionsCovered: 0, functionsTotal: 0, branchesCovered: 0, branchesTotal: 0, branchesAvailable: true },
		shared: { linesCovered: 0, linesTotal: 0, functionsCovered: 0, functionsTotal: 0, branchesCovered: 0, branchesTotal: 0, branchesAvailable: true },
		tooling: { linesCovered: 0, linesTotal: 0, functionsCovered: 0, functionsTotal: 0, branchesCovered: 0, branchesTotal: 0, branchesAvailable: true },
	}

	for (const trackedSource of trackedSources) {
		const file = normalizePath(trackedSource.file)
		const surfaceName = classifyTypeScriptSource(file, trackedSource.source)
		if (surfaceName === undefined) {
			excludedFiles.push(file)
			continue
		}
		const surface = surfaces[surfaceName]
		const total = totals[surfaceName]
		surface.sourceFiles += 1
		const record = records.get(file)
		if (record === undefined) {
			surface.unloadedFiles.push(file)
			const zeroHitCoverage = unloadedSourceCoverage(file, trackedSource.source)
			total.linesTotal += zeroHitCoverage.executableLines.size
			total.functionsTotal += zeroHitCoverage.functions
			continue
		}
		surface.loadedFiles += 1
		total.linesTotal += record.lineHits.size
		total.linesCovered += [...record.lineHits.values()].filter(hitCount => hitCount > 0).length
		total.functionsTotal += record.functions.total
		total.functionsCovered += record.functions.covered
		if (record.branches === undefined) {
			total.branchesAvailable = false
		} else {
			total.branchesTotal += record.branches.total
			total.branchesCovered += record.branches.covered
		}
	}

	for (const surfaceName of ['ui', 'shared', 'tooling'] as const) {
		const surface = surfaces[surfaceName]
		const total = totals[surfaceName]
		surface.lines = metric(total.linesCovered, total.linesTotal)
		surface.functions = metric(total.functionsCovered, total.functionsTotal)
		surface.branches = total.branchesAvailable && total.branchesTotal > 0 ? metric(total.branchesCovered, total.branchesTotal) : { available: false }
		surface.unloadedFiles.sort((left, right) => left.localeCompare(right))
	}
	excludedFiles.sort((left, right) => left.localeCompare(right))
	return { surfaces, excludedFiles }
}

export function parseChangedLines(diff: string) {
	const changedLines = new Map<string, Set<number>>()
	let currentFile: string | undefined
	let newLine = 0
	for (const line of diff.split(/\r?\n/)) {
		if (line.startsWith('+++ ')) {
			const pathValue = line.slice(4)
			currentFile = pathValue === '/dev/null' ? undefined : normalizePath(pathValue.replace(/^b\//, ''))
			continue
		}
		if (line.startsWith('@@ ')) {
			const match = /\+(\d+)/.exec(line)
			if (match?.[1] !== undefined) newLine = Number.parseInt(match[1], 10)
			continue
		}
		if (currentFile === undefined || line.startsWith('diff ') || line.startsWith('--- ')) continue
		if (line.startsWith('+')) {
			const fileLines = changedLines.get(currentFile) ?? new Set<number>()
			fileLines.add(newLine)
			changedLines.set(currentFile, fileLines)
			newLine += 1
		} else if (!line.startsWith('-')) {
			newLine += 1
		}
	}
	return changedLines
}

function isImportedSolidityContract(file: string) {
	return importedSolidityContracts.some(imported => (imported.endsWith('/') ? file.startsWith(imported) : file === imported))
}

export function summarizeSolidityCoverage(summary: SolidityCoverageInput, repositoryRoot = process.cwd()): SolidityCoverage {
	let firstPartyCovered = 0
	let firstPartyTotal = 0
	let importedCovered = 0
	let importedTotal = 0
	const uncoveredFirstPartyLines: string[] = []
	const uncoveredImportedLines: string[] = []

	for (const fileSummary of Object.values(summary.files)) {
		const file = normalizePath(fileSummary.file, repositoryRoot)
		const imported = isImportedSolidityContract(file)
		for (const [line, hitCount] of Object.entries(fileSummary.lineHits)) {
			if (imported) {
				importedTotal += 1
				if (hitCount > 0) importedCovered += 1
				else uncoveredImportedLines.push(`${file}:${line}`)
			} else {
				firstPartyTotal += 1
				if (hitCount > 0) firstPartyCovered += 1
				else uncoveredFirstPartyLines.push(`${file}:${line}`)
			}
		}
	}
	uncoveredFirstPartyLines.sort((left, right) => left.localeCompare(right))
	uncoveredImportedLines.sort((left, right) => left.localeCompare(right))
	return {
		firstParty: metric(firstPartyCovered, firstPartyTotal),
		imported: metric(importedCovered, importedTotal),
		all: metric(firstPartyCovered + importedCovered, firstPartyTotal + importedTotal),
		uncoveredFirstPartyLines,
		uncoveredImportedLines,
	}
}

export function evaluateCoveragePolicy(report: CompleteCoverage, policy: CoveragePolicy) {
	const failures: string[] = []
	const belowMinimum = (value: CoverageMetric, minimum: number) => exactPercentage(value) < minimum
	const formatExact = (value: CoverageMetric) => exactPercentage(value).toFixed(4)
	for (const surfaceName of ['ui', 'shared', 'tooling'] as const) {
		const surface = report.typescript.surfaces[surfaceName]
		const surfacePolicy = policy.typescript[surfaceName]
		if (belowMinimum(surface.lines, surfacePolicy.minimumLines)) {
			failures.push(`TypeScript ${surfaceName} line coverage ${formatExact(surface.lines)}% is below ${surfacePolicy.minimumLines.toFixed(3)}%`)
		}
		if (belowMinimum(surface.functions, surfacePolicy.minimumFunctions)) {
			failures.push(`TypeScript ${surfaceName} function coverage ${formatExact(surface.functions)}% is below ${surfacePolicy.minimumFunctions.toFixed(3)}%`)
		}
		const allowedUnloadedFiles = new Set(surfacePolicy.allowedUnloadedFiles)
		const newlyUnloadedFiles = surface.unloadedFiles.filter(file => !allowedUnloadedFiles.has(file))
		const staleAllowedFiles = surfacePolicy.allowedUnloadedFiles.filter(file => !surface.unloadedFiles.includes(file))
		if (newlyUnloadedFiles.length > 0) failures.push(`TypeScript ${surfaceName} has newly unloaded executable source: ${newlyUnloadedFiles.join(', ')}`)
		if (staleAllowedFiles.length > 0) failures.push(`TypeScript ${surfaceName} policy still allows source that is no longer unloaded: ${staleAllowedFiles.join(', ')}`)
	}
	if (report.solidity !== undefined && belowMinimum(report.solidity.firstParty, policy.solidity.minimumFirstPartyLines)) {
		failures.push(`First-party Solidity line coverage ${formatExact(report.solidity.firstParty)}% is below ${policy.solidity.minimumFirstPartyLines.toFixed(3)}%`)
	}
	if (report.changedLines === undefined || !('percentage' in report.changedLines)) {
		failures.push('Changed product TypeScript line coverage is unavailable')
	} else if (belowMinimum(report.changedLines, policy.changedLines.minimum)) {
		failures.push(`Changed product TypeScript line coverage ${formatExact(report.changedLines)}% is below ${policy.changedLines.minimum.toFixed(3)}%`)
	}
	return { passed: failures.length === 0, failures }
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function parsePolicy(value: unknown): CoveragePolicy {
	if (!isRecord(value) || value['version'] !== 1) throw new Error('Coverage policy must have version 1')
	const typescriptValue = value['typescript']
	const solidityValue = value['solidity']
	const changedLinesValue = value['changedLines']
	if (!isRecord(typescriptValue) || !isRecord(solidityValue) || !isRecord(changedLinesValue)) throw new Error('Coverage policy is incomplete')
	const parseSurfacePolicy = (surfaceName: TypeScriptSurfaceName) => {
		const surfaceValue = typescriptValue[surfaceName]
		if (!isRecord(surfaceValue)) throw new Error(`Coverage policy is missing TypeScript ${surfaceName}`)
		const minimumLines = surfaceValue['minimumLines']
		const minimumFunctions = surfaceValue['minimumFunctions']
		const allowedUnloadedFiles = surfaceValue['allowedUnloadedFiles']
		if (typeof minimumLines !== 'number' || typeof minimumFunctions !== 'number') throw new Error(`Coverage policy has invalid TypeScript ${surfaceName} thresholds`)
		if (!Array.isArray(allowedUnloadedFiles) || !allowedUnloadedFiles.every(file => typeof file === 'string')) {
			throw new Error(`Coverage policy has invalid TypeScript ${surfaceName} unloaded files`)
		}
		return { minimumLines, minimumFunctions, allowedUnloadedFiles }
	}
	const minimumFirstPartyLines = solidityValue['minimumFirstPartyLines']
	const minimumChangedLines = changedLinesValue['minimum']
	if (typeof minimumFirstPartyLines !== 'number' || typeof minimumChangedLines !== 'number') throw new Error('Coverage policy has invalid non-TypeScript thresholds')
	return {
		version: 1,
		typescript: {
			ui: parseSurfacePolicy('ui'),
			shared: parseSurfacePolicy('shared'),
			tooling: parseSurfacePolicy('tooling'),
		},
		solidity: { minimumFirstPartyLines },
		changedLines: { minimum: minimumChangedLines },
	}
}

function parseSoliditySummary(value: unknown): SolidityCoverageInput {
	if (!isRecord(value) || !isRecord(value['files'])) throw new Error('Invalid Solidity coverage summary')
	const files: SolidityCoverageInput['files'] = {}
	for (const [absoluteFile, fileValue] of Object.entries(value['files'])) {
		if (!isRecord(fileValue) || typeof fileValue['file'] !== 'string' || !isRecord(fileValue['lineHits'])) throw new Error(`Invalid Solidity coverage file: ${absoluteFile}`)
		const lineHits: Record<string, number> = {}
		for (const [line, hitCount] of Object.entries(fileValue['lineHits'])) {
			if (typeof hitCount !== 'number') throw new Error(`Invalid Solidity coverage hit count: ${absoluteFile}:${line}`)
			lineHits[line] = hitCount
		}
		const totalLines = fileValue['totalLines']
		const coveredLines = fileValue['coveredLines']
		if (typeof totalLines !== 'number' || typeof coveredLines !== 'number') throw new Error(`Invalid Solidity coverage totals: ${absoluteFile}`)
		files[absoluteFile] = { file: fileValue['file'], totalLines, coveredLines, lineHits }
	}
	const totalLines = value['totalLines']
	const totalCoveredLines = value['totalCoveredLines']
	if (typeof totalLines !== 'number' || typeof totalCoveredLines !== 'number') throw new Error('Invalid Solidity coverage totals')
	return { totalLines, totalCoveredLines, files }
}

async function runGit(args: string[], workingDirectory = process.cwd()) {
	const child = Bun.spawn(['git', ...args], { cwd: workingDirectory, stdout: 'pipe', stderr: 'pipe' })
	const stdout = await new Response(child.stdout).text()
	const stderr = await new Response(child.stderr).text()
	const exitCode = await child.exited
	if (exitCode !== 0) throw new Error(stderr.trim() || `git ${args.join(' ')} failed`)
	return stdout
}

export async function readTrackedTypeScriptSources(repositoryRoot: string) {
	const trackedFiles = (await runGit(['ls-files', '--cached', '--others', '--exclude-standard'], repositoryRoot))
		.split(/\r?\n/)
		.filter(file => sourceExtensions.test(file))
		.sort((left, right) => left.localeCompare(right))
	const sources = await Promise.all(
		trackedFiles.map(async file => {
			try {
				return { file, source: await readFile(resolve(repositoryRoot, file), 'utf8') }
			} catch (error) {
				if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
				throw error
			}
		}),
	)
	return sources.filter(source => source !== undefined)
}

function mergeChangedLines(target: Map<string, Set<number>>, source: Map<string, Set<number>>) {
	for (const [file, lines] of source) {
		const targetLines = target.get(file) ?? new Set<number>()
		for (const line of lines) targetLines.add(line)
		target.set(file, targetLines)
	}
}

export async function readTaskChangedLines(repositoryRoot: string, baseRef: string) {
	const mergeBase = (await runGit(['merge-base', baseRef, 'HEAD'], repositoryRoot)).trim()
	const diff = await runGit(['diff', '--unified=0', '--no-renames', mergeBase, '--'], repositoryRoot)
	const changedLines = parseChangedLines(diff)
	const untrackedFiles = (await runGit(['ls-files', '--others', '--exclude-standard'], repositoryRoot)).split(/\r?\n/).filter(file => sourceExtensions.test(file))
	for (const file of untrackedFiles) {
		const source = await readFile(resolve(repositoryRoot, file), 'utf8')
		const lineCount = source.endsWith('\n') ? source.split(/\r?\n/).length - 1 : source.split(/\r?\n/).length
		mergeChangedLines(changedLines, new Map([[normalizePath(file), new Set(Array.from({ length: lineCount }, (_, index) => index + 1))]]))
	}
	return changedLines
}

export function calculateChangedLineCoverage(changedLines: Map<string, Set<number>>, records: Map<string, LcovRecord>, sourceFiles: Map<string, string>) {
	let covered = 0
	let total = 0
	for (const [file, lines] of changedLines) {
		const source = sourceFiles.get(file)
		if (source === undefined) continue
		const record = records.get(file)
		if (record === undefined) {
			const executableLines = unloadedSourceCoverage(file, source).executableLines
			for (const line of lines) {
				if (executableLines.has(line)) total += 1
			}
			continue
		}
		for (const line of lines) {
			const hitCount = record.lineHits.get(line)
			if (hitCount === undefined) continue
			total += 1
			if (hitCount > 0) covered += 1
		}
	}
	return metric(covered, total)
}

function formatMetric(value: CoverageMetric) {
	return `${value.percentage.toFixed(2)}% (${value.covered}/${value.total})`
}

function renderMarkdown(report: CompleteCoverage, testFileCount: number, policyResult: ReturnType<typeof evaluateCoveragePolicy>) {
	const lines = ['# Coverage summary', '', `Canonical test files: ${testFileCount}`, '', '| TypeScript surface | Lines | Functions | Branches | Loaded source | Unloaded executable source |', '| --- | ---: | ---: | ---: | ---: | ---: |']
	for (const surfaceName of ['ui', 'shared', 'tooling'] as const) {
		const surface = report.typescript.surfaces[surfaceName]
		const branches = 'percentage' in surface.branches ? formatMetric(surface.branches) : 'Unavailable from Bun'
		lines.push(`| ${surfaceName} | ${formatMetric(surface.lines)} | ${formatMetric(surface.functions)} | ${branches} | ${surface.loadedFiles}/${surface.sourceFiles} | ${surface.unloadedFiles.length} |`)
	}
	if (report.solidity !== undefined) {
		lines.push('', '| Solidity surface | Lines |', '| --- | ---: |', `| First-party | ${formatMetric(report.solidity.firstParty)} |`, `| Imported compatibility contracts | ${formatMetric(report.solidity.imported)} |`, `| All | ${formatMetric(report.solidity.all)} |`)
	}
	if (report.changedLines !== undefined) {
		lines.push('', `Changed product TypeScript lines: ${'percentage' in report.changedLines ? formatMetric(report.changedLines) : 'Unavailable'}`)
	}
	for (const surfaceName of ['ui', 'shared', 'tooling'] as const) {
		const unloadedFiles = report.typescript.surfaces[surfaceName].unloadedFiles
		if (unloadedFiles.length === 0) continue
		lines.push('', `## Unloaded ${surfaceName} source`, '', ...unloadedFiles.map(file => `- \`${file}\``))
	}
	if (report.solidity !== undefined && report.solidity.uncoveredFirstPartyLines.length > 0) {
		lines.push('', '## Uncovered first-party Solidity lines', '', ...report.solidity.uncoveredFirstPartyLines.map(line => `- \`${line}\``))
	}
	lines.push('', `Policy: ${policyResult.passed ? 'passed' : 'failed'}`)
	if (!policyResult.passed) lines.push('', ...policyResult.failures.map(failure => `- ${failure}`))
	return `${lines.join('\n')}\n`
}

export function resolveCoverageBaseRef(args: readonly string[], environmentBaseRef: string | undefined) {
	const baseRefIndex = args.indexOf('--base-ref')
	if (baseRefIndex !== -1) {
		const explicitBaseRef = args[baseRefIndex + 1]
		if (explicitBaseRef === undefined || explicitBaseRef.startsWith('--')) throw new Error('--base-ref requires a git ref')
		return explicitBaseRef
	}
	return environmentBaseRef || 'origin/main'
}

async function main() {
	const repositoryRoot = process.cwd()
	const check = process.argv.includes('--check')
	const allowMissingSolidity = process.argv.includes('--allow-missing-solidity')
	const typescriptOnly = process.argv.includes('--typescript-only')
	const lcovPath = resolve(repositoryRoot, 'coverage/typescript/lcov.info')
	const lcov = parseLcov(await readFile(lcovPath, 'utf8'), repositoryRoot)
	const trackedSources = await readTrackedTypeScriptSources(repositoryRoot)
	const typescript = buildTypeScriptCoverage(lcov, trackedSources)

	const discoveredTestFiles = await discoverTestFiles(repositoryRoot)
	const testManifest: unknown = JSON.parse(await readFile(resolve(repositoryRoot, 'coverage/typescript/test-files.json'), 'utf8'))
	if (!isRecord(testManifest) || testManifest['status'] !== 'passed' || !Array.isArray(testManifest['files']) || JSON.stringify(testManifest['files']) !== JSON.stringify(discoveredTestFiles)) throw new Error('TypeScript coverage test manifest does not match canonical test discovery')

	let solidity: SolidityCoverage | undefined
	if (!typescriptOnly) {
		try {
			const soliditySummary = parseSoliditySummary(JSON.parse(await readFile(resolve(repositoryRoot, 'solidity/coverage/coverage-summary.json'), 'utf8')))
			solidity = summarizeSolidityCoverage(soliditySummary, repositoryRoot)
		} catch (error) {
			if (!allowMissingSolidity || !(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
		}
	}

	const baseRef = resolveCoverageBaseRef(process.argv, process.env['COVERAGE_BASE_REF'])
	const sourceFiles = new Map<string, string>(
		trackedSources
			.filter(source => {
				const surface = classifyTypeScriptSource(source.file, source.source)
				return surface === 'ui' || surface === 'shared'
			})
			.map(source => [source.file, source.source]),
	)
	const changedLines = calculateChangedLineCoverage(await readTaskChangedLines(repositoryRoot, baseRef), lcov, sourceFiles)

	const report: CompleteCoverage = { typescript, ...(solidity === undefined ? {} : { solidity }), changedLines }
	const policy = parsePolicy(JSON.parse(await readFile(resolve(repositoryRoot, '.coverage-policy.json'), 'utf8')))
	const policyResult = evaluateCoveragePolicy(report, policy)
	await writeFile(resolve(repositoryRoot, 'coverage/coverage-summary.json'), `${JSON.stringify({ testFiles: discoveredTestFiles.length, ...report, policy: policyResult }, undefined, 2)}\n`)
	await writeFile(resolve(repositoryRoot, 'coverage/coverage-summary.md'), renderMarkdown(report, discoveredTestFiles.length, policyResult))

	console.log(renderMarkdown(report, discoveredTestFiles.length, policyResult))
	if (check && !policyResult.passed) process.exit(1)
}

if (import.meta.main) await main()
