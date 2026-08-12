import { promises as fs } from 'node:fs'
import * as path from 'node:path'

export const TEST_TIMING_HISTORY_VERSION = 1
export const MAXIMUM_TIMING_SAMPLES = 5

export type TestTimingHistory = {
	version: typeof TEST_TIMING_HISTORY_VERSION
	samplesByFile: Record<string, number[]>
}

export type TestTimingObservation = {
	version: typeof TEST_TIMING_HISTORY_VERSION
	elapsedSeconds: number
	testCaseSecondsByFile: Record<string, number>
	testFiles: string[]
}

function normalizeTestPath(filePath: string) {
	return filePath.replaceAll('\\', '/').replace(/^\.\//, '')
}

function decodeXmlAttribute(value: string) {
	return value.replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')
}

function getXmlAttribute(tag: string, name: string) {
	const match = new RegExp(`\\s${name}="([^"]*)"`).exec(tag)
	return match?.[1] === undefined ? undefined : decodeXmlAttribute(match[1])
}

export function parseJunitTestCaseSeconds(junitXml: string) {
	const secondsByFile = new Map<string, number>()
	for (const match of junitXml.matchAll(/<testcase\b[^>]*>/g)) {
		const tag = match[0]
		const filePath = getXmlAttribute(tag, 'file')
		const secondsText = getXmlAttribute(tag, 'time')
		if (filePath === undefined || secondsText === undefined) continue
		const seconds = Number(secondsText)
		if (!Number.isFinite(seconds) || seconds < 0) continue
		const normalizedPath = normalizeTestPath(filePath)
		secondsByFile.set(normalizedPath, (secondsByFile.get(normalizedPath) ?? 0) + seconds)
	}
	return secondsByFile
}

export function createTestTimingObservation(junitXml: string, elapsedSeconds: number, testFiles: readonly string[]): TestTimingObservation {
	if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) throw new Error('Test shard elapsed time must be a non-negative finite number')
	const normalizedFiles = [...new Set(testFiles.map(normalizeTestPath))].sort((left, right) => left.localeCompare(right))
	const parsedSeconds = parseJunitTestCaseSeconds(junitXml)
	return {
		version: TEST_TIMING_HISTORY_VERSION,
		elapsedSeconds,
		testCaseSecondsByFile: Object.fromEntries(normalizedFiles.map(filePath => [filePath, parsedSeconds.get(filePath) ?? 0])),
		testFiles: normalizedFiles,
	}
}

export function estimateObservationFileSeconds(observation: TestTimingObservation) {
	const testCaseTotal = observation.testFiles.reduce((total, filePath) => total + (observation.testCaseSecondsByFile[filePath] ?? 0), 0)
	const scale = testCaseTotal > observation.elapsedSeconds && testCaseTotal > 0 ? observation.elapsedSeconds / testCaseTotal : 1
	const unreportedSeconds = Math.max(0, observation.elapsedSeconds - testCaseTotal * scale)
	const overheadPerFile = observation.testFiles.length === 0 ? 0 : unreportedSeconds / observation.testFiles.length
	return new Map(observation.testFiles.map(filePath => [filePath, (observation.testCaseSecondsByFile[filePath] ?? 0) * scale + overheadPerFile]))
}

function isTimingHistory(value: unknown): value is TestTimingHistory {
	if (typeof value !== 'object' || value === null) return false
	if (!('version' in value) || !('samplesByFile' in value)) return false
	if (value.version !== TEST_TIMING_HISTORY_VERSION || typeof value.samplesByFile !== 'object' || value.samplesByFile === null) return false
	return Object.values(value.samplesByFile).every(samples => Array.isArray(samples) && samples.every(sample => typeof sample === 'number' && Number.isFinite(sample) && sample >= 0))
}

export async function readTestTimingHistory(historyPath: string): Promise<TestTimingHistory | undefined> {
	try {
		const parsed: unknown = JSON.parse(await fs.readFile(historyPath, 'utf8'))
		if (!isTimingHistory(parsed)) throw new Error(`Invalid test timing history: ${historyPath}`)
		return parsed
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
		throw error
	}
}

export function mergeTestTimingHistory(previous: TestTimingHistory | undefined, observations: readonly TestTimingObservation[], currentTestFiles: readonly string[]): TestTimingHistory {
	const observedSeconds = new Map<string, number>()
	for (const observation of observations) {
		if (observation.version !== TEST_TIMING_HISTORY_VERSION) throw new Error('Unsupported test timing observation version')
		for (const [filePath, seconds] of estimateObservationFileSeconds(observation)) observedSeconds.set(filePath, (observedSeconds.get(filePath) ?? 0) + seconds)
	}

	const samplesByFile: Record<string, number[]> = {}
	for (const filePath of [...new Set(currentTestFiles.map(normalizeTestPath))].sort((left, right) => left.localeCompare(right))) {
		const priorSamples = previous?.samplesByFile[filePath] ?? []
		const observed = observedSeconds.get(filePath)
		const samples = observed === undefined ? priorSamples : [...priorSamples, observed]
		if (samples.length > 0) samplesByFile[filePath] = samples.slice(-MAXIMUM_TIMING_SAMPLES)
	}
	return { version: TEST_TIMING_HISTORY_VERSION, samplesByFile }
}

export function median(values: readonly number[]) {
	if (values.length === 0) return undefined
	const sorted = [...values].sort((left, right) => left - right)
	const middle = Math.floor(sorted.length / 2)
	const middleValue = sorted[middle]
	if (middleValue === undefined) return undefined
	if (sorted.length % 2 === 1) return middleValue
	const lowerValue = sorted[middle - 1]
	if (lowerValue === undefined) return undefined
	return (lowerValue + middleValue) / 2
}

export function getHistoricalTestWeights(history: TestTimingHistory, testFiles: readonly string[]) {
	const historicalWeights = Object.values(history.samplesByFile)
		.map(samples => median(samples))
		.filter(weight => weight !== undefined)
	const sortedWeights = historicalWeights.sort((left, right) => left - right)
	const fallbackIndex = Math.max(0, Math.ceil(sortedWeights.length * 0.75) - 1)
	const fallbackWeight = sortedWeights[fallbackIndex] ?? 1
	return testFiles.map(filePath => ({ filePath, weight: median(history.samplesByFile[filePath] ?? []) ?? fallbackWeight }))
}

export async function writeTestTimingObservation(outputPath: string, junitPath: string, elapsedSeconds: number, testFiles: readonly string[]) {
	let junitXml = ''
	try {
		junitXml = await fs.readFile(junitPath, 'utf8')
	} catch (error) {
		if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
	}
	const observation = createTestTimingObservation(junitXml, elapsedSeconds, testFiles)
	await fs.mkdir(path.dirname(outputPath), { recursive: true })
	await fs.writeFile(outputPath, `${JSON.stringify(observation, undefined, 2)}\n`)
}
