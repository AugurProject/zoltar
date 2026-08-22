import { getChangedFiles } from './changed-files.mts'

export type TestImpactRecommendation = {
	command: string
	reason: string
}

type TestImpactRule = TestImpactRecommendation & {
	matches: (filePath: string) => boolean
}

const TEST_INFRASTRUCTURE_PATHS = new Set([
	'bun-test-setup-solidity.ts',
	'bun-test-setup-ui.ts',
	'bunfig.toml',
	'scripts/merge-test-timings.mts',
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
		command: 'bun test scripts/test-discovery.test.ts scripts/run-tests.test.ts scripts/test-impact.test.ts',
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
		matches: filePath => filePath === '.github/workflows/ci.yml' || filePath === '.github/workflows/browser-workflow.yml' || filePath === '.github/workflows/coverage.yml',
	},
	{
		command: 'bun run test:browser:smoke',
		reason: 'production build or browser smoke behavior changed',
		matches: filePath => filePath === 'ui/coreShared/build/productionBuild.test.ts' || filePath === 'ui/coreShared/build/production.mts' || filePath === 'ui/coreShared/build/appPaths.mts',
	},
	{
		command: 'bun run test:browser:workflow',
		reason: 'production browser workflow coverage changed',
		matches: filePath => filePath === 'ui/coreShared/build/productionBuild.test.ts',
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

export function getTestImpactRecommendations(changedFiles: readonly string[]) {
	const recommendations = new Map<string, TestImpactRecommendation>()
	for (const filePath of changedFiles) {
		const matchingRules = TEST_IMPACT_RULES.filter(rule => rule.matches(filePath))
		if (matchingRules.length === 0) {
			const directCommand = directTestCommand(filePath)
			if (directCommand !== undefined) recommendations.set(directCommand, { command: directCommand, reason: `changed test: ${filePath}` })
		}
		for (const rule of matchingRules) recommendations.set(rule.command, { command: rule.command, reason: rule.reason })
	}
	return [...recommendations.values()].sort((left, right) => left.command.localeCompare(right.command))
}

if (import.meta.main) {
	const changedFiles = getChangedFiles()
	const recommendations = getTestImpactRecommendations(changedFiles)
	if (recommendations.length === 0) {
		console.log('No static test-impact mapping matched. Trace changed imports, ownership, interfaces, and consumers using AGENTS.md.')
	} else {
		console.log('Suggested starting checks; confirm affected imports and consumers before running:')
		for (const recommendation of recommendations) console.log(`- ${recommendation.command}\n  ${recommendation.reason}`)
	}
}
