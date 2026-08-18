import type { Hash } from '@zoltar/shared/ethereum';
import type { MarketCreationResult, OpenOracleActionResult, ReportingActionResult, ZoltarChildUniverseActionResult, ZoltarForkActionResult, ZoltarMigrationActionResult } from '@zoltar/ui-core-shared/types/contracts.js';
export declare function createDeploymentTransactionIntent(stepLabel: string): import("@zoltar/ui-core-shared/types/components.js").TransactionIntent;
export declare function createDeploymentSuccessPresentation(stepLabel: string, hash: Hash): import("@zoltar/ui-core-shared/types/components.js").GlobalTransactionPresentation;
type MarketCreationTransactionContext = {
    marketType: MarketCreationResult['marketType'];
    title?: string | undefined;
    universeId?: bigint | undefined;
};
export declare function createMarketCreationTransactionIntent(context: MarketCreationTransactionContext): import("@zoltar/ui-core-shared/types/components.js").TransactionIntent;
export declare function createMarketCreationSuccessPresentation(result: MarketCreationResult, context?: Omit<MarketCreationTransactionContext, 'marketType'>): import("@zoltar/ui-core-shared/types/components.js").GlobalTransactionPresentation;
export declare function createMarketCreationWarningPresentation(result: MarketCreationResult, message: string, context?: Omit<MarketCreationTransactionContext, 'marketType'>): import("@zoltar/ui-core-shared/types/components.js").GlobalTransactionPresentation;
type QuestionUniverseTransactionContext = {
    questionId?: string | undefined;
    universeId?: bigint | undefined;
};
export declare function createZoltarForkTransactionIntent(actionName: 'approve' | 'fork', context?: QuestionUniverseTransactionContext): import("@zoltar/ui-core-shared/types/components.js").TransactionIntent;
export declare function createZoltarForkSuccessPresentation(result: ZoltarForkActionResult): import("@zoltar/ui-core-shared/types/components.js").GlobalTransactionPresentation;
export declare function createZoltarForkWarningPresentation(result: ZoltarForkActionResult, message: string): import("@zoltar/ui-core-shared/types/components.js").GlobalTransactionPresentation;
type ChildUniverseTransactionContext = {
    outcomeIndex?: bigint | undefined;
    universeId?: bigint | undefined;
};
export declare function createChildUniverseTransactionIntent(source: 'fork-auction' | 'zoltar', context?: ChildUniverseTransactionContext): import("@zoltar/ui-core-shared/types/components.js").TransactionIntent;
export declare function createChildUniverseSuccessPresentation(result: ZoltarChildUniverseActionResult): import("@zoltar/ui-core-shared/types/components.js").GlobalTransactionPresentation;
export declare function createChildUniverseWarningPresentation(result: ZoltarChildUniverseActionResult, message: string): import("@zoltar/ui-core-shared/types/components.js").GlobalTransactionPresentation;
type ZoltarMigrationTransactionContext = {
    amount?: string | undefined;
    outcomeIndexes?: string | undefined;
    universeId?: bigint | undefined;
};
export declare function createZoltarMigrationTransactionIntent(actionName: 'prepare' | 'split', context?: ZoltarMigrationTransactionContext): import("@zoltar/ui-core-shared/types/components.js").TransactionIntent;
export declare function createZoltarMigrationSuccessPresentation(result: ZoltarMigrationActionResult): import("@zoltar/ui-core-shared/types/components.js").GlobalTransactionPresentation;
export declare function createZoltarMigrationWarningPresentation(result: ZoltarMigrationActionResult, message: string): import("@zoltar/ui-core-shared/types/components.js").GlobalTransactionPresentation;
type PoolUniverseTransactionContext = {
    securityPoolAddress?: string | undefined;
    universeId?: bigint | undefined;
};
type ReportingTransactionContext = PoolUniverseTransactionContext & {
    outcome?: ReportingActionResult['outcome'] | undefined;
};
export declare function createReportingTransactionIntent(actionName: ReportingActionResult['action'], context?: ReportingTransactionContext): import("@zoltar/ui-core-shared/types/components.js").TransactionIntent;
export declare function createReportingSuccessPresentation(result: ReportingActionResult): import("@zoltar/ui-core-shared/types/components.js").GlobalTransactionPresentation;
export declare function createReportingWarningPresentation(result: ReportingActionResult, message: string): import("@zoltar/ui-core-shared/types/components.js").GlobalTransactionPresentation;
type PoolOracleTransactionContext = {
    managerAddress: string;
    securityPoolAddress?: string | undefined;
};
export declare function createPoolOracleTransactionIntent(actionName: 'executeStagedOperation' | 'requestPrice', context?: PoolOracleTransactionContext): import("@zoltar/ui-core-shared/types/components.js").TransactionIntent;
export declare function createPoolOracleSuccessPresentation(result: OpenOracleActionResult, context?: PoolOracleTransactionContext): import("@zoltar/ui-core-shared/types/components.js").GlobalTransactionPresentation;
export declare function createPoolOracleWarningPresentation(result: OpenOracleActionResult, message: string, context?: PoolOracleTransactionContext): import("@zoltar/ui-core-shared/types/components.js").GlobalTransactionPresentation;
type OpenOracleTransactionContext = {
    openOracleAddress?: string | undefined;
    reportId?: string | undefined;
    token1Symbol?: string | undefined;
    token2Symbol?: string | undefined;
    tokenPair?: string | undefined;
    withdrawalTokenSymbol?: string | undefined;
};
export declare function createOpenOracleTransactionIntent(actionName: OpenOracleActionResult['action'], context?: OpenOracleTransactionContext): import("@zoltar/ui-core-shared/types/components.js").TransactionIntent;
export declare function createOpenOracleSuccessPresentation(result: OpenOracleActionResult, context?: OpenOracleTransactionContext): import("@zoltar/ui-core-shared/types/components.js").GlobalTransactionPresentation;
export declare function createOpenOracleWarningPresentation(result: OpenOracleActionResult, message: string, context?: OpenOracleTransactionContext): import("@zoltar/ui-core-shared/types/components.js").GlobalTransactionPresentation;
export {};
//# sourceMappingURL=transactionPresentations.d.ts.map