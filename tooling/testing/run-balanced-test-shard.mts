import { sharedPackages } from '../repo/sharedPackages.ts'
import * as process from 'node:process'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { runBunTestProcess } from './run-bun-test-process.mts'
import { createBalancedTestShards, discoverTestFilesForDomain, isTestDomain, toBunTestPath, type TestDomain, type WeightedTestFile } from './test-discovery.mts'
import { createTestFingerprints, filterTestTimingHistory, getHistoricalTestWeights, readTestTimingHistory, writeTestTimingObservation } from './test-timings.mts'

const repositoryRoot = process.cwd()

const SHARED_TIMING_CONTEXT_PATHS = ['bun-test-setup.ts', 'bunfig.toml'] as const
const APPLICATION_TIMING_CONTEXT_PATHS = [
	...SHARED_TIMING_CONTEXT_PATHS,
	'bun-test-setup-ui.ts',
	'bun.lock',
	...sharedPackages.map(entry => `${entry.path}/bun.lock`),
	'ui/coreShared/bun.lock',
	'ui/zoltarShared/bun.lock',
	'ui/statoblastShared/bun.lock',
	'ui/statoblast/bun.lock',
	'ui/trading/bun.lock',
	'ui/zoltar/bun.lock',
] as const
const SOLIDITY_TIMING_CONTEXT_PATHS = [...SHARED_TIMING_CONTEXT_PATHS, 'bun-test-setup-solidity.ts', 'bun.lock', ...sharedPackages.map(entry => `${entry.path}/bun.lock`), 'solidity/bun.lock'] as const

export function getTimingContextPaths(domain: TestDomain) {
	if (domain === 'application') return [...APPLICATION_TIMING_CONTEXT_PATHS]
	if (domain === 'solidity') return [...SOLIDITY_TIMING_CONTEXT_PATHS]
	return [...new Set([...APPLICATION_TIMING_CONTEXT_PATHS, ...SOLIDITY_TIMING_CONTEXT_PATHS])]
}

export const KNOWN_FILE_WEIGHTS = new Map<string, number>([
	['ui/statoblast/ts/tests/simulation/securityPoolEnvironments.test.ts', 80],
	['solidity/ts/tests/statoblast/forkMigration.test.ts', 220],
	['solidity/ts/tests/statoblast/truthAuction.test.ts', 135],
	['solidity/ts/tests/escalationGame.test.ts', 124],
	['solidity/ts/tests/priceOracleSecurity.test.ts', 113],
	['ui/zoltar/ts/tests/integration/activeEnvironment.test.ts', 15],
	['solidity/ts/tests/auction.test.ts', 81],
	['solidity/ts/tests/statoblastInvariant.test.ts', 78],
	['solidity/ts/tests/statoblast/escalationMigration.test.ts', 71],
	['solidity/ts/tests/statoblast/vaultAccounting.test.ts', 37],
	['solidity/ts/tests/statoblast/deploymentAndOwnForkEscalation.test.ts', 33],
	['ui/statoblast/ts/tests/features/open-oracle/openOracleSection.integration.test.tsx', 6],
	['ui/zoltar/ts/tests/integration/deployedEnvironment.test.ts', 4],
	['solidity/ts/tests/statoblast/receiveGuards.test.ts', 2],
])

const MANIFEST_ALTERING_OPTIONS = ['-t', '--changed', '--coverage', '--coverage-dir', '--coverage-reporter', '--grep', '--only', '--path-ignore-patterns', '--preload', '--reporter', '--reporter-outfile', '--test-name-pattern', '--todo'] as const

export function parseShardOption(args: readonly string[]): { domain: TestDomain; listOnly: boolean; shardIndex: number; shardCount: number; passthroughArgs: string[] } {
	const passthroughArgs: string[] = []
	let domain: TestDomain = 'all'
	let listOnly = false
	let shardValue: string | undefined

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index]
		if (arg === undefined) continue

		if (arg === '--list-only') {
			listOnly = true
			continue
		}
		if (arg === '--domain') {
			const nextArg = args[index + 1]
			if (nextArg === undefined || !isTestDomain(nextArg)) throw new Error('--domain requires one of: all, application, solidity')
			domain = nextArg
			index += 1
			continue
		}
		if (arg.startsWith('--domain=')) {
			const domainValue = arg.slice('--domain='.length)
			if (!isTestDomain(domainValue)) throw new Error(`Invalid test domain: ${domainValue}`)
			domain = domainValue
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
		if (MANIFEST_ALTERING_OPTIONS.some(option => arg === option || arg.startsWith(`${option}=`))) throw new Error(`Balanced shard argument can alter the execution manifest: ${arg}`)
		if (!arg.startsWith('-')) throw new Error(`Balanced shard argument can alter the execution manifest with an explicit path: ${arg}`)

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

	return { domain, listOnly, shardIndex, shardCount, passthroughArgs }
}

export async function getWeightedTestFiles(historyPath?: string, domain: TestDomain = 'all') {
	const files = await discoverTestFilesForDomain(domain, repositoryRoot)
	const uniqueFiles = new Set(files)
	if (historyPath !== undefined) {
		const history = await readTestTimingHistory(historyPath)
		if (history !== undefined) {
			const fingerprints = await createTestFingerprints(files, getTimingContextPaths(domain))
			const currentHistory = filterTestTimingHistory(history, fingerprints)
			return getHistoricalTestWeights(currentHistory, files)
				.map(file => ({ ...file, weight: (currentHistory.samplesByFile[file.filePath]?.length ?? 0) === 0 ? (KNOWN_FILE_WEIGHTS.get(file.filePath) ?? file.weight) : file.weight }))
				.sort((left, right) => right.weight - left.weight || left.filePath.localeCompare(right.filePath))
		}
	}
	return [...uniqueFiles]
		.map(
			(filePath): WeightedTestFile => ({
				filePath,
				weight: KNOWN_FILE_WEIGHTS.get(filePath) ?? 1,
			}),
		)
		.sort((left, right) => right.weight - left.weight || left.filePath.localeCompare(right.filePath))
}

if (import.meta.main) {
	const { domain, listOnly, shardIndex, shardCount, passthroughArgs } = parseShardOption(process.argv.slice(2))
	const timingHistoryPath = process.env['ZOLTAR_TEST_TIMING_HISTORY']
	const timingOutputPath = process.env['ZOLTAR_TEST_TIMING_OUTPUT']
	const testFiles = await getWeightedTestFiles(timingHistoryPath, domain)
	const shards = createBalancedTestShards(testFiles, shardCount)
	const selectedShard = shards[shardIndex - 1]
	if (selectedShard === undefined) throw new Error(`Unable to select shard ${shardIndex.toString()}/${shardCount.toString()}`)

	console.log(`Balanced ${domain} shard ${shardIndex.toString()}/${shardCount.toString()}: ${selectedShard.files.length.toString()} files, weight ${selectedShard.weight.toString()}`)
	if (listOnly) {
		for (const shard of shards) {
			console.log(`Shard ${(shard.index + 1).toString()}/${shardCount.toString()}: ${shard.files.length.toString()} files, weight ${shard.weight.toString()}`)
		}
		for (const filePath of selectedShard.files) console.log(filePath)
		process.exit(0)
	}
	if (selectedShard.files.length === 0) {
		throw new Error(`Selected balanced shard ${shardIndex.toString()}/${shardCount.toString()} has no test files`)
	}

	const junitPath = timingOutputPath === undefined ? undefined : `${timingOutputPath}.junit.xml`
	const reporterArguments = junitPath === undefined ? ['--reporter=dots'] : ['--reporter=junit', `--reporter-outfile=${junitPath}`]
	if (junitPath !== undefined) await fs.mkdir(path.dirname(junitPath), { recursive: true })
	const startedAt = performance.now()
	const preloadPath = domain === 'solidity' ? './bun-test-setup-solidity.ts' : './bun-test-setup-ui.ts'
	// Temporary CI diagnostic for the shard-4 preact resolution failure; remove after diagnosis.
	const reportPreactState = async (label: string) => {
		const { lstatSync, readlinkSync, existsSync } = await import('node:fs')
		const preactLink = path.join(repositoryRoot, 'ui', 'coreShared', 'node_modules', 'preact')
		const rootPreact = path.join(repositoryRoot, 'node_modules', 'preact')
		const describe = (target: string) => {
			try {
				const stat = lstatSync(target)
				return stat.isSymbolicLink() ? `symlink -> ${readlinkSync(target)}` : stat.isDirectory() ? 'directory' : 'file'
			} catch (error) {
				return `missing (${error instanceof Error ? error.message : String(error)})`
			}
		}
		console.error(`[preact-diagnostic ${label}] ui/coreShared/node_modules/preact: ${describe(preactLink)}`)
		console.error(`[preact-diagnostic ${label}] node_modules/preact: ${describe(rootPreact)}; package.json exists: ${existsSync(path.join(rootPreact, 'package.json'))}; test-utils exists: ${existsSync(path.join(rootPreact, 'test-utils', 'package.json'))}`)
		try {
			console.error(`[preact-diagnostic ${label}] resolve from js testUtils: ${Bun.resolveSync('preact', path.join(repositoryRoot, 'ui', 'coreShared', 'js', 'tests', 'testUtils'))}`)
		} catch (error) {
			console.error(`[preact-diagnostic ${label}] resolve from js testUtils failed: ${error instanceof Error ? error.message : String(error)}`)
		}
		let ancestor = path.join(repositoryRoot, 'ui', 'coreShared', 'js', 'tests', 'testUtils')
		const manifestReport: string[] = []
		while (ancestor.length >= repositoryRoot.length - 1) {
			for (const marker of ['package.json', 'bun.lock', 'node_modules']) {
				if (existsSync(path.join(ancestor, marker))) manifestReport.push(`${path.relative(repositoryRoot, ancestor) || '.'}/${marker}`)
			}
			const parent = path.dirname(ancestor)
			if (parent === ancestor) break
			ancestor = parent
		}
		console.error(`[preact-diagnostic ${label}] ancestor markers: ${manifestReport.join(', ')}`)
		const cacheRoot = path.join(process.env['HOME'] ?? '', '.bun', 'install', 'cache')
		try {
			const { readdirSync } = await import('node:fs')
			const cacheEntries = readdirSync(cacheRoot).filter(entry => entry.startsWith('preact'))
			console.error(`[preact-diagnostic ${label}] bun cache preact entries: ${cacheEntries.join(', ') || 'none'}`)
		} catch (error) {
			console.error(`[preact-diagnostic ${label}] bun cache unreadable: ${error instanceof Error ? error.message : String(error)}`)
		}
		const freshChild = Bun.spawnSync({
			cmd: [process.execPath, '-e', `try { console.log(Bun.resolveSync('preact', ${JSON.stringify(path.join(repositoryRoot, 'ui', 'coreShared', 'js', 'tests', 'testUtils'))})) } catch (error) { console.log('failed: ' + (error instanceof Error ? error.message : String(error))) }`],
			cwd: repositoryRoot,
		})
		console.error(`[preact-diagnostic ${label}] fresh child resolve: ${freshChild.stdout.toString().trim()}${freshChild.stderr.toString().trim()}`)
	}
	await reportPreactState('before')
	const exitCode = await runBunTestProcess({
		cmd: [process.execPath, 'test', '--preload', preloadPath, ...reporterArguments, '--timeout', '300000', ...passthroughArgs, ...selectedShard.files.map(toBunTestPath)],
	})
	await reportPreactState('after')
	const elapsedSeconds = (performance.now() - startedAt) / 1000
	if (exitCode === 0 && timingOutputPath !== undefined && junitPath !== undefined) {
		await writeTestTimingObservation(timingOutputPath, junitPath, elapsedSeconds, selectedShard.files, getTimingContextPaths(domain))
		const observation = JSON.parse(await fs.readFile(timingOutputPath, 'utf8')) as Record<string, unknown>
		Object.assign(observation, { domain, shardCount, shardIndex })
		await fs.writeFile(timingOutputPath, `${JSON.stringify(observation, undefined, 2)}\n`)
		console.log(`Recorded ${elapsedSeconds.toFixed(1)}s timing observation in ${timingOutputPath}`)
	}
	process.exit(exitCode)
}
