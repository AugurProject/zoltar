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
		['bots/chaos/src/monitoring/carry-proof-journal.ts', 3668],
		['bots/chaos/src/operations/statoblast.ts', 2616],
		['bots/chaos/src/dashboard/dashboard.ts', 2380],
		['bots/chaos/src/monitoring/discovery.ts', 1859],
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
		['bots/open-oracle-arbitrager/src/dashboard/dashboard.ts', 1731],
		['bots/open-oracle-arbitrager/src/runtime/operator.ts', 1079],
		['bots/open-oracle-arbitrager/src/state/operator-state.ts', 1038],
		['bots/open-oracle-arbitrager/src/runtime/operator-control-plane.ts', 700],
		['bots/open-oracle-arbitrager/src/state/position-store.ts', 635],
		['bots/liquidator/src/dashboard/dashboard.ts', 1705],
		['bots/liquidator/src/cli/run.ts', 777],
		['bots/liquidator/src/state/operator-state.ts', 731],
		['bots/liquidator/src/execution/liquidation-executor.ts', 614],
	]),
	...allowances('Runtime-neutral EVM compatibility code still needs responsibility extraction.', [['shared/ts/evm/ethereum.ts', 2742]]),
	...allowances('Existing UI workflow debt is owned by the functional or visual lanes.', [
		['ui/statoblastShared/ts/features/security-pools/components/SecurityPoolWorkflowSection.tsx', 987],
		['ui/statoblastShared/ts/features/truth-auctions/components/ForkAuctionSection.tsx', 1070],
		['ui/zoltarShared/ts/protocol/openOracle.ts', 954],
		['ui/zoltarShared/ts/protocol/reporting.ts', 932],
		['ui/coreShared/ts/simulation/tevmEngine.ts', 876],
		['ui/zoltarShared/ts/features/open-oracle/hooks/useOpenOracleOperations.ts', 831],
		['ui/statoblastShared/ts/protocol/securityPools.ts', 837],
		['ui/statoblast/ts/app/App.tsx', 762],
		['ui/coreShared/ts/components/SimulationBanner.tsx', 758],
		['ui/statoblastShared/ts/features/security-pools/components/SecurityVaultSection.tsx', 757],
		['ui/zoltarShared/ts/features/reporting/components/ReportingSection.tsx', 750],
		['ui/statoblastShared/ts/features/security-pools/components/LiquidationModal.tsx', 701],
		['ui/coreShared/ts/app/hooks/useOnchainState.ts', 690],
		['ui/zoltarShared/ts/features/open-oracle/lib/openOracle.ts', 685],
		['ui/statoblastShared/ts/simulation/statoblastScenarios.ts', 644],
		['ui/statoblastShared/ts/features/security-pools/hooks/useSecurityPoolsOverview.ts', 676],
		['ui/coreShared/ts/types/contracts.ts', 613],
	]),
	...allowances('SecurityPool delegate extraction is ongoing and bytecode-sensitive.', [
		['solidity/contracts/statoblast/SecurityPool.sol', 802],
		['solidity/contracts/statoblast/SecurityPoolForker.sol', 685],
		['solidity/contracts/statoblast/OpenOraclePriceCoordinator.sol', 692],
	]),
])
