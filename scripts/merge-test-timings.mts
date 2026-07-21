import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { discoverTestFiles } from './test-discovery.mts'
import { mergeTestTimingHistory, readTestTimingHistory, TEST_TIMING_HISTORY_VERSION, type TestTimingObservation } from './test-timings.mts'

function isTestTimingObservation(value: unknown): value is TestTimingObservation {
	if (typeof value !== 'object' || value === null) return false
	if (!('version' in value) || !('elapsedSeconds' in value) || !('testCaseSecondsByFile' in value) || !('testFiles' in value)) return false
	if (value.version !== TEST_TIMING_HISTORY_VERSION || typeof value.elapsedSeconds !== 'number' || !Number.isFinite(value.elapsedSeconds) || value.elapsedSeconds < 0) return false
	if (typeof value.testCaseSecondsByFile !== 'object' || value.testCaseSecondsByFile === null || !Array.isArray(value.testFiles)) return false
	if (!value.testFiles.every(filePath => typeof filePath === 'string')) return false
	return Object.values(value.testCaseSecondsByFile).every(seconds => typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0)
}

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
const history = mergeTestTimingHistory(await readTestTimingHistory(historyPath), observations, await discoverTestFiles())
await fs.mkdir(path.dirname(historyPath), { recursive: true })
await fs.writeFile(historyPath, `${JSON.stringify(history, undefined, 2)}\n`)
console.log(`Updated timing history for ${Object.keys(history.samplesByFile).length.toString()} test files from ${observations.length.toString()} shards.`)
