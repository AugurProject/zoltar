import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { mergeLcovRecords, normalizePath, type LcovRecord } from './lcov.mts'

const sourceExtensions = /\.(ts|tsx|mts|cts)$/

type TypeScriptSourceMap = {
	version: 3
	sources: string[]
	mappings: string
}

const generatedTypeScriptOutputPattern = /^(?:shared\/[^/]+|ui\/(?:coreShared|zoltarShared|statoblastShared|zoltar|statoblast|trading|openoracle))\/js\/.*\.js$/
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
			functions: { covered: record.functions.covered, total: record.functions.total },
			...(record.branches === undefined ? {} : { branches: { covered: record.branches.covered, total: record.branches.total } }),
		}
		const existing = remapped.get(sourceFile)
		if (existing === undefined) remapped.set(sourceFile, mappedRecord)
		else remapped.set(sourceFile, mergeLcovRecords([new Map([[sourceFile, existing]]), new Map([[sourceFile, mappedRecord]])]).get(sourceFile) ?? mappedRecord)
	}
	return remapped
}
