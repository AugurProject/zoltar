import { describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getImportGraphTestRecommendations, getTestImpactRecommendations } from './test-impact.mts'

const commandsFor = (changedFiles: string[]) => getTestImpactRecommendations(changedFiles).map(recommendation => recommendation.command)

describe('test impact recommendations', () => {
	test('maps test infrastructure to its focused runner tests', () => {
		expect(commandsFor(['scripts/test-timings.mts'])).toEqual(['bun test scripts/mutation-support.test.ts scripts/test-discovery.test.ts scripts/run-tests.test.ts scripts/test-impact.test.ts'])
	})

	test('maps production browser coverage to both explicit tiers', () => {
		expect(commandsFor(['ui/coreShared/build/productionBuild.test.ts'])).toEqual(['bun run test:browser:smoke', 'bun run test:browser:workflow'])
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
})
