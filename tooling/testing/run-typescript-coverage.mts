import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { mergeLcovRecords, parseLcov, renderLcovRecords } from './coverage-report.mts'
import { runBunTestProcess } from './run-bun-test-process.mts'
import { getWeightedTestFiles } from './run-balanced-test-shard.mts'
import { createBalancedTestShards, discoverTestFiles, toBunTestPath, type WeightedTestFile } from './test-discovery.mts'

export const TYPESCRIPT_COVERAGE_SHARD_COUNT = 4

const isMissingPathError = (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ENOENT'

export function createTypeScriptCoverageShards(testFiles: readonly WeightedTestFile[], shardCount = TYPESCRIPT_COVERAGE_SHARD_COUNT) {
	return createBalancedTestShards(testFiles, shardCount).map(shard => shard.files)
}

export function assertCompleteCoverageOwnership(shards: readonly (readonly string[])[], canonicalTestFiles: readonly string[]) {
	const ownedTestFiles = shards.flat().sort((left, right) => left.localeCompare(right))
	if (new Set(ownedTestFiles).size !== ownedTestFiles.length) throw new Error('TypeScript coverage shards assign at least one test file more than once')
	if (JSON.stringify(ownedTestFiles) !== JSON.stringify([...canonicalTestFiles].sort((left, right) => left.localeCompare(right)))) {
		throw new Error('TypeScript coverage shards do not own the complete canonical test manifest')
	}
}

export async function mergeTypeScriptCoverageFiles(lcovPaths: readonly string[], repositoryRoot = process.cwd()) {
	if (lcovPaths.length === 0) throw new Error('TypeScript coverage requires at least one shard')
	const records = await Promise.all(lcovPaths.map(async lcovPath => parseLcov(await readFile(lcovPath, 'utf8'), repositoryRoot)))
	return renderLcovRecords(mergeLcovRecords(records))
}

export async function runCoverageShards(shards: readonly (readonly string[])[], runShard: (files: readonly string[], index: number) => Promise<number>) {
	for (const [index, files] of shards.entries()) {
		const exitCode = await runShard(files, index)
		if (exitCode !== 0) return exitCode
	}
	return 0
}

export async function replaceCoverageDirectory(stagingDirectory: string, coverageDirectory: string) {
	const backupDirectory = `${coverageDirectory}.previous-${process.pid.toString()}`
	await rm(backupDirectory, { recursive: true, force: true })
	let movedExistingCoverage = false
	try {
		await rename(coverageDirectory, backupDirectory)
		movedExistingCoverage = true
	} catch (error) {
		if (!isMissingPathError(error)) throw error
	}
	try {
		await rename(stagingDirectory, coverageDirectory)
	} catch (error) {
		if (movedExistingCoverage) await rename(backupDirectory, coverageDirectory)
		throw error
	}
	if (movedExistingCoverage) await rm(backupDirectory, { recursive: true, force: true })
}

async function main() {
	const repositoryRoot = process.cwd()
	const coverageRoot = join(repositoryRoot, 'coverage')
	const coverageDirectory = join(coverageRoot, 'typescript')
	const startedAt = Date.now()
	await mkdir(coverageRoot, { recursive: true })
	const workingDirectory = await mkdtemp(join(coverageRoot, '.typescript-shards-'))

	try {
		const testFiles = await discoverTestFiles(repositoryRoot)
		const weightedTestFiles = await getWeightedTestFiles(process.env['ZOLTAR_TEST_TIMING_HISTORY'])
		const shards = createTypeScriptCoverageShards(weightedTestFiles)
		assertCompleteCoverageOwnership(shards, testFiles)

		const productionBuild = Bun.spawn({
			cmd: [process.execPath, 'run', 'ui:build:prod'],
			stderr: 'inherit',
			stdin: 'inherit',
			stdout: 'inherit',
		})
		const productionBuildExitCode = await productionBuild.exited
		if (productionBuildExitCode !== 0) return productionBuildExitCode

		const lcovPaths: string[] = []
		const exitCode = await runCoverageShards(shards, async (shardFiles, index) => {
			const shardNumber = index + 1
			const shardDirectory = join(workingDirectory, `shard-${shardNumber.toString()}`)
			await mkdir(shardDirectory, { recursive: true })
			lcovPaths.push(join(shardDirectory, 'lcov.info'))
			console.log(`Running TypeScript coverage shard ${shardNumber.toString()}/${shards.length.toString()}: ${shardFiles.length.toString()} test files`)
			return await runBunTestProcess({
				cmd: [process.execPath, './tooling/testing/run-tests.mts', '--bail=1', '--coverage', '--coverage-reporter=lcov', '--coverage-reporter=text', `--coverage-dir=${relative(repositoryRoot, shardDirectory)}`, '--reporter=dots', ...shardFiles.map(toBunTestPath)],
				env: { ...process.env, ZOLTAR_USE_EXISTING_PRODUCTION_BUILD: '1' },
			})
		})
		if (exitCode !== 0) {
			console.error(`TypeScript coverage failed; the last complete capture remains at ${relative(repositoryRoot, coverageDirectory)}`)
			return exitCode
		}

		const stagingDirectory = join(workingDirectory, 'complete')
		await mkdir(stagingDirectory)
		await writeFile(join(stagingDirectory, 'lcov.info'), await mergeTypeScriptCoverageFiles(lcovPaths, repositoryRoot))
		await writeFile(
			join(stagingDirectory, 'test-files.json'),
			`${JSON.stringify(
				{
					status: 'passed',
					count: testFiles.length,
					durationMs: Date.now() - startedAt,
					files: testFiles,
					shards: shards.map((files, index) => ({ index: index + 1, count: shards.length, files })),
				},
				undefined,
				2,
			)}\n`,
		)
		await replaceCoverageDirectory(stagingDirectory, coverageDirectory)
		console.log(`Published complete TypeScript coverage from ${shards.length.toString()} shards to ${relative(repositoryRoot, coverageDirectory)}`)
		return 0
	} finally {
		await rm(workingDirectory, { recursive: true, force: true })
	}
}

if (import.meta.main) process.exitCode = await main()
