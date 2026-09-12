export const productionSourceLineLimit = 600

export type SourceSizeAllowance = {
	readonly maxLines: number
	readonly reason: string
}

const allowances = (reason: string, entries: readonly (readonly [path: string, maxLines: number])[]): readonly (readonly [string, SourceSizeAllowance])[] => entries.map(([path, maxLines]) => [path, { maxLines, reason }])

/**
 * Temporary debt register. The per-file ceiling prevents growth; remove an
 * entry as soon as its owner decomposes the module below the global limit.
 */
export const sourceSizeAllowances = new Map<string, SourceSizeAllowance>([
	...allowances('Existing Chaos modules remain temporary responsibility debt; their reviewed ceilings prohibit further growth.', [
		['bots/chaos/src/operations/statoblast.ts', 2616],
		['bots/chaos/src/dashboard/dashboard.ts', 2380],
		['bots/chaos/src/monitoring/discovery.ts', 1021],
		['bots/chaos/src/operations/trading.ts', 1769],
		['bots/chaos/src/state/operator-state.ts', 1199],
		['bots/chaos/src/execution/transaction-executor.ts', 1288],
		['bots/chaos/src/runtime/operator.ts', 934],
		['bots/chaos/src/monitoring/topology-cache.ts', 1063],
		['bots/chaos/src/dashboard/dashboard-server.ts', 1044],
		['bots/chaos/src/state/protocol-index-store.ts', 1027],
		['bots/chaos/src/operations/open-oracle.ts', 1028],
		['bots/chaos/src/execution/recovery.ts', 733],
		['bots/chaos/src/monitoring/protocol-index.ts', 702],
		['bots/chaos/src/operations/zoltar.ts', 619],
	]),
	...allowances('Existing bot dashboard/runtime debt is outside this lane.', [
		['bots/open-oracle-arbitrager/src/dashboard/dashboard.ts', 1731],
		['bots/open-oracle-arbitrager/src/runtime/operator.ts', 1064],
		['bots/open-oracle-arbitrager/src/state/operator-state.ts', 977],
		['bots/open-oracle-arbitrager/src/runtime/operator-control-plane.ts', 602],
		['bots/open-oracle-arbitrager/src/state/position-store.ts', 631],
		['bots/liquidator/src/dashboard/dashboard.ts', 1705],
		['bots/liquidator/src/cli/run.ts', 779],
		['bots/liquidator/src/state/operator-state.ts', 731],
	]),
	...allowances('Runtime-neutral EVM compatibility code still needs responsibility extraction.', [['shared/core/ts/evm/ethereum.ts', 2742]]),
	...allowances('Existing UI workflow debt is owned by the functional or visual lanes.', [
		['ui/statoblastShared/ts/features/security-pools/components/SecurityPoolWorkflowSection.tsx', 987],
		['ui/statoblastShared/ts/features/truth-auctions/components/ForkAuctionSection.tsx', 1070],
		['ui/coreShared/ts/simulation/tevmEngine.ts', 876],
		['ui/statoblastShared/ts/protocol/securityPools.ts', 837],
		['ui/coreShared/ts/components/SimulationBanner.tsx', 696],
		['ui/statoblastShared/ts/features/security-pools/components/SecurityVaultSection.tsx', 757],
		['ui/statoblastShared/ts/features/reporting/components/ReportingSection.tsx', 751],
		['ui/statoblastShared/ts/features/security-pools/components/LiquidationModal.tsx', 701],
		['ui/coreShared/ts/app/hooks/useOnchainState.ts', 633],
		['ui/statoblastShared/ts/features/open-oracle/lib/openOracle.ts', 682],
		['ui/statoblastShared/ts/simulation/statoblastScenarios.ts', 644],
		['ui/statoblastShared/ts/features/security-pools/hooks/useSecurityPoolsOverview.ts', 659],
		['ui/coreShared/ts/types/contracts.ts', 601],
	]),
	...allowances('The AugurScan browser bundle and its live-update module still need feature-level decomposition.', [
		['augurScan/browser/app.ts', 8056],
		['augurScan/browser/live-update.ts', 1096],
	]),
	...allowances('Bot QA and documentation capture scripts grew with every dashboard surface they exercise.', [
		['bots/open-oracle-arbitrager/scripts/capture-docs-screenshots.mts', 1913],
		['bots/chaos/scripts/capture-dashboard-qa.mts', 973],
	]),
	...allowances('Repository tooling modules accumulated responsibilities that belong in separate modules.', [
		['tooling/docs/contract-reference-metadata.mts', 1910],
		['tooling/ui/dev-server.ts', 1116],
		['tooling/docs/check-docs-examples.mts', 1076],
		['tooling/testing/coverage-report.mts', 945],
		['tooling/ui/watch.mts', 845],
		['tooling/docs/check-docs-reference-values.mts', 844],
		['tooling/contracts/deploy-testnet.mts', 747],
		['tooling/docs/generate-contract-interaction-reference.mts', 678],
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
		['solidity/contracts/statoblast/SecurityPool.sol', 802],
		['solidity/contracts/statoblast/SecurityPoolForker.sol', 685],
		['solidity/contracts/statoblast/OpenOraclePriceCoordinator.sol', 692],
	]),
])
