import { promises as fs } from 'node:fs'
import * as path from 'node:path'

export const TEST_TIMING_HISTORY_VERSION = 1
export const MAXIMUM_TIMING_SAMPLES = 5
export const MINIMUM_REGRESSION_HISTORY_SAMPLES = 3
export const MINIMUM_TIMING_REGRESSION_SECONDS = 10
export const MAXIMUM_TIMING_REGRESSION_RATIO = 0.5

export type TestTimingHistory = {
	fingerprintsByFile?: Record<string, string>
	version: typeof TEST_TIMING_HISTORY_VERSION
	samplesByFile: Record<string, number[]>
}

export type TestTimingObservation = {
	version: typeof TEST_TIMING_HISTORY_VERSION
	elapsedSeconds: number
	fingerprintsByFile?: Record<string, string>
	testCaseSecondsByFile: Record<string, number>
	testFiles: string[]
}

export type TestTimingRegression = {
	baselineSeconds: number
	currentSeconds: number
	filePath: string
	increaseRatio: number
	increaseSeconds: number
}

export type TestTimingReport = {
	currentSecondsByFile: Map<string, number>
	regressions: TestTimingRegression[]
	shardBalance?: { fastestSeconds: number; imbalanceRatio: number; slowestSeconds: number }
	slowestFiles: { filePath: string; seconds: number }[]
	unstableFiles: { filePath: string; maximumSeconds: number; minimumSeconds: number; spreadRatio: number }[]
}

function normalizeTestPath(filePath: string) {
	return filePath.replaceAll('\\', '/').replace(/^\.\//, '')
}

async function createFileFingerprint(filePath: string, contextPaths: readonly string[]) {
	const hasher = new Bun.CryptoHasher('sha256')
	for (const inputPath of [filePath, ...contextPaths]) {
		hasher.update(normalizeTestPath(inputPath))
		hasher.update(await fs.readFile(inputPath))
	}
	return hasher.digest('hex')
}

export async function createTestFingerprints(testFiles: readonly string[], contextPaths: readonly string[]) {
	return Object.fromEntries(await Promise.all(testFiles.map(async filePath => [normalizeTestPath(filePath), await createFileFingerprint(filePath, contextPaths)] as const)))
}

export function filterTestTimingHistory(history: TestTimingHistory, currentFingerprints: Readonly<Record<string, string>>): TestTimingHistory {
	const samplesByFile = Object.fromEntries(Object.entries(history.samplesByFile).filter(([filePath]) => history.fingerprintsByFile?.[filePath] !== undefined && history.fingerprintsByFile[filePath] === currentFingerprints[filePath]))
	const fingerprintsByFile = Object.fromEntries(
		Object.keys(samplesByFile)
			.map(filePath => [filePath, currentFingerprints[filePath]])
			.filter((entry): entry is [string, string] => entry[1] !== undefined),
	)
	return { version: TEST_TIMING_HISTORY_VERSION, samplesByFile, ...(Object.keys(fingerprintsByFile).length === 0 ? {} : { fingerprintsByFile }) }
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
	if ('fingerprintsByFile' in value && (typeof value.fingerprintsByFile !== 'object' || value.fingerprintsByFile === null || !Object.values(value.fingerprintsByFile).every(fingerprint => typeof fingerprint === 'string'))) return false
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
		const observedFingerprint = observations.map(observation => observation.fingerprintsByFile?.[filePath]).find(fingerprint => fingerprint !== undefined)
		const priorFingerprint = previous?.fingerprintsByFile?.[filePath]
		const priorSamples = observedFingerprint !== undefined && priorFingerprint !== observedFingerprint ? [] : (previous?.samplesByFile[filePath] ?? [])
		const observed = observedSeconds.get(filePath)
		const samples = observed === undefined ? priorSamples : [...priorSamples, observed]
		if (samples.length > 0) samplesByFile[filePath] = samples.slice(-MAXIMUM_TIMING_SAMPLES)
	}
	const fingerprintsByFile = Object.fromEntries(
		Object.keys(samplesByFile)
			.map(filePath => [filePath, observations.map(observation => observation.fingerprintsByFile?.[filePath]).find(fingerprint => fingerprint !== undefined) ?? previous?.fingerprintsByFile?.[filePath]])
			.filter((entry): entry is [string, string] => entry[1] !== undefined),
	)
	return { version: TEST_TIMING_HISTORY_VERSION, samplesByFile, ...(Object.keys(fingerprintsByFile).length === 0 ? {} : { fingerprintsByFile }) }
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

export function createTestTimingReport(history: TestTimingHistory | undefined, observations: readonly TestTimingObservation[], options: { maximumSlowFiles?: number; maximumIncreaseRatio?: number; minimumHistorySamples?: number; minimumIncreaseSeconds?: number } = {}): TestTimingReport {
	const maximumSlowFiles = options.maximumSlowFiles ?? 10
	const maximumIncreaseRatio = options.maximumIncreaseRatio ?? MAXIMUM_TIMING_REGRESSION_RATIO
	const minimumHistorySamples = options.minimumHistorySamples ?? MINIMUM_REGRESSION_HISTORY_SAMPLES
	const minimumIncreaseSeconds = options.minimumIncreaseSeconds ?? MINIMUM_TIMING_REGRESSION_SECONDS
	const observedFingerprints = Object.assign({}, ...observations.map(observation => observation.fingerprintsByFile ?? {})) as Record<string, string>
	const currentHistory = history === undefined || Object.keys(observedFingerprints).length === 0 ? history : filterTestTimingHistory(history, observedFingerprints)
	const currentSecondsByFile = new Map<string, number>()
	for (const observation of observations) {
		for (const [filePath, seconds] of estimateObservationFileSeconds(observation)) currentSecondsByFile.set(filePath, (currentSecondsByFile.get(filePath) ?? 0) + seconds)
	}
	const slowestFiles = [...currentSecondsByFile]
		.map(([filePath, seconds]) => ({ filePath, seconds }))
		.sort((left, right) => right.seconds - left.seconds || left.filePath.localeCompare(right.filePath))
		.slice(0, maximumSlowFiles)
	const regressions: TestTimingRegression[] = []
	for (const [filePath, currentSeconds] of currentSecondsByFile) {
		const samples = currentHistory?.samplesByFile[filePath] ?? []
		if (samples.length < minimumHistorySamples) continue
		const baselineSeconds = median(samples)
		if (baselineSeconds === undefined) continue
		const increaseSeconds = currentSeconds - baselineSeconds
		let increaseRatio = increaseSeconds / baselineSeconds
		if (baselineSeconds === 0) {
			increaseRatio = Number.POSITIVE_INFINITY
			if (currentSeconds === 0) increaseRatio = 0
		}
		if (increaseSeconds > minimumIncreaseSeconds && increaseRatio > maximumIncreaseRatio) regressions.push({ baselineSeconds, currentSeconds, filePath, increaseRatio, increaseSeconds })
	}
	regressions.sort((left, right) => right.increaseSeconds - left.increaseSeconds || left.filePath.localeCompare(right.filePath))
	const elapsedSeconds = observations.map(observation => observation.elapsedSeconds).filter(seconds => seconds > 0)
	const fastestSeconds = Math.min(...elapsedSeconds)
	const slowestSeconds = Math.max(...elapsedSeconds)
	const shardBalance = elapsedSeconds.length < 2 || !Number.isFinite(fastestSeconds) || !Number.isFinite(slowestSeconds) ? undefined : { fastestSeconds, slowestSeconds, imbalanceRatio: slowestSeconds / fastestSeconds }
	const unstableFiles = Object.entries(currentHistory?.samplesByFile ?? {})
		.filter(([, samples]) => samples.length >= MINIMUM_REGRESSION_HISTORY_SAMPLES)
		.map(([filePath, samples]) => {
			const minimumSeconds = Math.min(...samples)
			const maximumSeconds = Math.max(...samples)
			let spreadRatio = (maximumSeconds - minimumSeconds) / minimumSeconds
			if (minimumSeconds === 0) spreadRatio = maximumSeconds === 0 ? 0 : Number.POSITIVE_INFINITY
			return { filePath, maximumSeconds, minimumSeconds, spreadRatio }
		})
		.filter(file => file.maximumSeconds - file.minimumSeconds > MINIMUM_TIMING_REGRESSION_SECONDS && file.spreadRatio > MAXIMUM_TIMING_REGRESSION_RATIO)
		.sort((left, right) => right.spreadRatio - left.spreadRatio || left.filePath.localeCompare(right.filePath))
		.slice(0, 10)
	return { currentSecondsByFile, regressions, ...(shardBalance === undefined ? {} : { shardBalance }), slowestFiles, unstableFiles }
}

const formatSeconds = (seconds: number) => `${seconds.toFixed(1)}s`

export function renderTestTimingMarkdown(report: TestTimingReport) {
	const lines = ['# Test timing summary', '', '| Slowest test file | Estimated wall time |', '| --- | ---: |', ...report.slowestFiles.map(file => `| \`${file.filePath}\` | ${formatSeconds(file.seconds)} |`)]
	if (report.shardBalance !== undefined) lines.push('', `Shard balance: ${formatSeconds(report.shardBalance.fastestSeconds)} fastest, ${formatSeconds(report.shardBalance.slowestSeconds)} slowest (${report.shardBalance.imbalanceRatio.toFixed(2)}x)`)
	if (report.unstableFiles.length > 0) lines.push('', '## Unstable test durations', '', ...report.unstableFiles.map(file => `- \`${file.filePath}\`: ${formatSeconds(file.minimumSeconds)}–${formatSeconds(file.maximumSeconds)} (${file.spreadRatio.toFixed(2)}x spread)`))
	if (report.regressions.length === 0) {
		lines.push('', 'Timing regression budget: passed')
	} else {
		lines.push(
			'',
			'## Timing regressions',
			'',
			...report.regressions.map(regression => `- \`${regression.filePath}\`: ${formatSeconds(regression.currentSeconds)} versus ${formatSeconds(regression.baselineSeconds)} baseline (+${formatSeconds(regression.increaseSeconds)}, +${(regression.increaseRatio * 100).toFixed(1)}%)`),
			'',
			'Timing regression budget: failed',
		)
	}
	return `${lines.join('\n')}\n`
}

export async function writeTestTimingObservation(outputPath: string, junitPath: string, elapsedSeconds: number, testFiles: readonly string[], contextPaths: readonly string[] = []) {
	let junitXml = ''
	try {
		junitXml = await fs.readFile(junitPath, 'utf8')
	} catch (error) {
		if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
	}
	const observation = createTestTimingObservation(junitXml, elapsedSeconds, testFiles)
	observation.fingerprintsByFile = await createTestFingerprints(observation.testFiles, contextPaths)
	await fs.mkdir(path.dirname(outputPath), { recursive: true })
	await fs.writeFile(outputPath, `${JSON.stringify(observation, undefined, 2)}\n`)
}
