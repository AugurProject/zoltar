import { describe, expect, test } from 'bun:test'
import { getTestImpactRecommendations } from './test-impact.mts'

const commandsFor = (changedFiles: string[]) => getTestImpactRecommendations(changedFiles).map(recommendation => recommendation.command)

describe('test impact recommendations', () => {
	test('maps test infrastructure to its focused runner tests', () => {
		expect(commandsFor(['scripts/test-timings.mts'])).toEqual(['bun test scripts/test-discovery.test.ts scripts/run-tests.test.ts scripts/test-impact.test.ts'])
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
		expect(commandsFor(['scripts/test-discovery.mts', 'scripts/test-discovery.test.ts', 'scripts/test-impact.mts', 'scripts/test-impact.test.ts', 'scripts/test-timings.mts'])).toEqual(['bun test scripts/test-discovery.test.ts scripts/run-tests.test.ts scripts/test-impact.test.ts'])
	})

	test('maps CI workflow changes to workflow contract tests', () => {
		expect(commandsFor(['ci-proposals/workflows/browser-workflow.yml', 'ci-proposals/workflows/coverage.yml'])).toEqual(['bun test scripts/ui-split-workflows.test.ts'])
	})

	test('specialized external integration tiers replace ineffective raw test commands', () => {
		expect(commandsFor(['ui/zoltar/ts/tests/protocol/uniswapQuoter.integration.test.ts'])).toEqual(['bun run test:integration:mainnet'])
		expect(commandsFor(['ui/zoltar/ts/tests/protocol/uniswapQuoter.fork.test.ts'])).toEqual(['bun run test:integration:mainnet-fork'])
	})
})
