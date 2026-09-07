import { readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
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
			maximumAllowedUnloadedFiles: number
			unloadedFilesReviewBy: string
		}
	>
	solidity: {
		minimumFirstPartyLines: number
		minimumImportedLines: number
		minimumAggregateLines: number
		requireNoUncoveredLines: boolean
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
const importedSolidityContracts = ['solidity/contracts/statoblast/WETH9.sol', 'solidity/contracts/statoblast/Multicall3.sol', 'solidity/contracts/statoblast/openOracle/']

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
	let declaredLines: number | undefined
	let declaredCoveredLines: number | undefined
	let declaredBranches: number | undefined
	let declaredCoveredBranches: number | undefined
	let declaredFunctions = false
	let declaredCoveredFunctions = false
	let recordTerminated = true
	const branchIdentities = new Set<string>()
	const functionDefinitions = new Set<string>()
	const functionHits = new Map<string, number>()
	const parseNonNegativeInteger = (text: string, label: string) => {
		if (!/^(?:0|[1-9][0-9]*)$/.test(text)) throw new Error(`Invalid LCOV ${label}: ${text}`)
		const value = Number(text)
		if (!Number.isSafeInteger(value)) throw new Error(`Invalid LCOV ${label}: ${text}`)
		return value
	}

	const finishRecord = () => {
		if (currentFile === undefined) return
		if (!recordTerminated) throw new Error(`Unterminated LCOV record: ${currentFile}`)
		if (records.has(currentFile)) throw new Error(`Duplicate LCOV SF record: ${currentFile}`)
		if (declaredLines === undefined || declaredCoveredLines === undefined) throw new Error(`LCOV record is missing LF/LH totals: ${currentFile}`)
		if (!declaredFunctions || !declaredCoveredFunctions) throw new Error(`LCOV record is missing FNF/FNH totals: ${currentFile}`)
		const hasDetailedFunctionEvidence = functionDefinitions.size > 0 || functionHits.size > 0
		if (hasDetailedFunctionEvidence && (functionDefinitions.size !== functionTotal || functionHits.size !== functionTotal || [...functionHits.keys()].some(name => !functionDefinitions.has(name)))) throw new Error(`LCOV FNF total does not match FN/FNDA entries: ${currentFile}`)
		if (hasDetailedFunctionEvidence && [...functionHits.values()].filter(hits => hits > 0).length !== functionCovered) throw new Error(`LCOV FNH total does not match FNDA entries: ${currentFile}`)
		const coveredLines = [...lineHits.values()].filter(hits => hits > 0).length
		if (declaredLines !== lineHits.size || declaredCoveredLines !== coveredLines) throw new Error(`LCOV LF/LH totals do not match DA entries: ${currentFile}`)
		if (functionCovered > functionTotal) throw new Error(`LCOV FNH exceeds FNF: ${currentFile}`)
		if ((sawBranchData || declaredBranches !== undefined || declaredCoveredBranches !== undefined) && (declaredBranches !== branchTotal || declaredCoveredBranches !== branchCovered)) throw new Error(`LCOV BRF/BRH totals do not match BRDA entries: ${currentFile}`)
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
		declaredLines = undefined
		declaredCoveredLines = undefined
		declaredBranches = undefined
		declaredCoveredBranches = undefined
		declaredFunctions = false
		declaredCoveredFunctions = false
		branchIdentities.clear()
		functionDefinitions.clear()
		functionHits.clear()
	}

	for (const line of contents.split(/\r?\n/)) {
		if (line.startsWith('SF:')) {
			if (currentFile !== undefined) finishRecord()
			currentFile = normalizePath(line.slice(3), repositoryRoot)
			if (currentFile === '') throw new Error('LCOV SF path must not be empty')
			recordTerminated = false
			continue
		}
		if (/^(?:LF|LH|FN|FNDA|FNF|FNH|BRDA|BRF|BRH):/.test(line) && currentFile === undefined) throw new Error(`LCOV record field appears outside a record: ${line}`)
		if (line.startsWith('DA:')) {
			if (currentFile === undefined) throw new Error('LCOV DA entry appears outside a record')
			const [lineNumberValue, hitCountValue] = line.slice(3).split(',', 2)
			const lineNumber = parseNonNegativeInteger(lineNumberValue ?? '', 'DA line')
			const hitCount = parseNonNegativeInteger(hitCountValue ?? '', 'DA hits')
			if (lineNumber === 0) throw new Error('LCOV DA line numbers must be positive')
			if (lineHits.has(lineNumber)) throw new Error(`Duplicate LCOV DA entry: ${lineNumber.toString()}`)
			lineHits.set(lineNumber, hitCount)
			continue
		}
		if (line.startsWith('LF:')) {
			if (declaredLines !== undefined) throw new Error('Duplicate LCOV LF declaration')
			declaredLines = parseNonNegativeInteger(line.slice(3), 'LF')
		}
		if (line.startsWith('LH:')) {
			if (declaredCoveredLines !== undefined) throw new Error('Duplicate LCOV LH declaration')
			declaredCoveredLines = parseNonNegativeInteger(line.slice(3), 'LH')
		}
		if (line.startsWith('FNF:')) {
			if (declaredFunctions) throw new Error('Duplicate LCOV FNF declaration')
			declaredFunctions = true
			functionTotal = parseNonNegativeInteger(line.slice(4), 'FNF')
			continue
		}
		if (line.startsWith('FN:')) {
			const separator = line.indexOf(',', 3)
			if (separator === -1) throw new Error(`Invalid LCOV FN entry: ${line}`)
			const functionLine = parseNonNegativeInteger(line.slice(3, separator), 'FN line')
			const name = line.slice(separator + 1)
			if (functionLine === 0 || name === '' || functionDefinitions.has(name)) throw new Error(`Invalid or duplicate LCOV FN entry: ${line}`)
			functionDefinitions.add(name)
			continue
		}
		if (line.startsWith('FNDA:')) {
			const separator = line.indexOf(',', 5)
			if (separator === -1) throw new Error(`Invalid LCOV FNDA entry: ${line}`)
			const hits = parseNonNegativeInteger(line.slice(5, separator), 'FNDA hits')
			const name = line.slice(separator + 1)
			if (name === '' || functionHits.has(name)) throw new Error(`Invalid or duplicate LCOV FNDA entry: ${line}`)
			functionHits.set(name, hits)
			continue
		}
		if (line.startsWith('FNH:')) {
			if (declaredCoveredFunctions) throw new Error('Duplicate LCOV FNH declaration')
			declaredCoveredFunctions = true
			functionCovered = parseNonNegativeInteger(line.slice(4), 'FNH')
			continue
		}
		if (line.startsWith('BRDA:')) {
			sawBranchData = true
			const fields = line.slice(5).split(',')
			if (fields.length !== 4) throw new Error(`Invalid LCOV BRDA entry: ${line}`)
			const [lineText, blockText, branchText, taken] = fields
			if (parseNonNegativeInteger(lineText ?? '', 'BRDA line') === 0) throw new Error('LCOV BRDA line numbers must be positive')
			parseNonNegativeInteger(blockText ?? '', 'BRDA block')
			parseNonNegativeInteger(branchText ?? '', 'BRDA branch')
			const identity = fields.slice(0, 3).join(',')
			if (branchIdentities.has(identity)) throw new Error(`Duplicate LCOV BRDA entry: ${identity}`)
			branchIdentities.add(identity)
			branchTotal += 1
			if (taken !== undefined && taken !== '-' && parseNonNegativeInteger(taken, 'BRDA taken') > 0) branchCovered += 1
			continue
		}
		if (line.startsWith('BRF:')) {
			if (declaredBranches !== undefined) throw new Error('Duplicate LCOV BRF declaration')
			declaredBranches = parseNonNegativeInteger(line.slice(4), 'BRF')
		}
		if (line.startsWith('BRH:')) {
			if (declaredCoveredBranches !== undefined) throw new Error('Duplicate LCOV BRH declaration')
			declaredCoveredBranches = parseNonNegativeInteger(line.slice(4), 'BRH')
		}
		if (line === 'end_of_record') {
			if (currentFile === undefined) throw new Error('LCOV end_of_record appears outside a record')
			recordTerminated = true
			finishRecord()
		}
	}
	if (currentFile !== undefined) finishRecord()
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

type TypeScriptSourceMap = {
	version: 3
	sources: string[]
	mappings: string
}

const generatedTypeScriptOutputPattern = /^(?:shared|ui\/(?:coreShared|zoltarDomain|statoblastDomain|tradingDomain|zoltar|statoblast|trading))\/js\/.*\.js$/
const base64Digits = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const decodeVlqSegment = (segment: string): number[] => {
	const values: number[] = []
	let value = 0
	let shift = 0
	for (const character of segment) {
		const digit = base64Digits.indexOf(character)
		if (digit === -1) throw new Error(`Invalid source-map VLQ character: ${character}`)
		value += (digit & 31) * 2 ** shift
		if ((digit & 32) !== 0) {
			shift += 5
			continue
		}
		const negative = (value & 1) === 1
		values.push((negative ? -1 : 1) * Math.floor(value / 2))
		value = 0
		shift = 0
	}
	if (shift !== 0) throw new Error('Unterminated source-map VLQ segment')
	return values
}

export function decodeSourceMapOriginalLines(mappings: string): Map<number, ReadonlySet<number>> {
	const originalLinesByGeneratedLine = new Map<number, ReadonlySet<number>>()
	let previousSource = 0
	let previousOriginalLine = 0
	let previousOriginalColumn = 0
	let previousName = 0
	for (const [generatedLineIndex, line] of mappings.split(';').entries()) {
		let generatedColumn = 0
		const originalLines = new Set<number>()
		for (const encodedSegment of line.split(',')) {
			if (encodedSegment === '') continue
			const fields = decodeVlqSegment(encodedSegment)
			const generatedColumnDelta = fields[0]
			if (generatedColumnDelta === undefined) continue
			generatedColumn += generatedColumnDelta
			if (generatedColumn < 0 || (fields.length !== 1 && fields.length !== 4 && fields.length !== 5)) throw new Error('Invalid source-map segment')
			if (fields.length === 1) continue
			previousSource += fields[1] ?? 0
			previousOriginalLine += fields[2] ?? 0
			previousOriginalColumn += fields[3] ?? 0
			if (fields.length === 5) previousName += fields[4] ?? 0
			if (previousSource < 0 || previousOriginalLine < 0 || previousOriginalColumn < 0 || previousName < 0) throw new Error('Invalid negative source-map field')
			if (previousSource === 0) originalLines.add(previousOriginalLine + 1)
		}
		if (originalLines.size > 0) originalLinesByGeneratedLine.set(generatedLineIndex + 1, originalLines)
	}
	return originalLinesByGeneratedLine
}

const parseTypeScriptSourceMap = (value: unknown, mapPath: string): TypeScriptSourceMap | undefined => {
	if (typeof value !== 'object' || value === null) return undefined
	if (!('version' in value) || value.version !== 3 || !('sources' in value) || !Array.isArray(value.sources) || !value.sources.every(source => typeof source === 'string') || !('mappings' in value) || typeof value.mappings !== 'string') {
		throw new Error(`Invalid TypeScript source map: ${mapPath}`)
	}
	if (value.sources.length !== 1) return undefined
	return { version: 3, sources: value.sources, mappings: value.mappings }
}

export async function remapGeneratedTypeScriptLcovRecords(records: Map<string, LcovRecord>, repositoryRoot = process.cwd()): Promise<Map<string, LcovRecord>> {
	const remapped = new Map<string, LcovRecord>()
	for (const [generatedFile, record] of records) {
		if (!generatedTypeScriptOutputPattern.test(generatedFile)) continue
		const mapPath = resolve(repositoryRoot, `${generatedFile}.map`)
		let sourceMap: TypeScriptSourceMap | undefined
		try {
			sourceMap = parseTypeScriptSourceMap(JSON.parse(await readFile(mapPath, 'utf8')), mapPath)
		} catch (error) {
			if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue
			throw error
		}
		if (sourceMap === undefined) continue
		const source = sourceMap.sources[0]
		if (source === undefined) continue
		const sourceFile = normalizePath(resolve(dirname(mapPath), source), repositoryRoot)
		if (!sourceExtensions.test(sourceFile)) continue
		const originalLinesByGeneratedLine = decodeSourceMapOriginalLines(sourceMap.mappings)
		const lineHits = new Map<number, number>()
		for (const [generatedLine, hitCount] of record.lineHits) {
			const originalLines = originalLinesByGeneratedLine.get(generatedLine)
			if (originalLines === undefined) continue
			for (const originalLine of originalLines) lineHits.set(originalLine, (lineHits.get(originalLine) ?? 0) + hitCount)
		}
		if (lineHits.size === 0) continue
		const mappedRecord: LcovRecord = {
			file: sourceFile,
			lineHits,
			functions: { ...record.functions },
			...(record.branches === undefined ? {} : { branches: { ...record.branches } }),
		}
		const existing = remapped.get(sourceFile)
		if (existing === undefined) remapped.set(sourceFile, mappedRecord)
		else remapped.set(sourceFile, mergeLcovRecords([new Map([[sourceFile, existing]]), new Map([[sourceFile, mappedRecord]])]).get(sourceFile) ?? mappedRecord)
	}
	return remapped
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
	return file === 'ui/coreShared/ts/contractArtifact.ts' || file === 'solidity/ts/types/contractArtifact.ts' || /^ui\/(?:zoltar|statoblast|trading)\/(?:vendor|js)\//.test(file) || file.startsWith('shared/js/')
}

export function classifyTypeScriptSource(filePath: string, source: string): TypeScriptSurfaceName | undefined {
	const file = normalizePath(filePath)
	if (!sourceExtensions.test(file) || /\.d\.(ts|mts|cts)$/.test(file)) return undefined
	if (testSourcePattern.test(file) || file.includes('/tests/') || file.includes('/testSupport/') || file.includes('/testing/')) return undefined
	if (isGeneratedSource(file)) return undefined

	const scriptKind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
	const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, scriptKind)
	if (!sourceFile.statements.some(hasRuntimeStatement)) return undefined

	if (/^ui\/(?:coreShared|zoltarDomain|statoblastDomain|tradingDomain|zoltar|statoblast|trading)\/ts\//.test(file) && !/^ui\/(?:zoltar|statoblast|trading)\/ts\/(?:index\.dev|liveReload)\.ts$/.test(file)) return 'ui'
	if (file.startsWith('shared/ts/')) return 'shared'
	if (file.startsWith('scripts/') || file.startsWith('tooling/') || /^ui\/(?:zoltar|statoblast|trading)\/ts\/(?:index\.dev|liveReload)\.ts$/.test(file) || file.startsWith('solidity/ts/')) return 'tooling'
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

	let declaredTotal = 0
	let declaredCovered = 0
	for (const fileSummary of Object.values(summary.files)) {
		const file = normalizePath(fileSummary.file, repositoryRoot)
		const imported = isImportedSolidityContract(file)
		const entries = Object.entries(fileSummary.lineHits)
		if (!Number.isSafeInteger(fileSummary.totalLines) || !Number.isSafeInteger(fileSummary.coveredLines) || fileSummary.totalLines < 0 || fileSummary.coveredLines < 0 || fileSummary.coveredLines > fileSummary.totalLines) throw new Error(`Invalid Solidity coverage totals: ${file}`)
		if (entries.some(([line, hits]) => !/^[1-9][0-9]*$/.test(line) || !Number.isSafeInteger(hits) || hits < 0)) throw new Error(`Invalid Solidity line evidence: ${file}`)
		const coveredEntries = entries.filter(([, hits]) => hits > 0).length
		if (fileSummary.totalLines !== entries.length || fileSummary.coveredLines !== coveredEntries) throw new Error(`Solidity coverage totals do not match line hits: ${file}`)
		declaredTotal += fileSummary.totalLines
		declaredCovered += fileSummary.coveredLines
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
	if (summary.totalLines !== declaredTotal || summary.totalCoveredLines !== declaredCovered) throw new Error('Global Solidity coverage totals do not match file evidence')
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

export function evaluateCoveragePolicy(report: CompleteCoverage, policy: CoveragePolicy, currentUtcDate = new Date().toISOString().slice(0, 10)) {
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
		if (surfacePolicy.allowedUnloadedFiles.length > surfacePolicy.maximumAllowedUnloadedFiles) failures.push(`TypeScript ${surfaceName} allows ${surfacePolicy.allowedUnloadedFiles.length.toString()} unloaded files, exceeding its cap of ${surfacePolicy.maximumAllowedUnloadedFiles.toString()}`)
		if (surfacePolicy.unloadedFilesReviewBy < currentUtcDate) failures.push(`TypeScript ${surfaceName} unloaded-file exceptions require review by ${surfacePolicy.unloadedFilesReviewBy}`)
	}
	if (report.solidity !== undefined && belowMinimum(report.solidity.firstParty, policy.solidity.minimumFirstPartyLines)) {
		failures.push(`First-party Solidity line coverage ${formatExact(report.solidity.firstParty)}% is below ${policy.solidity.minimumFirstPartyLines.toFixed(3)}%`)
	}
	if (report.solidity !== undefined && report.solidity.firstParty.total === 0) failures.push('First-party Solidity coverage contains no executable line evidence')
	if (report.solidity !== undefined && belowMinimum(report.solidity.imported, policy.solidity.minimumImportedLines)) {
		failures.push(`Imported Solidity line coverage ${formatExact(report.solidity.imported)}% is below ${policy.solidity.minimumImportedLines.toFixed(3)}%`)
	}
	if (report.solidity !== undefined && belowMinimum(report.solidity.all, policy.solidity.minimumAggregateLines)) {
		failures.push(`Aggregate Solidity line coverage ${formatExact(report.solidity.all)}% is below ${policy.solidity.minimumAggregateLines.toFixed(3)}%`)
	}
	if (report.solidity !== undefined && policy.solidity.requireNoUncoveredLines) {
		const uncoveredLines = [...report.solidity.uncoveredFirstPartyLines, ...report.solidity.uncoveredImportedLines]
		if (uncoveredLines.length > 0) failures.push(`Solidity coverage has ${uncoveredLines.length.toString()} uncovered line${uncoveredLines.length === 1 ? '' : 's'}: ${uncoveredLines.join(', ')}`)
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
		const maximumAllowedUnloadedFiles = surfaceValue['maximumAllowedUnloadedFiles']
		const unloadedFilesReviewBy = surfaceValue['unloadedFilesReviewBy']
		if (typeof minimumLines !== 'number' || typeof minimumFunctions !== 'number') throw new Error(`Coverage policy has invalid TypeScript ${surfaceName} thresholds`)
		if (typeof maximumAllowedUnloadedFiles !== 'number' || !Number.isSafeInteger(maximumAllowedUnloadedFiles) || maximumAllowedUnloadedFiles < 0 || typeof unloadedFilesReviewBy !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(unloadedFilesReviewBy))
			throw new Error(`Coverage policy has invalid TypeScript ${surfaceName} unloaded-file governance`)
		if (!Array.isArray(allowedUnloadedFiles) || !allowedUnloadedFiles.every(file => typeof file === 'string')) {
			throw new Error(`Coverage policy has invalid TypeScript ${surfaceName} unloaded files`)
		}
		return { minimumLines, minimumFunctions, allowedUnloadedFiles, maximumAllowedUnloadedFiles, unloadedFilesReviewBy }
	}
	const minimumFirstPartyLines = solidityValue['minimumFirstPartyLines']
	const minimumImportedLines = solidityValue['minimumImportedLines']
	const minimumAggregateLines = solidityValue['minimumAggregateLines']
	const requireNoUncoveredLines = solidityValue['requireNoUncoveredLines']
	const minimumChangedLines = changedLinesValue['minimum']
	if (typeof minimumFirstPartyLines !== 'number' || typeof minimumImportedLines !== 'number' || typeof minimumAggregateLines !== 'number' || typeof requireNoUncoveredLines !== 'boolean' || typeof minimumChangedLines !== 'number') {
		throw new Error('Coverage policy has invalid non-TypeScript thresholds')
	}
	return {
		version: 1,
		typescript: {
			ui: parseSurfacePolicy('ui'),
			shared: parseSurfacePolicy('shared'),
			tooling: parseSurfacePolicy('tooling'),
		},
		solidity: { minimumFirstPartyLines, minimumImportedLines, minimumAggregateLines, requireNoUncoveredLines },
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

export function renderMarkdown(report: CompleteCoverage, testFileCount: number, policyResult: ReturnType<typeof evaluateCoveragePolicy>) {
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
	if (report.solidity !== undefined && report.solidity.uncoveredImportedLines.length > 0) {
		lines.push('', '## Uncovered imported Solidity lines', '', ...report.solidity.uncoveredImportedLines.map(line => `- \`${line}\``))
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
	const parsedLcov = parseLcov(await readFile(lcovPath, 'utf8'), repositoryRoot)
	const lcov = mergeLcovRecords([parsedLcov, await remapGeneratedTypeScriptLcovRecords(parsedLcov, repositoryRoot)])
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
