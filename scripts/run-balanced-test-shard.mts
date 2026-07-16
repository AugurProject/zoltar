import * as process from 'node:process'
import { createBalancedTestShards, discoverTestFiles, toBunTestPath, type WeightedTestFile } from './test-discovery.mts'

const repositoryRoot = process.cwd()

const knownFileWeights = new Map<string, number>([
	['solidity/ts/tests/priceOracleSecurity.test.ts', 29],
	['ui/ts/tests/simulation/activeEnvironment.test.ts', 90],
	['solidity/ts/tests/escalationGame.test.ts', 21],
	['solidity/ts/tests/auction.test.ts', 11],
	['ui/ts/tests/features/open-oracle/openOracleSection.integration.test.tsx', 8],
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

export async function getWeightedTestFiles() {
	const files = await discoverTestFiles(repositoryRoot)
	const uniqueFiles = new Set(files)
	const missingWeightedFiles = [...knownFileWeights.keys()].filter(filePath => !uniqueFiles.has(filePath))
	if (missingWeightedFiles.length > 0) throw new Error(`Weighted test files were not discovered: ${missingWeightedFiles.join(', ')}`)
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
	const testFiles = await getWeightedTestFiles()
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

	const child = Bun.spawn({
		cmd: [process.execPath, 'test', '--preload', './bun-test-setup-ui.ts', '--reporter=dots', '--timeout', '300000', ...passthroughArgs, ...selectedShard.files.map(toBunTestPath)],
		stderr: 'inherit',
		stdin: 'inherit',
		stdout: 'inherit',
	})

	process.exit(await child.exited)
}
