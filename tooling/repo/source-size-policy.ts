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
 */
export const sourceSizeAllowances = new Map<string, SourceSizeAllowance>([
	...allowances('Chaos: extract dashboard features, operation handlers, and persistence responsibilities into focused modules.', [
		['bots/chaos/src/dashboard/dashboard.ts', 1681],
		['bots/chaos/src/monitoring/discovery.ts', 1020],
		['bots/chaos/src/operations/trading.ts', 1726],
		['bots/chaos/src/state/operator-state.ts', 1162],
		['bots/chaos/src/runtime/operator.ts', 895],
		['bots/chaos/src/monitoring/topology-cache.ts', 1043],
		['bots/chaos/src/dashboard/dashboard-server.ts', 989],
		['bots/chaos/src/state/protocol-index-store.ts', 1000],
		['bots/chaos/src/operations/open-oracle.ts', 1024],
		['bots/chaos/src/execution/recovery.ts', 643],
		['bots/chaos/src/monitoring/protocol-index.ts', 699],
		['bots/chaos/src/operations/zoltar.ts', 618],
	]),
	...allowances('Owning bot package: extract dashboard controllers, runtime orchestration, and journal persistence into focused modules.', [
		['bots/open-oracle-arbitrager/src/dashboard/dashboard.ts', 1233],
		['bots/open-oracle-arbitrager/src/runtime/operator.ts', 985],
		['bots/open-oracle-arbitrager/src/state/position-store.ts', 631],
		['bots/liquidator/src/dashboard/dashboard.ts', 987],
		['bots/liquidator/src/cli/run.ts', 741],
		['bots/liquidator/src/state/operator-state.ts', 661],
	]),
	...allowances('Owning UI library: separate workflow state and actions from rendering, and extract simulation scenario handlers.', [
		['ui/coreShared/ts/simulation/tevmEngine.ts', 876],
		['ui/statoblastShared/ts/protocol/securityPools.ts', 726],
		['ui/coreShared/ts/components/SimulationBanner.tsx', 686],
		['ui/coreShared/ts/app/hooks/useOnchainState.ts', 609],
		['ui/statoblastShared/ts/features/open-oracle/lib/openOracle.ts', 682],
		['ui/statoblastShared/ts/simulation/statoblastScenarios.ts', 638],
		['ui/statoblastShared/ts/features/security-pools/hooks/useSecurityPoolsOverview.ts', 659],
	]),
	...allowances('The AugurScan browser bundle and its live-update module still need feature-level decomposition.', [
		['augurScan/browser/app.ts', 3920],
		['augurScan/browser/live-update.ts', 1096],
	]),
	...allowances('Bot QA and documentation capture scripts grew with every dashboard surface they exercise.', [
		['bots/open-oracle-arbitrager/scripts/capture-docs-screenshots.mts', 1899],
		['bots/chaos/scripts/capture-dashboard-qa.mts', 947],
	]),
	...allowances('Repository tooling modules accumulated responsibilities that belong in separate modules.', [
		['tooling/docs/contract-reference-metadata.mts', 1814],
		['tooling/ui/dev-server.ts', 1116],
		['tooling/docs/check-docs-examples.mts', 1076],
		['tooling/testing/coverage-report.mts', 940],
		['tooling/ui/watch.mts', 829],
		['tooling/docs/check-docs-reference-values.mts', 836],
		['tooling/contracts/deploy-testnet.mts', 674],
		['tooling/docs/generate-contract-interaction-reference.mts', 634],
	]),
	...allowances('Documentation runtime bundles and Solidity-side TypeScript utilities still need responsibility extraction.', [
		['docs/charts/chartRuntime.ts', 1111],
		['docs/runtime/interactiveTools.ts', 616],
		['solidity/ts/testSupport/coverage/traceToSource.ts', 965],
		['solidity/ts/gas-costs.ts', 724],
		['solidity/ts/testSupport/simulator/AnvilWindowEthereum.ts', 623],
	]),
	...allowances('The arbitrage executor contract bundles routing, settlement, and recovery paths that belong in libraries.', [['bots/open-oracle-arbitrager/contracts/OpenOracleArbitrageExecutor.sol', 771]]),
	...allowances('SecurityPool delegate extraction is ongoing and bytecode-sensitive.', [
		['solidity/contracts/statoblast/SecurityPool.sol', 757],
		['solidity/contracts/statoblast/SecurityPoolForker.sol', 677],
		['solidity/contracts/statoblast/OpenOraclePriceCoordinator.sol', 647],
	]),
])
