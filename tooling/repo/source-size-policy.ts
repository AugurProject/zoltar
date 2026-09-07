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
	...allowances('AugurScan decomposition is owned by Lane B.', [
		['augurScan/src/indexer.ts', 1840],
		['augurScan/src/database.ts', 1673],
		['augurScan/src/projections.ts', 701],
	]),
	...allowances('Chaos retirement work will split this existing orchestration debt.', [
		['bots/chaos/src/monitoring/carry-proof-journal.ts', 3668],
		['bots/chaos/src/operations/statoblast.ts', 2616],
		['bots/chaos/src/dashboard/dashboard.ts', 2380],
		['bots/chaos/src/monitoring/discovery.ts', 1845],
		['bots/chaos/src/operations/trading.ts', 1769],
		['bots/chaos/src/contracts/abi.ts', 1668],
		['bots/chaos/src/monitoring/carry-proof-index.ts', 1596],
		['bots/chaos/src/state/operator-state.ts', 1352],
		['bots/chaos/src/execution/transaction-executor.ts', 1315],
		['bots/chaos/src/runtime/operator.ts', 1107],
		['bots/chaos/src/monitoring/topology-cache.ts', 1065],
		['bots/chaos/src/dashboard/dashboard-server.ts', 1052],
		['bots/chaos/src/state/protocol-index-store.ts', 1030],
		['bots/chaos/src/operations/open-oracle.ts', 1028],
		['bots/chaos/src/runtime/dashboard-controller.ts', 923],
		['bots/chaos/src/monitoring/carry-proof-scan.ts', 859],
		['bots/chaos/src/execution/recovery.ts', 798],
		['bots/chaos/src/monitoring/protocol-index.ts', 716],
		['bots/chaos/src/config/settings.ts', 685],
		['bots/chaos/src/runtime/canonical-scan.ts', 651],
		['bots/chaos/src/operations/types.ts', 625],
		['bots/chaos/src/operations/zoltar.ts', 619],
	]),
	...allowances('Existing bot dashboard/runtime debt is outside this lane.', [
		['bots/open-oracle-arbitrager/src/dashboard/dashboard.ts', 1720],
		['bots/open-oracle-arbitrager/src/runtime/operator.ts', 1079],
		['bots/open-oracle-arbitrager/src/state/operator-state.ts', 1038],
		['bots/open-oracle-arbitrager/src/runtime/operator-control-plane.ts', 700],
		['bots/open-oracle-arbitrager/src/state/position-store.ts', 635],
		['bots/liquidator/src/dashboard/dashboard.ts', 1690],
		['bots/liquidator/src/cli/run.ts', 777],
		['bots/liquidator/src/state/operator-state.ts', 731],
		['bots/liquidator/src/execution/liquidation-executor.ts', 614],
	]),
	...allowances('Runtime-neutral EVM code is scheduled for domain extraction.', [['shared/ts/ethereum.ts', 2742]]),
	...allowances('Existing UI workflow debt is owned by the functional or visual lanes.', [
		['ui/statoblast/ts/features/security-pools/components/SecurityPoolWorkflowSection.tsx', 987],
		['ui/statoblast/ts/features/truth-auctions/components/ForkAuctionSection.tsx', 980],
		['ui/trading/ts/features/liveTradingController.ts', 967],
		['ui/zoltar/ts/protocol/openOracle.ts', 954],
		['ui/zoltar/ts/protocol/reporting.ts', 932],
		['ui/coreShared/ts/simulation/tevmEngine.ts', 876],
		['ui/zoltar/ts/features/open-oracle/hooks/useOpenOracleOperations.ts', 832],
		['ui/statoblast/ts/protocol/securityPools.ts', 829],
		['ui/trading/ts/protocol/live.ts', 793],
		['ui/statoblast/ts/app/App.tsx', 760],
		['ui/coreShared/ts/components/SimulationBanner.tsx', 758],
		['ui/statoblast/ts/features/security-pools/components/SecurityVaultSection.tsx', 757],
		['ui/zoltar/ts/features/reporting/components/ReportingSection.tsx', 750],
		['ui/statoblast/ts/features/security-pools/components/LiquidationModal.tsx', 701],
		['ui/coreShared/ts/app/hooks/useOnchainState.ts', 690],
		['ui/zoltar/ts/features/open-oracle/lib/openOracle.ts', 684],
		['ui/statoblast/ts/simulation/statoblastScenarios.ts', 682],
		['ui/statoblast/ts/features/security-pools/hooks/useSecurityPoolsOverview.ts', 676],
		['ui/coreShared/ts/types/contracts.ts', 611],
		['ui/trading/ts/features/LiveTrading.tsx', 609],
	]),
	...allowances('SecurityPool delegate extraction is ongoing and bytecode-sensitive.', [
		['solidity/contracts/statoblast/SecurityPool.sol', 802],
		['solidity/contracts/statoblast/SecurityPoolForker.sol', 685],
		['solidity/contracts/statoblast/OpenOraclePriceCoordinator.sol', 683],
	]),
])
