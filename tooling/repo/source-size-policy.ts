export const productionSourceLineLimit = 600

export type SourceSizeAllowance = {
	readonly maxLines: number
	readonly reason: string
}

const allowances = (reason: string, entries: readonly (readonly [path: string, maxLines: number])[]): readonly (readonly [string, SourceSizeAllowance])[] => entries.map(([path, maxLines]) => [path, { maxLines, reason }])

/**
 * Temporary debt register, owned by each file's package or tooling area.
 * Ceilings must match current line counts and ratchet down after every shrink.
 * Remove an entry once responsibility extraction brings it to 600 lines or less.
 * Solidity line counts exclude comment-only lines (NatSpec and plain comments) so documentation never counts toward a contract's allowance.
 */
export const sourceSizeAllowances = new Map<string, SourceSizeAllowance>([
	...allowances('Bot QA and documentation capture scripts grew with every dashboard surface they exercise.', [['bots/chaos/scripts/capture-dashboard-qa.mts', 884]]),
	...allowances('Documentation runtime bundles and Solidity-side TypeScript utilities still need responsibility extraction.', [
		['docs/charts/chartRuntime.ts', 874],
		['solidity/ts/testSupport/coverage/traceToSource.ts', 860],
		['solidity/ts/testSupport/simulator/AnvilWindowEthereum.ts', 606],
	]),
])

/**
 * Test files and their helpers get a wider ceiling than production modules: a scenario suite legitimately carries
 * more setup than the code it exercises, but a file past this size is several suites sharing one fixture block.
 */
export const testSourceLineLimit = 1500

/**
 * Temporary debt register for test sources, with the same rules as the production register above:
 * ceilings match current line counts, ratchet down after every shrink, and disappear at 1500 lines or less.
 */
export const testSourceSizeAllowances = new Map<string, SourceSizeAllowance>([
	...allowances('Split by behavior area into sibling test files that share a fixture module.', [
		['augurScan/tests/replay/indexer-lifecycle.test.ts', 3078],
		['bots/chaos/tests/execution/transaction-executor.test.ts', 1847],
		['bots/chaos/tests/monitoring/discovery.test.ts', 1628],
		['bots/chaos/tests/runtime/dashboard-controller.test.ts', 1655],
		['bots/liquidator/tests/dashboard/dashboard-refresh.test.ts', 2088],
		['bots/open-oracle-arbitrager/tests/dashboard/dashboard-refresh.test.ts', 1566],
		['shared/core/ts/evm/ethereum.test.ts', 3118],
		['solidity/ts/tests/coverageHelpers.test.ts', 1662],
		['ui/coreShared/ts/tests/app/useOnchainState.integration.test.tsx', 2160],
		['ui/openoracle/ts/tests/features/open-oracle/openOracleRouteSection.test.tsx', 1877],
		['ui/statoblast/ts/tests/features/open-oracle/useOpenOracleOperations.test.tsx', 2369],
		['ui/statoblast/ts/tests/features/reporting/reportingSection.test.tsx', 1626],
	]),
])
