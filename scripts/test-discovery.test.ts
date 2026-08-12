import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getWeightedTestFiles } from './run-balanced-test-shard.mts'
import { createSolidityBytecodeTestShards, discoverSolidityBytecodeTestFiles } from './run-solidity-bytecode-coverage.mts'
import { discoverTestFiles, getDefaultTestParallelism, isExplicitTestPath, MAXIMUM_TEST_PARALLELISM, toBunTestPath } from './test-discovery.mts'
import { createTestTimingObservation, getHistoricalTestWeights, MAXIMUM_TIMING_SAMPLES, mergeTestTimingHistory, parseJunitTestCaseSeconds, readTestTimingHistory, TEST_TIMING_HISTORY_VERSION, type TestTimingHistory } from './test-timings.mts'

describe('canonical test discovery', () => {
	test('local and CI discovery include source, shared, and fuzz tests exactly once', async () => {
		const canonicalFiles = await discoverTestFiles()
		const weightedFiles = await getWeightedTestFiles()
		const weightedPaths = weightedFiles.map(file => file.filePath).sort((left, right) => left.localeCompare(right))

		expect(weightedPaths).toEqual(canonicalFiles)
		expect(canonicalFiles).toContain('shared/ts/ethereum.test.ts')
		expect(canonicalFiles).toContain('solidity/ts/fuzz/auctionTickMath.fuzz.ts')
		expect(canonicalFiles.some(file => file.includes('/js/'))).toBe(false)
		expect(new Set(canonicalFiles).size).toBe(canonicalFiles.length)
	})

	test('bytecode coverage dynamically shards the complete Solidity source set', async () => {
		const expectedFiles = await discoverSolidityBytecodeTestFiles()
		const shards = await createSolidityBytecodeTestShards(process.cwd(), 2)
		const shardedFiles = shards.flat().sort((left, right) => left.localeCompare(right))

		expect(shardedFiles).toEqual(expectedFiles)
		expect(shardedFiles).toContain('solidity/ts/tests/openOracleDispute.test.ts')
		expect(shardedFiles).toContain('solidity/ts/fuzz/auctionTickMath.fuzz.ts')
		expect(new Set(shardedFiles).size).toBe(shardedFiles.length)
		expect(shards.every(shard => shard.length > 0)).toBe(true)
	})

	test('Bun receives explicit source paths so nonstandard fuzz filenames execute', () => {
		expect(toBunTestPath('solidity/ts/fuzz/auctionTickMath.fuzz.ts')).toBe('./solidity/ts/fuzz/auctionTickMath.fuzz.ts')
		expect(toBunTestPath('./solidity/ts/tests/auction.test.ts')).toBe('./solidity/ts/tests/auction.test.ts')
	})

	test('the local runner clamps concurrency to the CI-proven maximum', () => {
		expect(MAXIMUM_TEST_PARALLELISM).toBe(2)
		expect(getDefaultTestParallelism(128)).toBe(2)
		expect(getDefaultTestParallelism(1)).toBe(1)
	})

	test('explicit source files and directories suppress canonical full-suite injection', () => {
		expect(isExplicitTestPath('solidity/ts/tests/peripherals')).toBe(true)
		expect(isExplicitTestPath('./solidity/ts/fuzz/auctionTickMath.fuzz.ts')).toBe(true)
		expect(isExplicitTestPath('--test-name-pattern')).toBe(false)
		expect(isExplicitTestPath('not-a-repository-path')).toBe(false)
	})

	test('JUnit timings are grouped by source file regardless of attribute order', () => {
		const seconds = parseJunitTestCaseSeconds(`
			<testcase time="2.5" file="./slow.test.ts" name="first" />
			<testcase file="slow.test.ts" name="second" time="1.25" />
			<testcase file="fast&amp;safe.test.ts" time="0.5" />
		`)
		expect(Object.fromEntries(seconds)).toEqual({ 'fast&safe.test.ts': 0.5, 'slow.test.ts': 3.75 })
	})

	test('observed wall time includes unreported per-file overhead', () => {
		const observation = createTestTimingObservation('<testcase file="slow.test.ts" time="6"/><testcase file="fast.test.ts" time="2"/>', 10, ['slow.test.ts', 'fast.test.ts'])
		const history = mergeTestTimingHistory(undefined, [observation], ['slow.test.ts', 'fast.test.ts'])
		expect(history.samplesByFile).toEqual({ 'fast.test.ts': [3], 'slow.test.ts': [7] })
	})

	test('timing history stays bounded and gives new tests a conservative weight', () => {
		let history: TestTimingHistory = { version: TEST_TIMING_HISTORY_VERSION, samplesByFile: { 'fast.test.ts': [1], 'slow.test.ts': [9] } }
		for (let index = 0; index < MAXIMUM_TIMING_SAMPLES + 2; index += 1) {
			const observation = createTestTimingObservation('<testcase file="fast.test.ts" time="2"/><testcase file="slow.test.ts" time="8"/>', 10, ['fast.test.ts', 'slow.test.ts'])
			history = mergeTestTimingHistory(history, [observation], ['fast.test.ts', 'slow.test.ts'])
		}
		expect(history.samplesByFile['fast.test.ts']).toHaveLength(MAXIMUM_TIMING_SAMPLES)
		expect(getHistoricalTestWeights(history, ['fast.test.ts', 'new.test.ts', 'slow.test.ts'])).toEqual([
			{ filePath: 'fast.test.ts', weight: 2 },
			{ filePath: 'new.test.ts', weight: 8 },
			{ filePath: 'slow.test.ts', weight: 8 },
		])
	})

	test('a missing timing history is treated as an empty cache', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-test-timings-'))
		try {
			expect(await readTestTimingHistory(join(directory, 'missing.json'))).toBeUndefined()
		} finally {
			await rm(directory, { recursive: true })
		}
	})
})
