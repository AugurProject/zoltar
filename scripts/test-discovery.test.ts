import { describe, expect, test } from 'bun:test'
import { getWeightedTestFiles } from './run-balanced-test-shard.mts'
import { createSolidityBytecodeTestShards, discoverSolidityBytecodeTestFiles } from './run-solidity-bytecode-coverage.mts'
import { discoverTestFiles, getDefaultTestParallelism, isExplicitTestPath, MAXIMUM_TEST_PARALLELISM, toBunTestPath } from './test-discovery.mts'

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
})
