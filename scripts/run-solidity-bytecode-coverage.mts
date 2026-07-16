import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { createBalancedTestShards, discoverTestFiles, toBunTestPath } from './test-discovery.mts'

const coverageDirectory = join(process.cwd(), 'solidity', 'coverage')
const summaryPath = join(coverageDirectory, 'coverage-summary.json')
const lcovPath = join(coverageDirectory, 'lcov.info')

interface SolidityCoverageFileSummary {
	readonly file: string
	readonly totalLines: number
	readonly coveredLines: number
	readonly lineHits: Record<string, number>
}

interface SolidityCoverageSummary {
	readonly totalLines: number
	readonly totalCoveredLines: number
	readonly files: Record<string, SolidityCoverageFileSummary>
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const parseCoverageFileSummary = (value: unknown): SolidityCoverageFileSummary | undefined => {
	if (!isRecord(value)) return undefined
	const file = value['file']
	const totalLines = value['totalLines']
	const coveredLines = value['coveredLines']
	const lineHitsValue = value['lineHits']
	if (typeof file !== 'string') return undefined
	if (typeof totalLines !== 'number') return undefined
	if (typeof coveredLines !== 'number') return undefined
	if (!isRecord(lineHitsValue)) return undefined
	const lineHits: Record<string, number> = {}
	for (const [line, hitCount] of Object.entries(lineHitsValue)) {
		if (typeof hitCount !== 'number') return undefined
		lineHits[line] = hitCount
	}
	return { file, totalLines, coveredLines, lineHits }
}

const parseCoverageSummary = (value: unknown): SolidityCoverageSummary | undefined => {
	if (!isRecord(value)) return undefined
	const totalLines = value['totalLines']
	const totalCoveredLines = value['totalCoveredLines']
	const filesValue = value['files']
	if (typeof totalLines !== 'number') return undefined
	if (typeof totalCoveredLines !== 'number') return undefined
	if (!isRecord(filesValue)) return undefined
	const files: Record<string, SolidityCoverageFileSummary> = {}
	for (const [absoluteFile, fileSummaryValue] of Object.entries(filesValue)) {
		const fileSummary = parseCoverageFileSummary(fileSummaryValue)
		if (fileSummary === undefined) return undefined
		files[absoluteFile] = fileSummary
	}
	return { totalLines, totalCoveredLines, files }
}

const readCoverageSummary = async (): Promise<SolidityCoverageSummary | undefined> => {
	let rawSummary: string
	try {
		rawSummary = await readFile(summaryPath, 'utf8')
	} catch (error) {
		if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
		return undefined
	}
	return parseCoverageSummary(JSON.parse(rawSummary))
}

const recomputeCoverageSummaryTotals = (files: Record<string, SolidityCoverageFileSummary>): SolidityCoverageSummary => {
	let totalLines = 0
	let totalCoveredLines = 0
	const summaries: Record<string, SolidityCoverageFileSummary> = {}
	for (const [absoluteFile, fileSummary] of Object.entries(files)) {
		const totalLinesInFile = Object.keys(fileSummary.lineHits).length
		const coveredLines = Object.values(fileSummary.lineHits).filter(hitCount => hitCount > 0).length
		summaries[absoluteFile] = {
			file: fileSummary.file,
			totalLines: totalLinesInFile,
			coveredLines,
			lineHits: fileSummary.lineHits,
		}
		totalLines += totalLinesInFile
		totalCoveredLines += coveredLines
	}
	return { totalLines, totalCoveredLines, files: summaries }
}

const mergeCoverageSummaries = (first: SolidityCoverageSummary | undefined, second: SolidityCoverageSummary): SolidityCoverageSummary => {
	if (first === undefined) return second
	const files: Record<string, SolidityCoverageFileSummary> = {}
	for (const summary of [first, second]) {
		for (const [absoluteFile, fileSummary] of Object.entries(summary.files)) {
			const existing = files[absoluteFile]
			const lineHits = { ...(existing?.lineHits ?? {}) }
			for (const [line, hitCount] of Object.entries(fileSummary.lineHits)) lineHits[line] = (lineHits[line] ?? 0) + hitCount
			files[absoluteFile] = {
				file: fileSummary.file,
				totalLines: 0,
				coveredLines: 0,
				lineHits,
			}
		}
	}
	return recomputeCoverageSummaryTotals(files)
}

const emitLcov = (summary: SolidityCoverageSummary): string => {
	const lines: string[] = []
	const fileSummaries = Object.values(summary.files).sort((first, second) => first.file.localeCompare(second.file))
	for (const fileSummary of fileSummaries) {
		lines.push(`SF:${relative(process.cwd(), fileSummary.file)}`)
		const lineEntries = Object.entries(fileSummary.lineHits).sort((first, second) => Number.parseInt(first[0], 10) - Number.parseInt(second[0], 10))
		for (const [line, hitCount] of lineEntries) lines.push(`DA:${line},${hitCount}`)
		lines.push(`LF:${fileSummary.totalLines}`)
		lines.push(`LH:${fileSummary.coveredLines}`)
		lines.push('end_of_record')
	}
	return `${lines.join('\n')}\n`
}

const writeCoverageSummary = async (summary: SolidityCoverageSummary): Promise<void> => {
	await mkdir(coverageDirectory, { recursive: true })
	await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`)
	await writeFile(lcovPath, emitLcov(summary))
}

const bytecodeCoverageWeights = new Map<string, number>([
	['solidity/ts/tests/peripherals/forkMigration.test.ts', 30],
	['solidity/ts/tests/peripherals/truthAuction.test.ts', 24],
	['solidity/ts/tests/escalationGame.test.ts', 18],
	['solidity/ts/tests/peripherals/escalationMigration.test.ts', 18],
	['solidity/ts/tests/peripheralsInvariant.test.ts', 12],
	['solidity/ts/tests/priceOracleSecurity.test.ts', 10],
	['solidity/ts/tests/openOracleDispute.test.ts', 5],
])

export async function discoverSolidityBytecodeTestFiles(repositoryRoot = process.cwd()) {
	const files = await discoverTestFiles(repositoryRoot, ['solidity/ts'])
	return files.filter(file => file.startsWith('solidity/ts/tests/') || file.startsWith('solidity/ts/fuzz/'))
}

export async function createSolidityBytecodeTestShards(repositoryRoot = process.cwd(), shardCount = 2) {
	const files = await discoverSolidityBytecodeTestFiles(repositoryRoot)
	const weightedFiles = files.map(filePath => ({ filePath, weight: bytecodeCoverageWeights.get(filePath) ?? 1 })).sort((left, right) => right.weight - left.weight || left.filePath.localeCompare(right.filePath))
	return createBalancedTestShards(weightedFiles, shardCount).map(shard => shard.files)
}

if (import.meta.main) {
	const testShards = await createSolidityBytecodeTestShards()
	const shardArgumentIndex = process.argv.findIndex(argument => argument === '--shard')
	const shardNumberArgument = shardArgumentIndex === -1 ? undefined : process.argv[shardArgumentIndex + 1]
	const shardNumber = shardNumberArgument === undefined ? undefined : Number.parseInt(shardNumberArgument, 10)
	let selectedShards = testShards
	if (shardNumber !== undefined) {
		const selectedShard = testShards[shardNumber - 1]
		if (selectedShard === undefined) throw new Error(`Unknown Solidity bytecode coverage shard: ${shardNumberArgument}`)
		selectedShards = [selectedShard]
	}

	let mergedSummary = process.argv.includes('--no-clean') ? await readCoverageSummary() : undefined

	for (const testShard of selectedShards) {
		const shardIndex = testShards.indexOf(testShard) + 1
		console.log(`Running Solidity bytecode coverage shard ${shardIndex}/${testShards.length}`)
		await rm(coverageDirectory, { recursive: true, force: true })
		const shardProcess = Bun.spawn(['bun', 'test', '--timeout', '300000', ...testShard.map(toBunTestPath)], {
			env: {
				...Bun.env,
				SOLIDITY_BYTECODE_COVERAGE: '1',
			},
			stdout: 'inherit',
			stderr: 'inherit',
		})
		const exitCode = await shardProcess.exited
		if (exitCode !== 0) globalThis.process.exit(exitCode)
		const shardSummary = await readCoverageSummary()
		if (shardSummary === undefined) throw new Error(`Coverage shard ${shardIndex} did not write a summary`)
		mergedSummary = mergeCoverageSummaries(mergedSummary, shardSummary)
		await writeCoverageSummary(mergedSummary)
	}
}
