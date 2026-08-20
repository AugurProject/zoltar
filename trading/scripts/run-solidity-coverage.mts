import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'

const projectRoot = path.resolve(import.meta.dir, '..')
const repositoryRoot = path.resolve(projectRoot, '..')
const coverageDirectory = path.join(projectRoot, 'coverage', 'contracts')
const summaryPath = path.join(coverageDirectory, 'coverage-summary.json')
const minimumCoverage = 99

type CoverageFile = {
	readonly file: string
	readonly lineHits: Readonly<Record<string, number>>
}

type CoverageSummary = {
	readonly files: Readonly<Record<string, CoverageFile>>
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const parseSummary = (value: unknown): CoverageSummary => {
	if (!isRecord(value) || !isRecord(value['files'])) throw new Error('Invalid trading Solidity coverage summary')
	const files: Record<string, CoverageFile> = {}
	for (const [absolutePath, rawFile] of Object.entries(value['files'])) {
		if (!isRecord(rawFile) || typeof rawFile['file'] !== 'string' || !isRecord(rawFile['lineHits'])) throw new Error(`Invalid coverage entry for ${absolutePath}`)
		const lineHits: Record<string, number> = {}
		for (const [line, hits] of Object.entries(rawFile['lineHits'])) {
			if (typeof hits !== 'number') throw new Error(`Invalid hit count for ${absolutePath}:${line}`)
			lineHits[line] = hits
		}
		files[absolutePath] = { file: rawFile['file'], lineHits }
	}
	return { files }
}

const isProductionTradingContract = (file: string) => {
	const relativePath = path.relative(repositoryRoot, file).replaceAll('\\', '/')
	return relativePath.startsWith('trading/contracts/') && !relativePath.startsWith('trading/contracts/test/') && !relativePath.startsWith('trading/contracts/interfaces/')
}

await rm(coverageDirectory, { recursive: true, force: true })
const testProcess = Bun.spawn(['bun', 'test', '--timeout', '300000', './ts/tests/pairRouter.integration.test.ts', './ts/tests/solidityMath.test.ts'], {
	cwd: projectRoot,
	env: {
		...Bun.env,
		SOLIDITY_BYTECODE_COVERAGE: '1',
		SOLIDITY_BYTECODE_COVERAGE_ROOT_PATH: repositoryRoot,
		SOLIDITY_BYTECODE_COVERAGE_ARTIFACTS_PATH: path.join(projectRoot, 'artifacts', 'Contracts.json'),
		SOLIDITY_BYTECODE_COVERAGE_DIRECTORY: coverageDirectory,
	},
	stdout: 'inherit',
	stderr: 'inherit',
})
const testExitCode = await testProcess.exited
if (testExitCode !== 0) process.exit(testExitCode)

const summary = parseSummary(JSON.parse(await readFile(summaryPath, 'utf8')))
const productionFiles = Object.values(summary.files).filter(file => isProductionTradingContract(file.file))
let coveredLines = 0
let totalLines = 0
const uncoveredLines: string[] = []
for (const file of productionFiles) {
	const relativePath = path.relative(repositoryRoot, file.file).replaceAll('\\', '/')
	for (const [line, hits] of Object.entries(file.lineHits)) {
		totalLines++
		if (hits > 0) coveredLines++
		else uncoveredLines.push(`${relativePath}:${line}`)
	}
}
if (totalLines === 0) throw new Error('Trading Solidity coverage found no executable production lines')
const coverage = (coveredLines * 100) / totalLines
console.log(`Trading Solidity line coverage: ${coverage.toFixed(3)}% (${coveredLines}/${totalLines})`)
if (coverage < minimumCoverage) {
	console.error(`Trading Solidity line coverage is below ${minimumCoverage.toFixed(2)}%`)
	for (const line of uncoveredLines) console.error(`- ${line}`)
	process.exit(1)
}
