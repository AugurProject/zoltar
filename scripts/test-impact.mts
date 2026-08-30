import { execFileSync } from 'node:child_process'
import { getChangedFileEntries, type ChangedFileEntry } from './changed-files.mts'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { isTestSourceFile } from './test-discovery.mts'

export type TestImpactRecommendation = {
	command: string
	reason: string
}

type TestImpactRule = TestImpactRecommendation & {
	matches: (filePath: string) => boolean
}

const TEST_INFRASTRUCTURE_PATHS = new Set([
	'bun-test-setup.ts',
	'bun-test-setup-solidity.ts',
	'bun-test-setup-ui.ts',
	'bunfig.toml',
	'scripts/merge-test-timings.mts',
	'scripts/mutation-support.mts',
	'scripts/run-mutation-smoke.mts',
	'scripts/run-balanced-test-shard.mts',
	'scripts/run-tests.mts',
	'scripts/run-tests.test.ts',
	'scripts/test-discovery.mts',
	'scripts/test-discovery.test.ts',
	'scripts/test-impact.mts',
	'scripts/test-impact.test.ts',
	'scripts/test-timings.mts',
])

const TEST_IMPACT_RULES: readonly TestImpactRule[] = [
	{
		command: 'bun test scripts/mutation-support.test.ts scripts/test-discovery.test.ts scripts/run-tests.test.ts scripts/test-impact.test.ts',
		reason: 'root test discovery, execution, timing, or impact selection changed',
		matches: filePath => TEST_INFRASTRUCTURE_PATHS.has(filePath),
	},
	{
		command: 'bun test scripts/coverage-report.test.ts',
		reason: 'coverage collection, reporting, or policy changed',
		matches: filePath => filePath === '.coverage-policy.json' || filePath === 'scripts/coverage-report.mts' || filePath === 'scripts/run-typescript-coverage.mts' || filePath === 'scripts/run-solidity-bytecode-coverage.mts',
	},
	{
		command: 'bun test scripts/ui-split-workflows.test.ts',
		reason: 'CI or coverage workflow wiring changed',
		matches: filePath => filePath === '.github/workflows/ci.yml' || filePath === '.github/workflows/browser-workflow.yml' || filePath === '.github/workflows/coverage.yml' || filePath.startsWith('ci-proposals/workflows/'),
	},
	{
		command: 'bun run test:browser:smoke',
		reason: 'production build or browser smoke behavior changed',
		matches: filePath => filePath === 'ui/coreShared/build/production.mts' || filePath === 'ui/coreShared/build/appPaths.mts',
	},
	{
		command: 'bun run test:browser:workflow',
		reason: 'production browser workflow coverage changed',
		matches: filePath => filePath === 'ui/coreShared/build/production.mts',
	},
	{
		command: 'bun test --preload ./bun-test-setup-ui.ts --timeout 300000 ui/zoltar/ts/tests/protocol/uniswapQuoter.test.ts',
		reason: 'Uniswap quote selection behavior changed',
		matches: filePath => filePath === 'ui/zoltar/ts/protocol/uniswapQuoter.ts',
	},
	{
		command: 'bun run test:integration:mainnet-fork',
		reason: 'deterministic historical Uniswap routing changed; requires MAINNET_ARCHIVE_RPC_URL',
		matches: filePath => filePath === 'ui/zoltar/ts/protocol/uniswapQuoter.ts' || filePath === 'ui/zoltar/ts/tests/protocol/uniswapQuoter.fork.test.ts',
	},
	{
		command: 'bun run test:integration:mainnet',
		reason: 'mutable Uniswap mainnet smoke coverage changed',
		matches: filePath => filePath === 'ui/zoltar/ts/tests/protocol/uniswapQuoter.integration.test.ts',
	},
]

function directTestCommand(filePath: string) {
	if (!/\.(?:fuzz|spec|test)\.(?:cts|mts|ts|tsx)$/.test(filePath)) return undefined
	if (filePath.startsWith('augurScan/')) return `cd augurScan && bun test ${filePath.slice('augurScan/'.length)}`
	const botMatch = /^bots\/([^/]+)\/(.+)$/.exec(filePath)
	if (botMatch?.[1] !== undefined && botMatch[2] !== undefined) return `cd bots/${botMatch[1]} && bun test ${botMatch[2]}`
	if (filePath.startsWith('solidity/ts/')) return `bun test --preload ./bun-test-setup-solidity.ts --timeout 300000 ${filePath}`
	if (filePath.startsWith('ui/')) return `bun test --preload ./bun-test-setup-ui.ts --timeout 300000 ${filePath}`
	return `bun test ${filePath}`
}

const IMPORT_GRAPH_IGNORED_DIRECTORIES = new Set(['.git', '.t3', 'artifacts', 'coverage', 'dist', 'js', 'node_modules', 'vendor'])
const IMPORT_GRAPH_SOURCE_PATTERN = /\.(?:cts|mts|ts|tsx)$/
const PACKAGE_ALIASES = new Map([
	['@zoltar/shared/', 'shared/ts/'],
	['@zoltar/bot-shared/', 'bots/shared/src/'],
	['@zoltar/ui-core-shared/', 'ui/coreShared/ts/'],
	['@zoltar/ui-statoblast/', 'ui/statoblast/ts/'],
	['@zoltar/ui-zoltar/', 'ui/zoltar/ts/'],
])

async function collectImportGraphSources(repositoryRoot: string, directoryPath = repositoryRoot): Promise<string[]> {
	const entries = await fs.readdir(directoryPath, { withFileTypes: true })
	const files: string[] = []
	for (const entry of entries) {
		if (entry.isDirectory() && IMPORT_GRAPH_IGNORED_DIRECTORIES.has(entry.name)) continue
		const entryPath = path.join(directoryPath, entry.name)
		if (entry.isDirectory()) files.push(...(await collectImportGraphSources(repositoryRoot, entryPath)))
		else if (entry.isFile() && IMPORT_GRAPH_SOURCE_PATTERN.test(entry.name)) files.push(path.relative(repositoryRoot, entryPath).replaceAll('\\', '/'))
	}
	return files
}

async function readCurrentSources(repositoryRoot: string) {
	const sources = new Map<string, string>()
	for (const filePath of await collectImportGraphSources(repositoryRoot)) sources.set(filePath, await fs.readFile(path.join(repositoryRoot, filePath), 'utf8'))
	return sources
}

function readBaselineSources(reference = 'origin/main') {
	const sources = new Map<string, string>()
	const filePaths = execFileSync('git', ['ls-tree', '-r', '--name-only', '-z', reference], { encoding: 'utf8' })
		.split('\0')
		.filter(filePath => IMPORT_GRAPH_SOURCE_PATTERN.test(filePath))
	for (const filePath of filePaths) sources.set(filePath, execFileSync('git', ['show', `${reference}:${filePath}`], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }))
	return sources
}

function extractImportSpecifiers(source: string) {
	const specifiers = new Set<string>()
	for (const match of source.matchAll(/(?:\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s*)?|\bimport\s*\(|\brequire\s*\()\s*['"]([^'"]+)['"]/g)) {
		const specifier = match[1]
		if (specifier !== undefined) specifiers.add(specifier)
	}
	return [...specifiers]
}

function resolveImportSpecifier(importer: string, specifier: string, sourceFiles: ReadonlySet<string>) {
	let unresolvedPath: string | undefined
	if (specifier.startsWith('.')) unresolvedPath = path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier))
	else {
		for (const [alias, aliasRoot] of PACKAGE_ALIASES) {
			if (specifier.startsWith(alias)) unresolvedPath = `${aliasRoot}${specifier.slice(alias.length)}`
		}
	}
	if (unresolvedPath === undefined) return undefined

	const withoutGeneratedExtension = unresolvedPath.replace(/\.(?:c|m)?js$/, '')
	const candidates = [unresolvedPath, withoutGeneratedExtension, ...['.ts', '.tsx', '.mts', '.cts'].map(extension => `${withoutGeneratedExtension}${extension}`), ...['.ts', '.tsx', '.mts', '.cts'].map(extension => `${withoutGeneratedExtension}/index${extension}`)]
	return candidates.find(candidate => sourceFiles.has(candidate))
}

function groupedTestCommands(testFiles: readonly string[]) {
	const groups = new Map<string, string[]>()
	for (const filePath of testFiles) {
		let group = 'root'
		let commandPath = filePath
		if (filePath.startsWith('augurScan/')) {
			group = 'augurScan'
			commandPath = filePath.slice('augurScan/'.length)
		} else {
			const botMatch = /^bots\/([^/]+)\/(.+)$/.exec(filePath)
			if (botMatch?.[1] !== undefined && botMatch[2] !== undefined) {
				group = `bots/${botMatch[1]}`
				commandPath = botMatch[2]
			} else if (filePath.startsWith('solidity/ts/')) group = 'solidity'
			else if (filePath.startsWith('ui/')) group = 'ui'
		}
		const files = groups.get(group) ?? []
		files.push(commandPath)
		groups.set(group, files)
	}

	return [...groups]
		.map(([group, files]) => {
			const paths = files.sort((left, right) => left.localeCompare(right)).join(' ')
			if (group === 'augurScan' || group.startsWith('bots/')) return `cd ${group} && bun test ${paths}`
			if (group === 'solidity') return `bun test --preload ./bun-test-setup-solidity.ts --timeout 300000 ${paths}`
			if (group === 'ui') return `bun test --preload ./bun-test-setup-ui.ts --timeout 300000 ${paths}`
			return `bun test ${paths}`
		})
		.sort((left, right) => left.localeCompare(right))
}

function findAffectedTests(changedFiles: readonly string[], sources: ReadonlyMap<string, string>) {
	const sourceFileSet = new Set(sources.keys())
	const reverseImports = new Map<string, Set<string>>()
	for (const [importer, source] of sources) {
		for (const specifier of extractImportSpecifiers(source)) {
			const dependency = resolveImportSpecifier(importer, specifier, sourceFileSet)
			if (dependency === undefined) continue
			const importers = reverseImports.get(dependency) ?? new Set<string>()
			importers.add(importer)
			reverseImports.set(dependency, importers)
		}
	}

	const affectedTests = new Set<string>()
	const visited = new Set(changedFiles.filter(filePath => sourceFileSet.has(filePath)))
	const queue = [...visited]
	while (queue.length > 0) {
		const dependency = queue.shift()
		if (dependency === undefined) break
		for (const importer of reverseImports.get(dependency) ?? []) {
			if (isTestSourceFile(importer)) affectedTests.add(importer)
			if (!visited.has(importer)) {
				visited.add(importer)
				queue.push(importer)
			}
		}
	}
	return affectedTests
}

type ImportGraphOptions = {
	baselineSources?: ReadonlyMap<string, string>
}

const normalizeChanges = (changes: readonly (string | ChangedFileEntry)[]): ChangedFileEntry[] => changes.map(change => (typeof change === 'string' ? { path: change, status: 'modified' } : change))

export async function getImportGraphTestRecommendations(changes: readonly (string | ChangedFileEntry)[], repositoryRoot = process.cwd(), options: ImportGraphOptions = {}) {
	const normalizedChanges = normalizeChanges(changes)
	const currentSources = await readCurrentSources(repositoryRoot)
	const affectedTests = findAffectedTests(
		normalizedChanges.filter(change => change.status !== 'deleted').map(change => change.path),
		currentSources,
	)
	const baselineRoots = normalizedChanges.flatMap(change => {
		if (change.status === 'deleted') return [change.path]
		if (change.status === 'renamed' && change.previousPath !== undefined) return [change.previousPath]
		return []
	})
	if (baselineRoots.length > 0) {
		const baselineSources = options.baselineSources ?? readBaselineSources()
		for (const testFile of findAffectedTests(baselineRoots, baselineSources)) {
			if (currentSources.has(testFile)) affectedTests.add(testFile)
		}
	}
	return groupedTestCommands([...affectedTests]).map(command => ({ command, reason: 'imports changed production source directly or transitively' }))
}

export function getTestImpactRecommendations(changes: readonly (string | ChangedFileEntry)[]) {
	const recommendations = new Map<string, TestImpactRecommendation>()
	for (const change of normalizeChanges(changes)) {
		const paths = [change.path, ...(change.previousPath === undefined ? [] : [change.previousPath])]
		const matchingRules = TEST_IMPACT_RULES.filter(rule => paths.some(filePath => rule.matches(filePath)))
		if (matchingRules.length === 0) {
			const directCommand = change.status === 'deleted' ? undefined : directTestCommand(change.path)
			if (directCommand !== undefined) recommendations.set(directCommand, { command: directCommand, reason: `changed test: ${change.path}` })
		}
		for (const rule of matchingRules) recommendations.set(rule.command, { command: rule.command, reason: rule.reason })
	}
	return [...recommendations.values()].sort((left, right) => left.command.localeCompare(right.command))
}

const TEST_PATH_PATTERN = /\.(?:fuzz|spec|test)\.(?:cts|mts|ts|tsx)$/

export function deduplicateTestRecommendations(recommendations: readonly TestImpactRecommendation[]) {
	const uniqueRecommendations = [...new Map(recommendations.map(recommendation => [recommendation.command, recommendation])).values()]
	const standalone: TestImpactRecommendation[] = []
	const groups = new Map<string, { reasons: Set<string>; testPaths: Set<string> }>()
	for (const recommendation of uniqueRecommendations) {
		const tokens = recommendation.command.split(' ')
		const testPaths = new Set(tokens.filter(token => TEST_PATH_PATTERN.test(token)))
		if (testPaths.size === 0) {
			standalone.push(recommendation)
			continue
		}
		const runner = tokens.filter(token => !testPaths.has(token)).join(' ')
		const group = groups.get(runner) ?? { reasons: new Set<string>(), testPaths: new Set<string>() }
		for (const testPath of testPaths) group.testPaths.add(testPath)
		group.reasons.add(recommendation.reason)
		groups.set(runner, group)
	}
	const grouped = [...groups].map(([runner, group]) => ({
		command: `${runner} ${[...group.testPaths].sort((left, right) => left.localeCompare(right)).join(' ')}`,
		reason: [...group.reasons].join('; '),
	}))
	return [...standalone, ...grouped].sort((left, right) => left.command.localeCompare(right.command))
}

if (import.meta.main) {
	const changes = getChangedFileEntries()
	const recommendations = deduplicateTestRecommendations([...getTestImpactRecommendations(changes), ...(await getImportGraphTestRecommendations(changes))])
	if (recommendations.length === 0) {
		console.log('No static test-impact mapping matched. Trace changed imports, ownership, interfaces, and consumers using AGENTS.md.')
	} else {
		console.log('Suggested starting checks; confirm affected imports and consumers before running:')
		for (const recommendation of recommendations) console.log(`- ${recommendation.command}\n  ${recommendation.reason}`)
	}
}
