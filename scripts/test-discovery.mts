import { existsSync, promises as fs } from 'node:fs'
import * as path from 'node:path'

export const TEST_ROOTS = ['scripts', 'shared/ts', 'solidity/ts', 'ui/build', 'ui/ts'] as const
export const IGNORED_TEST_DIRECTORY_NAMES = new Set(['node_modules', 'js', 'dist', 'vendor'])
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
	return [...new Set(files)].sort((left, right) => left.localeCompare(right))
}

export type WeightedTestFile = {
	filePath: string
	weight: number
}

export type TestShard = {
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
