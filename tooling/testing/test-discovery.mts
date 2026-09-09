import { sharedPackages } from '../repo/sharedPackages.ts'
import { existsSync, promises as fs } from 'node:fs'
import * as path from 'node:path'

const APPLICATION_TEST_ROOTS = ['scripts', 'tooling', ...sharedPackages.map(entry => `${entry.path}/ts`), 'ui/coreShared/ts', 'ui/zoltar/ts', 'ui/statoblast/ts', 'ui/trading/ts'] as const
const SOLIDITY_TEST_ROOTS = ['solidity/ts'] as const
const TEST_ROOTS = [...APPLICATION_TEST_ROOTS, ...SOLIDITY_TEST_ROOTS] as const
const TEST_DOMAINS = ['all', 'application', 'solidity'] as const
export type TestDomain = (typeof TEST_DOMAINS)[number]
const IGNORED_TEST_DIRECTORY_NAMES = new Set(['node_modules', 'js', 'dist', 'vendor'])
export const EXPLICIT_TEST_TIER_FILES = new Set(['tooling/ui/browserSmoke.test.ts', 'tooling/ui/productionBuild.test.ts', 'ui/statoblast/ts/tests/features/security-pools/collateralizationCircle.browser.test.ts'])
export const MAXIMUM_TEST_PARALLELISM = 2

export function getDefaultTestParallelism(availableParallelism: number) {
	return Math.max(1, Math.min(MAXIMUM_TEST_PARALLELISM, availableParallelism))
}

export function isTestSourceFile(filePath: string) {
	return /\.(test|spec|fuzz)\.(ts|tsx|mts|cts)$/.test(filePath)
}

export function toBunTestPath(filePath: string) {
	if (path.isAbsolute(filePath) || filePath.startsWith('./') || filePath.startsWith('../')) return filePath
	return `./${filePath}`
}

export function isExplicitTestPath(argument: string, repositoryRoot = process.cwd()) {
	if (argument.startsWith('-')) return false
	return isTestSourceFile(argument) || existsSync(path.resolve(repositoryRoot, argument))
}

const BUN_TEST_OPTIONS_WITH_VALUES = new Set(['-t', '--coverage-dir', '--coverage-reporter', '--grep', '--max-concurrency', '--parallel-delay', '--path-ignore-patterns', '--preload', '--reporter', '--reporter-outfile', '--rerun-each', '--retry', '--seed', '--shard', '--test-name-pattern', '--timeout', '--timings'])
const BUN_TEST_OPTIONS_WITH_OPTIONAL_NUMERIC_VALUES = new Set(['--bail', '--parallel'])
const BUN_TEST_OPTIONS_WITH_OPTIONAL_STRING_VALUES = new Set(['--changed'])

export function hasExplicitTestPath(arguments_: readonly string[], repositoryRoot = process.cwd()) {
	for (let index = 0; index < arguments_.length; index += 1) {
		const argument = arguments_[index]
		if (argument === undefined) continue
		const optionName = argument.split('=', 1)[0]
		if (optionName !== undefined && BUN_TEST_OPTIONS_WITH_VALUES.has(optionName)) {
			if (argument === optionName) index += 1
			continue
		}
		if (optionName !== undefined && BUN_TEST_OPTIONS_WITH_OPTIONAL_NUMERIC_VALUES.has(optionName)) {
			if (argument === optionName && /^\d+$/.test(arguments_[index + 1] ?? '')) index += 1
			continue
		}
		if (optionName !== undefined && BUN_TEST_OPTIONS_WITH_OPTIONAL_STRING_VALUES.has(optionName)) {
			const nextArgument = arguments_[index + 1]
			if (argument === optionName && nextArgument !== undefined && !nextArgument.startsWith('-') && !isExplicitTestPath(nextArgument, repositoryRoot)) index += 1
			continue
		}
		if (isExplicitTestPath(argument, repositoryRoot)) return true
	}
	return false
}

async function collectTestFiles(repositoryRoot: string, directoryPath: string): Promise<string[]> {
	const entries = await fs.readdir(directoryPath, { withFileTypes: true })
	const files: string[] = []

	for (const entry of entries) {
		if (IGNORED_TEST_DIRECTORY_NAMES.has(entry.name)) continue

		const entryPath = path.join(directoryPath, entry.name)
		if (entry.isDirectory()) {
			files.push(...(await collectTestFiles(repositoryRoot, entryPath)))
			continue
		}

		if (entry.isFile() && isTestSourceFile(entry.name)) files.push(path.relative(repositoryRoot, entryPath).replaceAll('\\', '/'))
	}

	return files
}

export async function discoverTestFiles(repositoryRoot = process.cwd(), testRoots: readonly string[] = TEST_ROOTS) {
	const files = (await Promise.all(testRoots.map(testRoot => collectTestFiles(repositoryRoot, path.join(repositoryRoot, testRoot))))).flat()
	return [...new Set(files)].filter(filePath => !EXPLICIT_TEST_TIER_FILES.has(filePath)).sort((left, right) => left.localeCompare(right))
}

export function isTestDomain(value: string): value is TestDomain {
	return TEST_DOMAINS.some(domain => domain === value)
}

function getTestRootsForDomain(domain: TestDomain) {
	if (domain === 'application') return APPLICATION_TEST_ROOTS
	if (domain === 'solidity') return SOLIDITY_TEST_ROOTS
	return TEST_ROOTS
}

export function discoverTestFilesForDomain(domain: TestDomain, repositoryRoot = process.cwd()) {
	return discoverTestFiles(repositoryRoot, getTestRootsForDomain(domain))
}

export type WeightedTestFile = {
	filePath: string
	weight: number
}

type TestShard = {
	index: number
	files: string[]
	weight: number
}

export function createBalancedTestShards(testFiles: readonly WeightedTestFile[], shardCount: number) {
	const shards: TestShard[] = []
	for (let index = 0; index < shardCount; index += 1) shards.push({ index, files: [], weight: 0 })

	for (const testFile of testFiles) {
		const initialShard = shards[0]
		if (initialShard === undefined) throw new Error('Test shard count must be positive')
		const targetShard = shards.reduce((current, candidate) => {
			if (candidate.weight < current.weight) return candidate
			if (candidate.weight === current.weight && candidate.files.length < current.files.length) return candidate
			if (candidate.weight === current.weight && candidate.files.length === current.files.length && candidate.index < current.index) return candidate
			return current
		}, initialShard)
		targetShard.files.push(testFile.filePath)
		targetShard.weight += testFile.weight
	}

	return shards
}
