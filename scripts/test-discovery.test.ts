import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getTimingContextPaths, getWeightedTestFiles, KNOWN_FILE_WEIGHTS } from './run-balanced-test-shard.mts'
import { createSolidityBytecodeTestShards, discoverSolidityBytecodeTestFiles } from './run-solidity-bytecode-coverage.mts'
import { discoverTestFiles, discoverTestFilesForDomain, getDefaultTestParallelism, isExplicitTestPath, MAXIMUM_TEST_PARALLELISM, toBunTestPath } from './test-discovery.mts'
import {
	createTestFingerprints,
	createTestTimingObservation,
	createTestTimingReport,
	filterTestTimingHistory,
	getHistoricalTestWeights,
	MAXIMUM_TIMING_SAMPLES,
	mergeTestTimingHistory,
	parseJunitTestCaseSeconds,
	readTestTimingHistory,
	renderTestTimingMarkdown,
	TEST_TIMING_HISTORY_VERSION,
	type TestTimingHistory,
} from './test-timings.mts'

describe('canonical test discovery', () => {
	test('local and CI discovery include source, shared, and fuzz tests exactly once', async () => {
		const canonicalFiles = await discoverTestFiles()
		const weightedFiles = await getWeightedTestFiles()
		const weightedPaths = weightedFiles.map(file => file.filePath).sort((left, right) => left.localeCompare(right))

		expect(weightedPaths).toEqual(canonicalFiles)
		expect(canonicalFiles).toContain('scripts/testnetwork.test.ts')
		expect(canonicalFiles).toContain('shared/ts/ethereum.test.ts')
		expect(canonicalFiles).toContain('solidity/ts/fuzz/auctionTickMath.fuzz.ts')
		expect(canonicalFiles.some(file => file.includes('/js/'))).toBe(false)
		expect(new Set(canonicalFiles).size).toBe(canonicalFiles.length)
		for (const weightedPath of KNOWN_FILE_WEIGHTS.keys()) expect(canonicalFiles).toContain(weightedPath)
	})

	test('Bun default discovery ignores every generated UI test tree', async () => {
		const bunfig = await readFile('bunfig.toml', 'utf8')
		for (const packageId of ['coreShared', 'zoltar', 'statoblast', 'trading']) {
			expect(bunfig).toContain(`ui/${packageId}/js/tests/**`)
		}
	})

	test('application and Solidity domains partition canonical root discovery', async () => {
		const canonicalFiles = await discoverTestFiles()
		const applicationFiles = await discoverTestFilesForDomain('application')
		const solidityFiles = await discoverTestFilesForDomain('solidity')

		expect(applicationFiles.every(filePath => !filePath.startsWith('solidity/ts/'))).toBe(true)
		expect(solidityFiles.every(filePath => filePath.startsWith('solidity/ts/'))).toBe(true)
		expect([...applicationFiles, ...solidityFiles].sort((left, right) => left.localeCompare(right))).toEqual(canonicalFiles)
	})

	test('domain timing fingerprints cover their package lockfiles and preload', () => {
		expect(getTimingContextPaths('application')).toEqual(expect.arrayContaining(['bun-test-setup.ts', 'bun-test-setup-ui.ts', 'bunfig.toml', 'shared/bun.lock', 'ui/coreShared/bun.lock', 'ui/statoblast/bun.lock', 'ui/trading/bun.lock', 'ui/zoltar/bun.lock']))
		expect(getTimingContextPaths('solidity')).toEqual(expect.arrayContaining(['bun-test-setup.ts', 'bun-test-setup-solidity.ts', 'bunfig.toml', 'shared/bun.lock', 'solidity/bun.lock']))
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
		expect(isExplicitTestPath('solidity/ts/tests/statoblast')).toBe(true)
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

	test('timing history discards samples after a test environment fingerprint changes', () => {
		const history: TestTimingHistory = {
			version: TEST_TIMING_HISTORY_VERSION,
			fingerprintsByFile: { 'changed.test.ts': 'old' },
			samplesByFile: { 'changed.test.ts': [50, 52, 51] },
		}
		const observation = createTestTimingObservation('<testcase file="changed.test.ts" time="4"/>', 4, ['changed.test.ts'])
		observation.fingerprintsByFile = { 'changed.test.ts': 'new' }

		expect(mergeTestTimingHistory(history, [observation], ['changed.test.ts'])).toEqual({
			version: TEST_TIMING_HISTORY_VERSION,
			fingerprintsByFile: { 'changed.test.ts': 'new' },
			samplesByFile: { 'changed.test.ts': [4] },
		})
	})

	test('stale fingerprints cannot influence shard weights or regression reports', () => {
		const history: TestTimingHistory = {
			version: TEST_TIMING_HISTORY_VERSION,
			fingerprintsByFile: { 'changed.test.ts': 'old' },
			samplesByFile: { 'changed.test.ts': [100, 101, 102] },
		}
		const currentHistory = filterTestTimingHistory(history, { 'changed.test.ts': 'new' })
		expect(currentHistory.samplesByFile).toEqual({})
		expect(getHistoricalTestWeights(currentHistory, ['changed.test.ts'])).toEqual([{ filePath: 'changed.test.ts', weight: 1 }])

		const observation = createTestTimingObservation('<testcase file="changed.test.ts" time="120"/>', 120, ['changed.test.ts'])
		observation.fingerprintsByFile = { 'changed.test.ts': 'new' }
		expect(createTestTimingReport(history, [observation]).regressions).toEqual([])
	})

	test('fully stale timing history falls back to curated file weights', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-stale-test-weights-'))
		try {
			const historyPath = join(directory, 'history.json')
			const knownFile = [...KNOWN_FILE_WEIGHTS.keys()][0]
			if (knownFile === undefined) throw new Error('Expected at least one curated test weight')
			await writeFile(historyPath, JSON.stringify({ version: TEST_TIMING_HISTORY_VERSION, fingerprintsByFile: { [knownFile]: 'stale' }, samplesByFile: { [knownFile]: [999] } }))
			const defaultWeights = await getWeightedTestFiles(undefined, 'all')
			const staleWeights = await getWeightedTestFiles(historyPath, 'all')
			expect(staleWeights).toEqual(defaultWeights)
		} finally {
			await rm(directory, { recursive: true })
		}
	})

	test('timing fingerprints include package lockfiles and preload context', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-test-fingerprint-'))
		try {
			const testPath = join(directory, 'example.test.ts')
			const lockPath = join(directory, 'bun.lock')
			const preloadPath = join(directory, 'preload.ts')
			await writeFile(testPath, 'test source\n')
			await writeFile(lockPath, 'lock one\n')
			await writeFile(preloadPath, 'preload one\n')
			const initial = await createTestFingerprints([testPath], [lockPath, preloadPath])
			await writeFile(lockPath, 'lock two\n')
			const lockChanged = await createTestFingerprints([testPath], [lockPath, preloadPath])
			await writeFile(preloadPath, 'preload two\n')
			const preloadChanged = await createTestFingerprints([testPath], [lockPath, preloadPath])
			expect(lockChanged[testPath]).not.toBe(initial[testPath])
			expect(preloadChanged[testPath]).not.toBe(lockChanged[testPath])
		} finally {
			await rm(directory, { recursive: true })
		}
	})

	test('a missing timing history is treated as an empty cache', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-test-timings-'))
		try {
			expect(await readTestTimingHistory(join(directory, 'missing.json'))).toBeUndefined()
		} finally {
			await rm(directory, { recursive: true })
		}
	})

	test('timing reports flag only established regressions that exceed absolute and relative budgets', () => {
		const history: TestTimingHistory = {
			version: TEST_TIMING_HISTORY_VERSION,
			samplesByFile: {
				'established-slow.test.ts': [20, 21, 19],
				'relative-only.test.ts': [2, 2, 2],
				'sparse.test.ts': [1, 1],
			},
		}
		const observation = createTestTimingObservation('<testcase file="established-slow.test.ts" time="35"/><testcase file="relative-only.test.ts" time="5"/><testcase file="sparse.test.ts" time="30"/>', 70, ['established-slow.test.ts', 'relative-only.test.ts', 'sparse.test.ts'])
		const report = createTestTimingReport(history, [observation])

		expect(report.regressions.map(regression => regression.filePath)).toEqual(['established-slow.test.ts'])
		expect(report.slowestFiles.map(file => file.filePath)).toEqual(['established-slow.test.ts', 'sparse.test.ts', 'relative-only.test.ts'])
		expect(renderTestTimingMarkdown(report)).toContain('Timing regression budget: failed')
	})

	test('timing reports pass without historical regressions', () => {
		const observation = createTestTimingObservation('<testcase file="new.test.ts" time="4"/>', 4, ['new.test.ts'])
		const report = createTestTimingReport(undefined, [observation])

		expect(report.regressions).toEqual([])
		expect(renderTestTimingMarkdown(report)).toContain('Timing regression budget: passed')
	})

	test('timing reports expose shard imbalance and historically unstable files', () => {
		const history: TestTimingHistory = { version: TEST_TIMING_HISTORY_VERSION, samplesByFile: { 'unstable.test.ts': [10, 12, 35] } }
		const observations = [createTestTimingObservation('<testcase file="first.test.ts" time="10"/>', 10, ['first.test.ts']), createTestTimingObservation('<testcase file="second.test.ts" time="30"/>', 30, ['second.test.ts'])]
		const report = createTestTimingReport(history, observations)

		expect(report.shardBalance).toEqual({ fastestSeconds: 10, slowestSeconds: 30, imbalanceRatio: 3 })
		expect(report.unstableFiles.map(file => file.filePath)).toEqual(['unstable.test.ts'])
		expect(renderTestTimingMarkdown(report)).toContain('Shard balance: 10.0s fastest, 30.0s slowest (3.00x)')
		expect(renderTestTimingMarkdown(report)).toContain('Unstable test durations')
	})

	test('timing reports handle a zero-second historical baseline', () => {
		const history: TestTimingHistory = { version: TEST_TIMING_HISTORY_VERSION, samplesByFile: { 'formerly-empty.test.ts': [0, 0, 0] } }
		const observation = createTestTimingObservation('<testcase file="formerly-empty.test.ts" time="11"/>', 11, ['formerly-empty.test.ts'])
		const report = createTestTimingReport(history, [observation])

		expect(report.regressions).toHaveLength(1)
		expect(report.regressions[0]?.increaseRatio).toBe(Number.POSITIVE_INFINITY)
	})
})
