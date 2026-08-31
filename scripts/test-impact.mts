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
	ownedTestOptions?: SpecializedTestOptions
	ownedTestPaths?: readonly string[]
	selectOnOwnedRename?: boolean
}

type SpecializedTestOptions = {
	environment?: string
	testNamePattern?: string
	timeout: number
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
		matches: filePath => filePath === 'ui/coreShared/build/production.mts' || filePath === 'ui/coreShared/build/appPaths.mts' || filePath === 'ui/coreShared/build/browserSmoke.mts',
		ownedTestOptions: { timeout: 300_000 },
		ownedTestPaths: ['ui/coreShared/build/browserSmoke.test.ts', 'ui/coreShared/build/productionBuild.test.ts'],
	},
	{
		command: 'bun run test:browser:workflow',
		reason: 'production browser workflow coverage changed',
		matches: filePath => filePath === 'ui/coreShared/build/production.mts',
		ownedTestOptions: {
			environment: 'RUN_PRODUCTION_BROWSER_WORKFLOWS=1',
			testNamePattern: "'production bundle (boots the statoblast fork and auction scenario|executes deployment, reporting, fork migration, failure recovery, and truth auction finalization)'",
			timeout: 600_000,
		},
		ownedTestPaths: ['ui/coreShared/build/productionBuild.test.ts'],
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
		ownedTestOptions: { environment: 'RUN_MAINNET_FORK_INTEGRATION_TESTS=1', timeout: 300_000 },
		ownedTestPaths: ['ui/zoltar/ts/tests/protocol/uniswapQuoter.fork.test.ts'],
		selectOnOwnedRename: true,
	},
	{
		command: 'bun run test:integration:mainnet',
		reason: 'mutable Uniswap mainnet smoke coverage changed',
		matches: filePath => filePath === 'ui/zoltar/ts/tests/protocol/uniswapQuoter.integration.test.ts',
		ownedTestOptions: { environment: 'RUN_MAINNET_INTEGRATION_TESTS=1', timeout: 300_000 },
		ownedTestPaths: ['ui/zoltar/ts/tests/protocol/uniswapQuoter.integration.test.ts'],
		selectOnOwnedRename: true,
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

function specializedTestCommand(filePath: string, options: SpecializedTestOptions) {
	const directCommand = directTestCommand(filePath)
	if (directCommand === undefined) return undefined
	const prerequisites = 'bun run ensure-contract-artifacts && bun run check:shared-dependencies'
	const flags = [`--timeout ${options.timeout.toString()}`, ...(options.testNamePattern === undefined ? [] : [`--test-name-pattern ${options.testNamePattern}`])].join(' ')
	const commandWithoutTimeout = directCommand.replace(/ --timeout \d+/, '')
	const commandWithOptions = commandWithoutTimeout.replace(/ ([^ ]+)$/, ` ${flags} $1`)
	const environment = options.environment === undefined ? '' : `${options.environment} `
	const packageCommand = /^(cd [^ ]+ && )(.+)$/.exec(commandWithOptions)
	if (packageCommand?.[1] !== undefined && packageCommand[2] !== undefined) return `${prerequisites} && ${packageCommand[1]}${environment}${packageCommand[2]}`
	return `${prerequisites} && ${environment}${commandWithOptions}`
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

type PackageImportMap = ReadonlyMap<string, ReadonlyMap<string, string>>

function parsePackageImports(source: string) {
	const packageJson: unknown = JSON.parse(source)
	if (typeof packageJson !== 'object' || packageJson === null) return new Map<string, string>()
	const importsValue = Reflect.get(packageJson, 'imports')
	if (typeof importsValue !== 'object' || importsValue === null || Array.isArray(importsValue)) return new Map<string, string>()
	return new Map(Object.entries(importsValue).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}

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

async function readCurrentPackageImports(repositoryRoot: string, sourceFiles: Iterable<string>) {
	const packageRoots = new Set(
		[...sourceFiles]
			.map(filePath => path.posix.dirname(filePath))
			.flatMap(directory => {
				const ancestors: string[] = []
				for (let current = directory; current !== '.'; current = path.posix.dirname(current)) ancestors.push(current)
				return ancestors
			}),
	)
	const packageImports = new Map<string, ReadonlyMap<string, string>>()
	await Promise.all(
		[...packageRoots].map(async packageRoot => {
			try {
				const imports = parsePackageImports(await fs.readFile(path.join(repositoryRoot, packageRoot, 'package.json'), 'utf8'))
				if (imports.size > 0) packageImports.set(packageRoot, imports)
			} catch (error) {
				if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'ENOENT') throw error
			}
		}),
	)
	return packageImports
}

function resolveMergeBase(repositoryRoot: string) {
	const mergeBase = execFileSync('git', ['merge-base', 'origin/main', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim()
	if (mergeBase === '') throw new Error('Git could not resolve the merge base of origin/main and HEAD')
	return mergeBase
}

function readBaselineSources(reference: string, repositoryRoot: string) {
	const sources = new Map<string, string>()
	const filePaths = execFileSync('git', ['ls-tree', '-r', '--name-only', '-z', reference], { cwd: repositoryRoot, encoding: 'utf8' })
		.split('\0')
		.filter(filePath => IMPORT_GRAPH_SOURCE_PATTERN.test(filePath))
	for (const filePath of filePaths) sources.set(filePath, execFileSync('git', ['show', `${reference}:${filePath}`], { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }))
	return sources
}

function readBaselinePackageImports(reference: string, repositoryRoot: string) {
	const packageImports = new Map<string, ReadonlyMap<string, string>>()
	const packagePaths = execFileSync('git', ['ls-tree', '-r', '--name-only', '-z', reference], { cwd: repositoryRoot, encoding: 'utf8' })
		.split('\0')
		.filter(filePath => path.posix.basename(filePath) === 'package.json')
	for (const packagePath of packagePaths) {
		const imports = parsePackageImports(execFileSync('git', ['show', `${reference}:${packagePath}`], { cwd: repositoryRoot, encoding: 'utf8' }))
		if (imports.size > 0) packageImports.set(path.posix.dirname(packagePath), imports)
	}
	return packageImports
}

function extractImportSpecifiers(source: string) {
	const specifiers = new Set<string>()
	for (const match of source.matchAll(/(?:\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s*)?|\bimport\s*\(|\brequire\s*\()\s*['"]([^'"]+)['"]/g)) {
		const specifier = match[1]
		if (specifier !== undefined) specifiers.add(specifier)
	}
	return [...specifiers]
}

function resolvePackageImport(importer: string, specifier: string, packageImports: PackageImportMap) {
	const matchingRoot = [...packageImports.keys()].filter(packageRoot => importer.startsWith(`${packageRoot}/`)).sort((left, right) => right.length - left.length)[0]
	if (matchingRoot === undefined) return undefined
	for (const [alias, target] of packageImports.get(matchingRoot) ?? []) {
		const wildcardIndex = alias.indexOf('*')
		if (wildcardIndex === -1) {
			if (specifier === alias) return path.posix.join(matchingRoot, target)
			continue
		}
		const prefix = alias.slice(0, wildcardIndex)
		const suffix = alias.slice(wildcardIndex + 1)
		if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue
		const wildcard = specifier.slice(prefix.length, specifier.length - suffix.length)
		return path.posix.join(matchingRoot, target.replace('*', wildcard))
	}
	return undefined
}

function resolveImportSpecifier(importer: string, specifier: string, sourceFiles: ReadonlySet<string>, packageImports: PackageImportMap) {
	let unresolvedPath: string | undefined
	if (specifier.startsWith('.')) unresolvedPath = path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier))
	else if (specifier.startsWith('#')) unresolvedPath = resolvePackageImport(importer, specifier, packageImports)
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

function findAffectedTests(changedFiles: readonly string[], sources: ReadonlyMap<string, string>, packageImports: PackageImportMap) {
	const sourceFileSet = new Set(sources.keys())
	const reverseImports = new Map<string, Set<string>>()
	for (const [importer, source] of sources) {
		for (const specifier of extractImportSpecifiers(source)) {
			const dependency = resolveImportSpecifier(importer, specifier, sourceFileSet, packageImports)
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
	baselineReference?: string
	baselinePackageImports?: PackageImportMap
	baselineSources?: ReadonlyMap<string, string>
}

const normalizeChanges = (changes: readonly (string | ChangedFileEntry)[]): ChangedFileEntry[] => changes.map(change => (typeof change === 'string' ? { path: change, status: 'modified' } : change))

export async function getImportGraphTestRecommendations(changes: readonly (string | ChangedFileEntry)[], repositoryRoot = process.cwd(), options: ImportGraphOptions = {}) {
	const normalizedChanges = normalizeChanges(changes)
	const currentSources = await readCurrentSources(repositoryRoot)
	const currentPackageImports = await readCurrentPackageImports(repositoryRoot, currentSources.keys())
	const affectedTests = findAffectedTests(
		normalizedChanges.filter(change => change.status !== 'deleted').map(change => change.path),
		currentSources,
		currentPackageImports,
	)
	const baselineRoots = normalizedChanges.flatMap(change => {
		if (change.status === 'deleted') return [change.path]
		if (change.status === 'renamed' && change.previousPath !== undefined) return [change.previousPath]
		return []
	})
	if (baselineRoots.length > 0) {
		const baselineReference = options.baselineReference ?? (options.baselineSources === undefined ? resolveMergeBase(repositoryRoot) : undefined)
		const baselineSources = options.baselineSources ?? readBaselineSources(baselineReference ?? resolveMergeBase(repositoryRoot), repositoryRoot)
		const baselinePackageImports = options.baselinePackageImports ?? (options.baselineSources === undefined ? readBaselinePackageImports(baselineReference ?? resolveMergeBase(repositoryRoot), repositoryRoot) : new Map())
		for (const testFile of findAffectedTests(baselineRoots, baselineSources, baselinePackageImports)) {
			if (currentSources.has(testFile)) affectedTests.add(testFile)
		}
	}
	return groupedTestCommands([...affectedTests]).map(command => ({ command, reason: 'imports changed production source directly or transitively' }))
}

export function getTestImpactRecommendations(changes: readonly (string | ChangedFileEntry)[]) {
	const normalizedChanges = normalizeChanges(changes)
	const changedTestPaths = new Map<string, string | undefined>()
	for (const change of normalizedChanges) {
		if (change.status === 'deleted' && isTestSourceFile(change.path)) changedTestPaths.set(change.path, undefined)
		else if (change.status === 'renamed' && change.previousPath !== undefined && isTestSourceFile(change.previousPath)) changedTestPaths.set(change.previousPath, change.path)
	}
	const recommendations = new Map<string, TestImpactRecommendation>()
	const addRule = (rule: TestImpactRule) => {
		const changedOwnedPaths = rule.ownedTestPaths?.filter(testPath => changedTestPaths.has(testPath)) ?? []
		if (changedOwnedPaths.length > 0) {
			for (const testPath of changedOwnedPaths) {
				const currentPath = changedTestPaths.get(testPath)
				if (currentPath === undefined) continue
				const command = rule.ownedTestOptions === undefined ? directTestCommand(currentPath) : specializedTestCommand(currentPath, rule.ownedTestOptions)
				if (command !== undefined) recommendations.set(command, { command, reason: `renamed test: ${testPath} -> ${currentPath}` })
			}
			return
		}
		recommendations.set(rule.command, { command: rule.command, reason: rule.reason })
	}
	for (const change of normalizedChanges) {
		const changedTestWasDeleted = change.status === 'deleted' && isTestSourceFile(change.path)
		const matchingRules = changedTestWasDeleted ? [] : TEST_IMPACT_RULES.filter(rule => rule.matches(change.path) || (rule.selectOnOwnedRename === true && change.status === 'renamed' && change.previousPath !== undefined && rule.ownedTestPaths?.includes(change.previousPath) === true))
		if (matchingRules.length === 0) {
			const directCommand = change.status === 'deleted' ? undefined : directTestCommand(change.path)
			if (directCommand !== undefined) recommendations.set(directCommand, { command: directCommand, reason: `changed test: ${change.path}` })
		}
		for (const rule of matchingRules) addRule(rule)
	}
	const rewrittenRecommendations = new Map<string, TestImpactRecommendation>()
	for (const recommendation of recommendations.values()) {
		const tokens = recommendation.command.split(' ')
		const originalTestPaths = tokens.filter(token => TEST_PATH_PATTERN.test(token))
		const rewrittenTokens = tokens.flatMap(token => {
			if (!TEST_PATH_PATTERN.test(token) || !changedTestPaths.has(token)) return [token]
			return []
		})
		if (originalTestPaths.length > 0 && !rewrittenTokens.some(token => TEST_PATH_PATTERN.test(token))) continue
		const command = rewrittenTokens.join(' ')
		rewrittenRecommendations.set(command, { command, reason: recommendation.reason })
	}
	return [...rewrittenRecommendations.values()].sort((left, right) => left.command.localeCompare(right.command))
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
