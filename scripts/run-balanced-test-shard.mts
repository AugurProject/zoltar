import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as process from 'node:process'

type WeightedTestFile = {
	filePath: string
	weight: number
}

type TestShard = {
	index: number
	files: string[]
	weight: number
}

const repositoryRoot = process.cwd()
const testRoots = ['scripts', 'solidity/ts', 'ui/build', 'ui/ts']
const ignoredDirectoryNames = new Set(['node_modules', 'js', 'dist', 'vendor'])

const knownFileWeights = new Map<string, number>([
	['solidity/ts/tests/priceOracleSecurity.test.ts', 29],
	['ui/ts/tests/activeEnvironment.test.ts', 90],
	['solidity/ts/tests/escalationGame.test.ts', 21],
	['solidity/ts/tests/auction.test.ts', 11],
	['ui/ts/tests/openOracleSection.integration.test.tsx', 8],
	['ui/ts/tests/contracts.test.ts', 4],
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

function isTestFile(filePath: string) {
	return /\.(test|spec)\.(ts|tsx|mts|cts)$/.test(filePath)
}

async function collectTestFiles(directoryPath: string): Promise<string[]> {
	const entries = await fs.readdir(directoryPath, { withFileTypes: true })
	const files: string[] = []

	for (const entry of entries) {
		if (ignoredDirectoryNames.has(entry.name)) continue

		const entryPath = path.join(directoryPath, entry.name)
		if (entry.isDirectory()) {
			files.push(...(await collectTestFiles(entryPath)))
			continue
		}

		if (entry.isFile() && isTestFile(entry.name)) files.push(path.relative(repositoryRoot, entryPath).replace(/\\/g, '/'))
	}

	return files
}

async function getWeightedTestFiles() {
	const files = (await Promise.all(testRoots.map(testRoot => collectTestFiles(path.join(repositoryRoot, testRoot))))).flat()
	return [...new Set(files)]
		.map(
			(filePath): WeightedTestFile => ({
				filePath,
				weight: knownFileWeights.get(filePath) ?? 1,
			}),
		)
		.sort((left, right) => right.weight - left.weight || left.filePath.localeCompare(right.filePath))
}

function createBalancedShards(testFiles: readonly WeightedTestFile[], shardCount: number) {
	const shards: TestShard[] = []
	for (let index = 0; index < shardCount; index += 1) {
		shards.push({ index, files: [], weight: 0 })
	}

	for (const testFile of testFiles) {
		const targetShard = shards.reduce((current, candidate) => {
			if (candidate.weight < current.weight) return candidate
			if (candidate.weight === current.weight && candidate.files.length < current.files.length) return candidate
			if (candidate.weight === current.weight && candidate.files.length === current.files.length && candidate.index < current.index) return candidate
			return current
		})
		targetShard.files.push(testFile.filePath)
		targetShard.weight += testFile.weight
	}

	return shards
}

const { listOnly, shardIndex, shardCount, passthroughArgs } = parseShardOption(process.argv.slice(2))
const testFiles = await getWeightedTestFiles()
const shards = createBalancedShards(testFiles, shardCount)
const selectedShard = shards[shardIndex - 1]
if (selectedShard === undefined) throw new Error(`Unable to select shard ${shardIndex.toString()}/${shardCount.toString()}`)

console.log(`Balanced shard ${shardIndex.toString()}/${shardCount.toString()}: ${selectedShard.files.length.toString()} files, weight ${selectedShard.weight.toString()}`)
if (listOnly) {
	for (const shard of shards) {
		console.log(`Shard ${(shard.index + 1).toString()}/${shardCount.toString()}: ${shard.files.length.toString()} files, weight ${shard.weight.toString()}`)
	}
	for (const filePath of selectedShard.files) {
		console.log(filePath)
	}
	process.exit(0)
}
if (selectedShard.files.length === 0) {
	console.log('Selected balanced shard has no test files.')
	process.exit(0)
}

const child = Bun.spawn({
	cmd: [process.execPath, 'test', '--preload', './bun-test-setup-ui.ts', '--reporter=dots', '--timeout', '300000', ...passthroughArgs, ...selectedShard.files],
	stderr: 'inherit',
	stdin: 'inherit',
	stdout: 'inherit',
})

process.exit(await child.exited)
