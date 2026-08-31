import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChangedFileEntry } from './changed-files.mts'
import { deduplicateTestRecommendations, getImportGraphTestRecommendations, getTestImpactRecommendations } from './test-impact.mts'

const commandsFor = (changedFiles: string[]) => getTestImpactRecommendations(changedFiles).map(recommendation => recommendation.command)

describe('test impact recommendations', () => {
	test('maps test infrastructure to its focused runner tests', () => {
		expect(commandsFor(['scripts/test-timings.mts'])).toEqual(['bun test scripts/mutation-support.test.ts scripts/test-discovery.test.ts scripts/run-tests.test.ts scripts/test-impact.test.ts'])
		expect(commandsFor(['bun-test-setup.ts'])).toEqual(['bun test scripts/mutation-support.test.ts scripts/test-discovery.test.ts scripts/run-tests.test.ts scripts/test-impact.test.ts'])
	})

	test('runs the changed production-build test without escalating solely because the test changed', () => {
		expect(commandsFor(['ui/coreShared/build/productionBuild.test.ts'])).toEqual(['bun test --preload ./bun-test-setup-ui.ts --timeout 300000 ui/coreShared/build/productionBuild.test.ts'])
		expect(commandsFor(['ui/coreShared/build/browserSmoke.mts'])).toEqual(['bun run test:browser:smoke'])
		expect(commandsFor(['ui/coreShared/css/application-surfaces.css'])).toEqual(['bun run test:browser:smoke'])
		expect(commandsFor(['ui/statoblast/ts/features/security-pools/components/CollateralizationCircle.tsx'])).toContain('bun run test:browser:smoke')
		expect(commandsFor(['ui/coreShared/build/production.mts'])).toEqual(['bun run test:browser:smoke', 'bun run test:browser:workflow'])
	})

	test('maps quote behavior to unit and deterministic fork coverage', () => {
		expect(commandsFor(['ui/zoltar/ts/protocol/uniswapQuoter.ts'])).toEqual(['bun run test:integration:mainnet-fork', 'bun test --preload ./bun-test-setup-ui.ts --timeout 300000 ui/zoltar/ts/tests/protocol/uniswapQuoter.test.ts'])
	})

	test('uses each package test runner for changed package-owned tests', () => {
		expect(commandsFor(['augurScan/src/index.test.ts', 'bots/open-oracle-arbitrager/src/quote.test.ts'])).toEqual(['cd augurScan && bun test src/index.test.ts', 'cd bots/open-oracle-arbitrager && bun test src/quote.test.ts'])
	})

	test('deduplicates recommendations shared by multiple changed files', () => {
		expect(commandsFor(['scripts/test-discovery.mts', 'scripts/test-discovery.test.ts', 'scripts/test-impact.mts', 'scripts/test-impact.test.ts', 'scripts/test-timings.mts'])).toEqual(['bun test scripts/mutation-support.test.ts scripts/test-discovery.test.ts scripts/run-tests.test.ts scripts/test-impact.test.ts'])
	})

	test('maps CI workflow changes to workflow contract tests', () => {
		expect(commandsFor(['.github/workflows/browser-workflow.yml', '.github/workflows/coverage.yml'])).toEqual(['bun test scripts/ui-split-workflows.test.ts'])
	})

	test('specialized external integration tiers replace ineffective raw test commands', () => {
		expect(commandsFor(['ui/zoltar/ts/tests/protocol/uniswapQuoter.integration.test.ts'])).toEqual(['bun run test:integration:mainnet'])
		expect(commandsFor(['ui/zoltar/ts/tests/protocol/uniswapQuoter.fork.test.ts'])).toEqual(['bun run test:integration:mainnet-fork'])
	})

	test('does not suggest a deleted test and uses the destination of a renamed test', () => {
		const changes: ChangedFileEntry[] = [
			{ path: 'ui/zoltar/ts/tests/deleted.test.ts', status: 'deleted' },
			{ path: 'ui/zoltar/ts/tests/new-name.test.ts', previousPath: 'ui/zoltar/ts/tests/old-name.test.ts', status: 'renamed' },
		]
		expect(getTestImpactRecommendations(changes).map(recommendation => recommendation.command)).toEqual(['bun test --preload ./bun-test-setup-ui.ts --timeout 300000 ui/zoltar/ts/tests/new-name.test.ts'])
	})

	test('rewrites or removes static infrastructure commands when their tests move or are deleted', () => {
		expect(getTestImpactRecommendations([{ path: 'scripts/test-impact.test.ts', status: 'deleted' }])).toEqual([])
		expect(getTestImpactRecommendations([{ path: 'scripts/renamed-impact.test.ts', previousPath: 'scripts/test-impact.test.ts', status: 'renamed' }]).map(recommendation => recommendation.command)).toEqual(['bun test scripts/renamed-impact.test.ts'])
		expect(
			getTestImpactRecommendations([
				{ path: 'bun-test-setup.ts', status: 'modified' },
				{ path: 'scripts/test-impact.test.ts', status: 'deleted' },
			]).map(recommendation => recommendation.command),
		).toEqual(['bun test scripts/mutation-support.test.ts scripts/test-discovery.test.ts scripts/run-tests.test.ts'])
		expect(
			getTestImpactRecommendations([
				{ path: 'bun-test-setup.ts', status: 'modified' },
				{ path: 'bots/liquidator/tests/renamed-impact.test.ts', previousPath: 'scripts/test-impact.test.ts', status: 'renamed' },
			]).map(recommendation => recommendation.command),
		).toEqual(['bun test scripts/mutation-support.test.ts scripts/test-discovery.test.ts scripts/run-tests.test.ts', 'cd bots/liquidator && bun test tests/renamed-impact.test.ts'])
	})

	test('does not retain opaque specialized tiers for deleted or renamed integration tests', () => {
		const integrationTest = 'ui/zoltar/ts/tests/protocol/uniswapQuoter.integration.test.ts'
		expect(getTestImpactRecommendations([{ path: integrationTest, status: 'deleted' }])).toEqual([])
		expect(getTestImpactRecommendations([{ path: 'ui/zoltar/ts/tests/protocol/uniswapQuoter.renamed.test.ts', previousPath: integrationTest, status: 'renamed' }]).map(recommendation => recommendation.command)).toEqual([
			'bun run ensure-contract-artifacts && bun run check:shared-dependencies && RUN_MAINNET_INTEGRATION_TESTS=1 bun test --preload ./bun-test-setup-ui.ts --timeout 300000 ui/zoltar/ts/tests/protocol/uniswapQuoter.renamed.test.ts',
		])
		const forkTest = 'ui/zoltar/ts/tests/protocol/uniswapQuoter.fork.test.ts'
		const renamedForkTest = 'bots/liquidator/tests/uniswapQuoter.fork.test.ts'
		expect(
			getTestImpactRecommendations([
				{ path: 'ui/zoltar/ts/protocol/uniswapQuoter.ts', status: 'modified' },
				{ path: renamedForkTest, previousPath: forkTest, status: 'renamed' },
			]).map(recommendation => recommendation.command),
		).toEqual([
			'bun run ensure-contract-artifacts && bun run check:shared-dependencies && cd bots/liquidator && RUN_MAINNET_FORK_INTEGRATION_TESTS=1 bun test --timeout 300000 tests/uniswapQuoter.fork.test.ts',
			'bun test --preload ./bun-test-setup-ui.ts --timeout 300000 ui/zoltar/ts/tests/protocol/uniswapQuoter.test.ts',
		])
	})

	test('removes or rewrites browser tiers when their owned production-build test moves', () => {
		const productionSource: ChangedFileEntry = { path: 'ui/coreShared/build/production.mts', status: 'modified' }
		const productionTest = 'ui/coreShared/build/productionBuild.test.ts'
		expect(getTestImpactRecommendations([productionSource, { path: productionTest, status: 'deleted' }])).toEqual([])
		expect(getTestImpactRecommendations([{ path: 'bots/liquidator/tests/productionBuild.test.ts', previousPath: productionTest, status: 'renamed' }]).map(recommendation => recommendation.command)).toEqual(['cd bots/liquidator && bun test tests/productionBuild.test.ts'])
		const combinedCommands = getTestImpactRecommendations([productionSource, { path: 'bots/liquidator/tests/productionBuild.test.ts', previousPath: productionTest, status: 'renamed' }]).map(recommendation => recommendation.command)
		expect(combinedCommands).toHaveLength(3)
		expect(combinedCommands).toEqual(
			expect.arrayContaining([
				'bun run ensure-contract-artifacts && bun run check:shared-dependencies && cd bots/liquidator && bun test --timeout 300000 tests/productionBuild.test.ts',
				"bun run ensure-contract-artifacts && bun run check:shared-dependencies && cd bots/liquidator && RUN_PRODUCTION_BROWSER_WORKFLOWS=1 bun test --timeout 600000 --test-name-pattern 'production bundle (boots the statoblast fork and auction scenario|executes deployment, reporting, fork migration, failure recovery, and truth auction finalization)' tests/productionBuild.test.ts",
				'cd bots/liquidator && bun test tests/productionBuild.test.ts',
			]),
		)
	})

	test('merges overlapping commands for the same runner so every selected test runs once', () => {
		expect(
			deduplicateTestRecommendations([
				{ command: 'bun test scripts/run-tests.test.ts scripts/test-impact.test.ts', reason: 'import graph' },
				{ command: 'bun test scripts/test-discovery.test.ts scripts/test-impact.test.ts', reason: 'test infrastructure' },
			]),
		).toEqual([
			{
				command: 'bun test scripts/run-tests.test.ts scripts/test-discovery.test.ts scripts/test-impact.test.ts',
				reason: 'import graph; test infrastructure',
			},
		])
	})

	test('traces changed production modules through transitive imports to owning tests', async () => {
		const repositoryRoot = await mkdtemp(join(tmpdir(), 'test-impact-'))
		try {
			await mkdir(join(repositoryRoot, 'ui', 'zoltar', 'ts', 'feature'), { recursive: true })
			await mkdir(join(repositoryRoot, 'ui', 'zoltar', 'ts', 'tests'), { recursive: true })
			await writeFile(join(repositoryRoot, 'ui', 'zoltar', 'ts', 'feature', 'source.ts'), 'export const value = 1\n')
			await writeFile(join(repositoryRoot, 'ui', 'zoltar', 'ts', 'feature', 'consumer.ts'), "export { value } from './source.js'\n")
			await writeFile(join(repositoryRoot, 'ui', 'zoltar', 'ts', 'tests', 'consumer.test.ts'), "import { value } from '../feature/consumer.js'\nvoid value\n")

			expect(await getImportGraphTestRecommendations(['ui/zoltar/ts/feature/source.ts'], repositoryRoot)).toEqual([
				{
					command: 'bun test --preload ./bun-test-setup-ui.ts --timeout 300000 ui/zoltar/ts/tests/consumer.test.ts',
					reason: 'imports changed production source directly or transitively',
				},
			])
		} finally {
			await rm(repositoryRoot, { recursive: true })
		}
	})

	test('traces bot-shared aliases across package boundaries to the consuming package runner', async () => {
		const repositoryRoot = await mkdtemp(join(tmpdir(), 'test-impact-bot-shared-'))
		try {
			await mkdir(join(repositoryRoot, 'bots', 'shared', 'src'), { recursive: true })
			await mkdir(join(repositoryRoot, 'bots', 'open-oracle-arbitrager', 'src'), { recursive: true })
			await mkdir(join(repositoryRoot, 'bots', 'open-oracle-arbitrager', 'tests'), { recursive: true })
			await writeFile(join(repositoryRoot, 'bots', 'shared', 'src', 'value.ts'), 'export const value = 1\n')
			await writeFile(join(repositoryRoot, 'bots', 'open-oracle-arbitrager', 'src', 'consumer.ts'), "export { value } from '@zoltar/bot-shared/value'\n")
			await writeFile(join(repositoryRoot, 'bots', 'open-oracle-arbitrager', 'tests', 'consumer.test.ts'), "import { value } from '../src/consumer.js'\nvoid value\n")

			expect(await getImportGraphTestRecommendations(['bots/shared/src/value.ts'], repositoryRoot)).toEqual([
				{
					command: 'cd bots/open-oracle-arbitrager && bun test tests/consumer.test.ts',
					reason: 'imports changed production source directly or transitively',
				},
			])
		} finally {
			await rm(repositoryRoot, { recursive: true })
		}
	})

	test('traces package import-map wildcard and exact aliases to bot tests', async () => {
		const repositoryRoot = await mkdtemp(join(tmpdir(), 'test-impact-package-imports-'))
		try {
			const packageRoot = join(repositoryRoot, 'bots', 'open-oracle-arbitrager')
			await mkdir(join(packageRoot, 'src', 'core'), { recursive: true })
			await mkdir(join(packageRoot, 'src', 'infrastructure'), { recursive: true })
			await mkdir(join(packageRoot, 'tests', 'core'), { recursive: true })
			await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ imports: { '#core/*': './src/core/*.ts', '#ethereum': './src/infrastructure/ethereum.ts' } }))
			await writeFile(join(packageRoot, 'src', 'core', 'strategy.ts'), 'export const strategy = 1\n')
			await writeFile(join(packageRoot, 'src', 'infrastructure', 'ethereum.ts'), 'export const ethereum = 1\n')
			await writeFile(join(packageRoot, 'tests', 'core', 'strategy.test.ts'), "import { strategy } from '#core/strategy'\nimport { ethereum } from '#ethereum'\nvoid strategy\nvoid ethereum\n")
			const expected = [
				{
					command: 'cd bots/open-oracle-arbitrager && bun test tests/core/strategy.test.ts',
					reason: 'imports changed production source directly or transitively',
				},
			]

			expect(await getImportGraphTestRecommendations(['bots/open-oracle-arbitrager/src/core/strategy.ts'], repositoryRoot)).toEqual(expected)
			expect(await getImportGraphTestRecommendations(['bots/open-oracle-arbitrager/src/infrastructure/ethereum.ts'], repositoryRoot)).toEqual(expected)
			await writeFile(join(packageRoot, 'src', 'core', 'strategy-renamed.ts'), 'export const strategy = 1\n')
			await writeFile(join(packageRoot, 'tests', 'core', 'strategy.test.ts'), "import { strategy } from '#core/strategy-renamed'\nvoid strategy\n")
			expect(
				await getImportGraphTestRecommendations([{ path: 'bots/open-oracle-arbitrager/src/core/strategy-renamed.ts', previousPath: 'bots/open-oracle-arbitrager/src/core/strategy.ts', status: 'renamed' }], repositoryRoot, {
					baselinePackageImports: new Map([['bots/open-oracle-arbitrager', new Map([['#core/*', './src/core/*.ts']])]]),
					baselineSources: new Map([
						['bots/open-oracle-arbitrager/src/core/strategy.ts', 'export const strategy = 1\n'],
						['bots/open-oracle-arbitrager/tests/core/strategy.test.ts', "import { strategy } from '#core/strategy'\nvoid strategy\n"],
					]),
				}),
			).toEqual(expected)
		} finally {
			await rm(repositoryRoot, { recursive: true })
		}
	})

	test('uses baseline package import maps for deleted bot sources', async () => {
		const repositoryRoot = await mkdtemp(join(tmpdir(), 'test-impact-deleted-package-import-'))
		try {
			const packageRoot = join(repositoryRoot, 'bots', 'open-oracle-arbitrager')
			await mkdir(join(packageRoot, 'tests', 'core'), { recursive: true })
			await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ imports: { '#core/*': './src/core/*.ts' } }))
			await writeFile(join(packageRoot, 'tests', 'core', 'strategy.test.ts'), 'void 0\n')
			const baselineSources = new Map([
				['bots/open-oracle-arbitrager/src/core/strategy.ts', 'export const strategy = 1\n'],
				['bots/open-oracle-arbitrager/tests/core/strategy.test.ts', "import { strategy } from '#core/strategy'\nvoid strategy\n"],
			])
			const baselinePackageImports = new Map([['bots/open-oracle-arbitrager', new Map([['#core/*', './src/core/*.ts']])]])

			expect(await getImportGraphTestRecommendations([{ path: 'bots/open-oracle-arbitrager/src/core/strategy.ts', status: 'deleted' }], repositoryRoot, { baselinePackageImports, baselineSources })).toEqual([
				{
					command: 'cd bots/open-oracle-arbitrager && bun test tests/core/strategy.test.ts',
					reason: 'imports changed production source directly or transitively',
				},
			])
		} finally {
			await rm(repositoryRoot, { recursive: true })
		}
	})

	test('uses the baseline graph to find surviving tests affected by a deleted source', async () => {
		const repositoryRoot = await mkdtemp(join(tmpdir(), 'test-impact-deleted-'))
		try {
			await mkdir(join(repositoryRoot, 'shared', 'ts'), { recursive: true })
			await mkdir(join(repositoryRoot, 'ui', 'zoltar', 'ts', 'tests'), { recursive: true })
			await writeFile(join(repositoryRoot, 'shared', 'ts', 'replacement.ts'), 'export const value = 2\n')
			await writeFile(join(repositoryRoot, 'ui', 'zoltar', 'ts', 'tests', 'consumer.test.ts'), "import { value } from '@zoltar/shared/replacement'\nvoid value\n")
			const baselineSources = new Map([
				['shared/ts/deleted.ts', 'export const value = 1\n'],
				['shared/ts/consumer.ts', "export { value } from './deleted.js'\n"],
				['ui/zoltar/ts/tests/consumer.test.ts', "import { value } from '@zoltar/shared/consumer'\nvoid value\n"],
			])

			expect(await getImportGraphTestRecommendations([{ path: 'shared/ts/deleted.ts', status: 'deleted' }], repositoryRoot, { baselineSources })).toEqual([
				{
					command: 'bun test --preload ./bun-test-setup-ui.ts --timeout 300000 ui/zoltar/ts/tests/consumer.test.ts',
					reason: 'imports changed production source directly or transitively',
				},
			])
		} finally {
			await rm(repositoryRoot, { recursive: true })
		}
	})

	test('reads deleted-source imports from the merge base when origin main has diverged', async () => {
		const repositoryRoot = await mkdtemp(join(tmpdir(), 'test-impact-diverged-baseline-'))
		const git = (args: string[]) => execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' }).trim()
		try {
			await mkdir(join(repositoryRoot, 'pkg'), { recursive: true })
			git(['init'])
			git(['config', 'user.email', 'tests@example.com'])
			git(['config', 'user.name', 'Test Runner'])
			await writeFile(join(repositoryRoot, 'pkg', 'source.ts'), 'export const value = 1\n')
			await writeFile(join(repositoryRoot, 'pkg', 'source.test.ts'), "import { value } from './source.js'\nvoid value\n")
			git(['add', '.'])
			git(['commit', '-m', 'merge base'])
			git(['branch', 'feature'])
			git(['checkout', '-b', 'upstream-main'])
			await writeFile(join(repositoryRoot, 'pkg', 'source.test.ts'), 'void 0\n')
			git(['add', '.'])
			git(['commit', '-m', 'upstream removes import'])
			git(['update-ref', 'refs/remotes/origin/main', 'HEAD'])
			git(['checkout', 'feature'])
			git(['rm', 'pkg/source.ts'])
			git(['commit', '-m', 'feature deletes source'])

			expect(await getImportGraphTestRecommendations([{ path: 'pkg/source.ts', status: 'deleted' }], repositoryRoot)).toEqual([{ command: 'bun test pkg/source.test.ts', reason: 'imports changed production source directly or transitively' }])
		} finally {
			await rm(repositoryRoot, { recursive: true })
		}
	})
})
