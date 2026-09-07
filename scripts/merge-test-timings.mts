import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { discoverTestFilesForDomain, isTestDomain } from './test-discovery.mts'
import { createTestTimingReport, mergeTestTimingHistory, readTestTimingHistory, renderTestTimingMarkdown, TEST_TIMING_HISTORY_VERSION, type TestTimingObservation } from './test-timings.mts'

function isTestTimingObservation(value: unknown): value is TestTimingObservation {
	const sha256 = /^[0-9a-f]{64}$/
	if (typeof value !== 'object' || value === null) return false
	if (!('version' in value) || !('elapsedSeconds' in value) || !('testCaseSecondsByFile' in value) || !('testFiles' in value)) return false
	if (value.version !== TEST_TIMING_HISTORY_VERSION || typeof value.elapsedSeconds !== 'number' || !Number.isFinite(value.elapsedSeconds) || value.elapsedSeconds < 0) return false
	if (typeof value.testCaseSecondsByFile !== 'object' || value.testCaseSecondsByFile === null || !Array.isArray(value.testFiles)) return false
	if (!value.testFiles.every(filePath => typeof filePath === 'string')) return false
	if (!('domain' in value) || typeof value.domain !== 'string' || !isTestDomain(value.domain) || value.domain === 'all') return false
	if (!('shardIndex' in value) || !Number.isSafeInteger(value.shardIndex) || !('shardCount' in value) || !Number.isSafeInteger(value.shardCount)) return false
	if (!('executedTestFiles' in value) || !Array.isArray(value.executedTestFiles) || !value.executedTestFiles.every(file => typeof file === 'string')) return false
	if (!('exitStatus' in value) || value.exitStatus !== 0 || !('completionStatus' in value) || value.completionStatus !== 'complete') return false
	if (
		!('selectedManifestHash' in value) ||
		typeof value.selectedManifestHash !== 'string' ||
		!sha256.test(value.selectedManifestHash) ||
		!('executedManifestHash' in value) ||
		typeof value.executedManifestHash !== 'string' ||
		!sha256.test(value.executedManifestHash) ||
		value.selectedManifestHash !== value.executedManifestHash
	)
		return false
	if (!('contextFingerprint' in value) || typeof value.contextFingerprint !== 'string' || !sha256.test(value.contextFingerprint)) return false
	if (!('fingerprintsByFile' in value) || typeof value.fingerprintsByFile !== 'object' || value.fingerprintsByFile === null || !Object.values(value.fingerprintsByFile).every(fingerprint => typeof fingerprint === 'string' && sha256.test(fingerprint))) return false
	return Object.values(value.testCaseSecondsByFile).every(seconds => typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0)
}

const hashManifest = (files: readonly string[]) => new Bun.CryptoHasher('sha256').update(files.join('\n')).digest('hex')

function readOption(name: string) {
	const index = process.argv.indexOf(name)
	const value = index === -1 ? undefined : process.argv[index + 1]
	if (value === undefined) throw new Error(`${name} requires a path`)
	return value
}

const observationsDirectory = readOption('--observations')
const historyPath = readOption('--history')
const observationPaths = (await fs.readdir(observationsDirectory)).filter(fileName => fileName.endsWith('.timing.json')).sort((left, right) => left.localeCompare(right))

if (observationPaths.length === 0) throw new Error(`No test timing observations found in ${observationsDirectory}`)

const observations = await Promise.all(
	observationPaths.map(async observationPath => {
		const parsed: unknown = JSON.parse(await fs.readFile(path.join(observationsDirectory, observationPath), 'utf8'))
		if (!isTestTimingObservation(parsed)) throw new Error(`Invalid test timing observation: ${observationPath}`)
		return parsed
	}),
)
const previousHistory = await readTestTimingHistory(historyPath)
const firstObservation = observations[0]
if (firstObservation === undefined || firstObservation.domain === undefined || firstObservation.shardCount === undefined || !isTestDomain(firstObservation.domain)) throw new Error('Missing timing observation metadata')
const observationDomain = firstObservation.domain
if (observations.length !== firstObservation.shardCount) throw new Error(`Expected ${firstObservation.shardCount.toString()} timing shards, received ${observations.length.toString()}`)
const expectedIndexes = Array.from({ length: firstObservation.shardCount }, (_, index) => index + 1)
const actualIndexes = observations.map(observation => observation.shardIndex).sort((left, right) => (left ?? 0) - (right ?? 0))
if (JSON.stringify(actualIndexes) !== JSON.stringify(expectedIndexes)) throw new Error('Timing observations contain missing or duplicate shard indexes')
if (observations.some(observation => observation.domain !== firstObservation.domain || observation.shardCount !== firstObservation.shardCount || observation.contextFingerprint !== firstObservation.contextFingerprint)) throw new Error('Timing observations have mismatched domain, shard count, or context')
const selectedFiles = observations.flatMap(observation => observation.testFiles)
if (new Set(selectedFiles).size !== selectedFiles.length) throw new Error('Timing observations contain overlapping selected manifests')
for (const observation of observations) {
	const executedFiles = observation.executedTestFiles ?? []
	if (JSON.stringify([...observation.testFiles].sort()) !== JSON.stringify([...executedFiles].sort())) throw new Error('Timing observation selected and executed manifests differ')
	if (observation.selectedManifestHash !== hashManifest(observation.testFiles) || observation.executedManifestHash !== hashManifest(executedFiles)) throw new Error('Timing observation manifest hash is invalid')
	if (JSON.stringify(Object.keys(observation.testCaseSecondsByFile).sort()) !== JSON.stringify([...executedFiles].sort())) throw new Error('Timing observation testcase manifest differs from executed files')
	if (observation.fingerprintsByFile === undefined || JSON.stringify(Object.keys(observation.fingerprintsByFile).sort()) !== JSON.stringify([...executedFiles].sort())) throw new Error('Timing observation fingerprint manifest differs from executed files')
}
const expectedFiles = await discoverTestFilesForDomain(observationDomain)
if (JSON.stringify([...selectedFiles].sort()) !== JSON.stringify(expectedFiles)) throw new Error('Timing observations are not an exact union of the expected domain manifest')
const timingReport = createTestTimingReport(previousHistory, observations)
const timingMarkdown = renderTestTimingMarkdown(timingReport)
const history = mergeTestTimingHistory(previousHistory, observations, expectedFiles)
await fs.mkdir(path.dirname(historyPath), { recursive: true })
await fs.writeFile(historyPath, `${JSON.stringify(history, undefined, 2)}\n`)
console.log(`Updated timing history for ${Object.keys(history.samplesByFile).length.toString()} test files from ${observations.length.toString()} shards.`)
console.log(timingMarkdown)
const githubStepSummaryPath = process.env['GITHUB_STEP_SUMMARY']
if (githubStepSummaryPath !== undefined) await fs.appendFile(githubStepSummaryPath, timingMarkdown)
if (timingReport.regressions.length > 0) process.exit(1)
