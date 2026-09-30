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
		['bots/chaos/src/monitoring/discovery.ts', 1011],
		['bots/chaos/src/state/operator-state.ts', 1117],
		['bots/chaos/src/monitoring/topology-cache.ts', 941],
		['bots/chaos/src/dashboard/dashboard-server.ts', 965],
		['bots/chaos/src/state/protocol-index-store.ts', 900],
		['bots/chaos/src/operations/open-oracle.ts', 1024],
		['bots/chaos/src/execution/recovery.ts', 644],
		['bots/chaos/src/monitoring/protocol-index.ts', 691],
	]),
	...allowances('Owning bot package: extract dashboard controllers, runtime orchestration, and journal persistence into focused modules.', [
		['bots/open-oracle-arbitrager/src/dashboard/dashboard.ts', 1150],
		['bots/liquidator/src/dashboard/dashboard.ts', 864],
		['bots/liquidator/src/state/operator-state.ts', 630],
	]),
	...allowances('Owning UI library: separate workflow state and actions from rendering, and extract simulation scenario handlers.', [
		['ui/coreShared/ts/simulation/tevmEngine.ts', 777],
		['ui/statoblastShared/ts/protocol/oracleCoordinator.ts', 601],
		['ui/statoblastShared/ts/protocol/securityPools.ts', 725],
		['ui/coreShared/ts/app/hooks/useOnchainState.ts', 605],
	]),
	...allowances('The AugurScan browser bundle and its live-update module still need feature-level decomposition.', [
		['augurScan/browser/live-update.ts', 1096],
	]),
	...allowances('Bot QA and documentation capture scripts grew with every dashboard surface they exercise.', [
		['bots/open-oracle-arbitrager/scripts/capture-docs-screenshots.mts', 1871],
		['bots/chaos/scripts/capture-dashboard-qa.mts', 884],
	]),
	...allowances('Repository tooling modules accumulated responsibilities that belong in separate modules.', [
		['tooling/docs/contract-reference-metadata.mts', 1463],
		['tooling/ui/dev-server.ts', 1116],
		['tooling/docs/check-docs-examples.mts', 1076],
		['tooling/testing/coverage-report.mts', 931],
		['tooling/docs/check-docs-reference-values.mts', 825],
		['tooling/ui/watch.mts', 781],
		['tooling/contracts/deploy-testnet.mts', 671],
	]),
	...allowances('Documentation runtime bundles and Solidity-side TypeScript utilities still need responsibility extraction.', [
		['docs/charts/chartRuntime.ts', 1111],
		['solidity/ts/testSupport/coverage/traceToSource.ts', 965],
		['solidity/ts/gas-costs.ts', 714],
		['solidity/ts/testSupport/simulator/AnvilWindowEthereum.ts', 623],
	]),
	...allowances('The arbitrage executor contract bundles routing, settlement, and recovery paths that belong in libraries.', [['bots/open-oracle-arbitrager/contracts/OpenOracleArbitrageExecutor.sol', 771]]),
	...allowances('SecurityPool delegate extraction is ongoing and bytecode-sensitive.', [
		['solidity/contracts/statoblast/SecurityPool.sol', 783],
		['solidity/contracts/statoblast/SecurityPoolForker.sol', 682],
		['solidity/contracts/statoblast/OpenOraclePriceCoordinator.sol', 679],
	]),
])
