import * as process from 'node:process'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { createBalancedTestShards, discoverTestFiles, toBunTestPath, type WeightedTestFile } from './test-discovery.mts'
import { getHistoricalTestWeights, readTestTimingHistory, writeTestTimingObservation } from './test-timings.mts'

const repositoryRoot = process.cwd()

const knownFileWeights = new Map<string, number>([
	['ui/ts/tests/simulation/securityPoolEnvironments.test.ts', 80],
	['solidity/ts/tests/peripherals/forkMigration.test.ts', 37],
	['solidity/ts/tests/peripherals/truthAuction.test.ts', 19],
	['solidity/ts/tests/priceOracleSecurity.test.ts', 15],
	['solidity/ts/tests/escalationGame.test.ts', 15],
	['ui/ts/tests/simulation/activeEnvironment.test.ts', 15],
	['solidity/ts/tests/auction.test.ts', 14],
	['solidity/ts/tests/peripherals/escalationMigration.test.ts', 9],
	['ui/ts/tests/features/open-oracle/openOracleSection.integration.test.tsx', 6],
	['solidity/ts/tests/peripherals/deploymentAndOwnForkEscalation.test.ts', 5],
	['solidity/ts/tests/peripherals/vaultAccounting.test.ts', 5],
	['ui/ts/tests/simulation/deployedEnvironment.test.ts', 4],
	['solidity/ts/tests/peripheralsInvariant.test.ts', 4],
	['solidity/ts/tests/peripherals/receiveGuards.test.ts', 2],
])

function parseShardOption(args: readonly string[]): { listOnly: boolean; shardIndex: number; shardCount: number; passthroughArgs: string[] } {
	const passthroughArgs: string[] = []
	let listOnly = false
	let shardValue: string | undefined

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index]
		if (arg === undefined) continue

		if (arg === '--list-only') {
			listOnly = true
			continue
		}

		if (arg === '--shard') {
			const nextArg = args[index + 1]
			if (nextArg === undefined) throw new Error('--shard requires a value like 1/4')
			shardValue = nextArg
			index += 1
			continue
		}

		if (arg.startsWith('--shard=')) {
			shardValue = arg.slice('--shard='.length)
			continue
		}

		passthroughArgs.push(arg)
	}

	if (shardValue === undefined) throw new Error('Missing required --shard option')

	const match = /^([1-9][0-9]*)\/([1-9][0-9]*)$/.exec(shardValue)
	if (match === null) throw new Error(`Invalid --shard value: ${shardValue}`)

	const shardIndexText = match[1]
	const shardCountText = match[2]
	if (shardIndexText === undefined || shardCountText === undefined) throw new Error(`Invalid --shard value: ${shardValue}`)

	const shardIndex = Number(shardIndexText)
	const shardCount = Number(shardCountText)
	if (!Number.isSafeInteger(shardIndex) || !Number.isSafeInteger(shardCount) || shardIndex > shardCount) throw new Error(`Invalid --shard value: ${shardValue}`)

	return { listOnly, shardIndex, shardCount, passthroughArgs }
}

export async function getWeightedTestFiles(historyPath?: string) {
	const files = await discoverTestFiles(repositoryRoot)
	const uniqueFiles = new Set(files)
	if (historyPath !== undefined) {
		const history = await readTestTimingHistory(historyPath)
		if (history !== undefined) return getHistoricalTestWeights(history, files).sort((left, right) => right.weight - left.weight || left.filePath.localeCompare(right.filePath))
	}
	return [...uniqueFiles]
		.map(
			(filePath): WeightedTestFile => ({
				filePath,
				weight: knownFileWeights.get(filePath) ?? 1,
			}),
		)
		.sort((left, right) => right.weight - left.weight || left.filePath.localeCompare(right.filePath))
}

if (import.meta.main) {
	const { listOnly, shardIndex, shardCount, passthroughArgs } = parseShardOption(process.argv.slice(2))
	const timingHistoryPath = process.env['ZOLTAR_TEST_TIMING_HISTORY']
	const timingOutputPath = process.env['ZOLTAR_TEST_TIMING_OUTPUT']
	const testFiles = await getWeightedTestFiles(timingHistoryPath)
	const shards = createBalancedTestShards(testFiles, shardCount)
	const selectedShard = shards[shardIndex - 1]
	if (selectedShard === undefined) throw new Error(`Unable to select shard ${shardIndex.toString()}/${shardCount.toString()}`)

	console.log(`Balanced shard ${shardIndex.toString()}/${shardCount.toString()}: ${selectedShard.files.length.toString()} files, weight ${selectedShard.weight.toString()}`)
	if (listOnly) {
		for (const shard of shards) {
			console.log(`Shard ${(shard.index + 1).toString()}/${shardCount.toString()}: ${shard.files.length.toString()} files, weight ${shard.weight.toString()}`)
		}
		for (const filePath of selectedShard.files) console.log(filePath)
		process.exit(0)
	}
	if (selectedShard.files.length === 0) {
		console.log('Selected balanced shard has no test files.')
		process.exit(0)
	}

	const junitPath = timingOutputPath === undefined ? undefined : `${timingOutputPath}.junit.xml`
	const reporterArguments = junitPath === undefined ? ['--reporter=dots'] : ['--reporter=junit', `--reporter-outfile=${junitPath}`]
	if (junitPath !== undefined) await fs.mkdir(path.dirname(junitPath), { recursive: true })
	const startedAt = performance.now()
	const child = Bun.spawn({
		cmd: [process.execPath, 'test', '--preload', './bun-test-setup-ui.ts', ...reporterArguments, '--timeout', '300000', ...passthroughArgs, ...selectedShard.files.map(toBunTestPath)],
		stderr: 'inherit',
		stdin: 'inherit',
		stdout: 'inherit',
	})

	const exitCode = await child.exited
	const elapsedSeconds = (performance.now() - startedAt) / 1000
	if (timingOutputPath !== undefined && junitPath !== undefined) {
		await writeTestTimingObservation(timingOutputPath, junitPath, elapsedSeconds, selectedShard.files)
		console.log(`Recorded ${elapsedSeconds.toFixed(1)}s timing observation in ${timingOutputPath}`)
	}
	process.exit(exitCode)
}
