import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertCompleteCoverageOwnership, createTypeScriptCoverageShards, mergeTypeScriptCoverageFiles, replaceCoverageDirectory, runCoverageShards } from './run-typescript-coverage.mts'

describe('TypeScript coverage sharding', () => {
	test('assigns every canonical test exactly once', () => {
		const weightedTests = [
			{ filePath: 'slow.test.ts', weight: 10 },
			{ filePath: 'medium.test.ts', weight: 5 },
			{ filePath: 'fast.test.ts', weight: 1 },
		]
		const shards = createTypeScriptCoverageShards(weightedTests, 2)

		expect(() =>
			assertCompleteCoverageOwnership(
				shards,
				weightedTests.map(testFile => testFile.filePath),
			),
		).not.toThrow()
		expect(() =>
			assertCompleteCoverageOwnership(
				[['slow.test.ts'], ['slow.test.ts', 'fast.test.ts']],
				weightedTests.map(testFile => testFile.filePath),
			),
		).toThrow('more than once')
		expect(() =>
			assertCompleteCoverageOwnership(
				[['slow.test.ts'], ['fast.test.ts']],
				weightedTests.map(testFile => testFile.filePath),
			),
		).toThrow('complete canonical test manifest')
	})

	test('stops at the first failed shard', async () => {
		const visited: number[] = []
		const exitCode = await runCoverageShards([['first.test.ts'], ['second.test.ts'], ['third.test.ts']], async (_files, index) => {
			visited.push(index)
			return index === 1 ? 7 : 0
		})

		expect(exitCode).toBe(7)
		expect(visited).toEqual([0, 1])
	})

	test('merges shard hit counts before publishing one valid LCOV document', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'typescript-coverage-merge-'))
		try {
			const firstPath = join(directory, 'first.info')
			const secondPath = join(directory, 'second.info')
			await writeFile(firstPath, 'SF:shared/ts/example.ts\nFN:1,run\nFNDA:1,run\nFNF:1\nFNH:1\nDA:1,2\nDA:2,0\nLF:2\nLH:1\nend_of_record\n')
			await writeFile(secondPath, 'SF:shared/ts/example.ts\nFN:1,run\nFNDA:3,run\nFNF:1\nFNH:1\nDA:1,4\nDA:2,5\nLF:2\nLH:2\nend_of_record\n')

			const merged = await mergeTypeScriptCoverageFiles([firstPath, secondPath], directory)

			expect(merged).toContain('FNDA:4,run')
			expect(merged).toContain('DA:1,6')
			expect(merged).toContain('DA:2,5')
			expect(merged).toContain('LF:2\nLH:2\nend_of_record')
		} finally {
			await rm(directory, { recursive: true, force: true })
		}
	})

	test('replaces a complete capture without retaining the prior directory', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'typescript-coverage-publish-'))
		try {
			const stagingDirectory = join(directory, 'staging')
			const coverageDirectory = join(directory, 'typescript')
			await mkdir(stagingDirectory)
			await mkdir(coverageDirectory)
			await writeFile(join(stagingDirectory, 'lcov.info'), 'new\n')
			await writeFile(join(coverageDirectory, 'lcov.info'), 'old\n')

			await replaceCoverageDirectory(stagingDirectory, coverageDirectory)

			expect(await readFile(join(coverageDirectory, 'lcov.info'), 'utf8')).toBe('new\n')
			expect((await readdir(directory)).filter(entry => entry.includes('.previous-'))).toEqual([])
		} finally {
			await rm(directory, { recursive: true, force: true })
		}
	})
})
