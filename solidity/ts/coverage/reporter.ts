import * as path from 'node:path'
import { promises as fs } from 'node:fs'
import type { SolidityBytecodeCoverageConfig } from './coverageConfig'

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

const computeTotals = (coverage: Map<string, Map<number, number>>): SolidityCoverageSummary => {
	const fileSummaries: Record<string, SolidityCoverageFileSummary> = {}
	let totalLines = 0
	let totalCoveredLines = 0

	for (const [absoluteFile, fileCoverage] of coverage.entries()) {
		let coveredLines = 0
		const lineHits: Record<string, number> = {}
		for (const [line, hitCount] of fileCoverage.entries()) {
			lineHits[`${line}`] = hitCount
			if (hitCount > 0) coveredLines++
		}
		const totalLinesInFile = fileCoverage.size
		fileSummaries[absoluteFile] = {
			file: absoluteFile,
			totalLines: totalLinesInFile,
			coveredLines,
			lineHits,
		}
		totalLines += totalLinesInFile
		totalCoveredLines += coveredLines
	}

	return {
		totalLines,
		totalCoveredLines,
		files: fileSummaries,
	}
}

const emitLcov = (coverage: Map<string, Map<number, number>>, config: SolidityBytecodeCoverageConfig): string => {
	const lines: string[] = []

	for (const [absoluteFile, fileCoverage] of coverage) {
		lines.push(`SF:${path.relative(config.rootPath, absoluteFile)}`)

		const lineEntries = [...fileCoverage.entries()].sort((first, second) => first[0] - second[0])
		for (const [line, hitCount] of lineEntries) lines.push(`DA:${line},${hitCount}`)

		const totalLines = fileCoverage.size
		const coveredLines = [...fileCoverage.values()].filter(count => count > 0).length
		lines.push(`LF:${totalLines}`)
		lines.push(`LH:${coveredLines}`)
		lines.push('end_of_record')
	}

	return `${lines.join('\n')}\n`
}

export const writeCoverageArtifacts = async (coverage: Map<string, Map<number, number>>, config: SolidityBytecodeCoverageConfig): Promise<void> => {
	await fs.mkdir(config.coverageDirectory, { recursive: true })

	const lcovOutput = emitLcov(coverage, config)
	await fs.writeFile(config.lcovPath, lcovOutput)

	const summary = computeTotals(coverage)
	await fs.writeFile(config.summaryPath, `${JSON.stringify(summary, null, 2)}\n`)
}
