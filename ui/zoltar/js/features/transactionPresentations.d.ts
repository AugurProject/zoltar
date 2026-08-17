import type { Hash } from '@zoltar/shared/ethereum';
import type { MarketCreationResult, OpenOracleActionResult, ReportingActionResult, ZoltarChildUniverseActionResult, ZoltarForkActionResult, ZoltarMigrationActionResult } from '@zoltar/ui-core-shared/types/contracts.js';
export declare function createDeploymentTransactionIntent(stepLabel: string): any;
export declare function createDeploymentSuccessPresentation(stepLabel: string, hash: Hash): any;
type MarketCreationTransactionContext = {
    marketType: MarketCreationResult['marketType'];
    title?: string | undefined;
    universeId?: bigint | undefined;
};
export declare function createMarketCreationTransactionIntent(context: MarketCreationTransactionContext): any;
export declare function createMarketCreationSuccessPresentation(result: MarketCreationResult, context?: Omit<MarketCreationTransactionContext, 'marketType'>): any;
export declare function createMarketCreationWarningPresentation(result: MarketCreationResult, message: string, context?: Omit<MarketCreationTransactionContext, 'marketType'>): any;
type QuestionUniverseTransactionContext = {
    questionId?: string | undefined;
    universeId?: bigint | undefined;
};
export declare function createZoltarForkTransactionIntent(actionName: 'approve' | 'fork', context?: QuestionUniverseTransactionContext): any;
export declare function createZoltarForkSuccessPresentation(result: ZoltarForkActionResult): any;
export declare function createZoltarForkWarningPresentation(result: ZoltarForkActionResult, message: string): any;
type ChildUniverseTransactionContext = {
    outcomeIndex?: bigint | undefined;
    universeId?: bigint | undefined;
};
export declare function createChildUniverseTransactionIntent(source: 'fork-auction' | 'zoltar', context?: ChildUniverseTransactionContext): any;
export declare function createChildUniverseSuccessPresentation(result: ZoltarChildUniverseActionResult): any;
export declare function createChildUniverseWarningPresentation(result: ZoltarChildUniverseActionResult, message: string): any;
type ZoltarMigrationTransactionContext = {
    amount?: string | undefined;
    outcomeIndexes?: string | undefined;
    universeId?: bigint | undefined;
};
export declare function createZoltarMigrationTransactionIntent(actionName: 'prepare' | 'split', context?: ZoltarMigrationTransactionContext): any;
export declare function createZoltarMigrationSuccessPresentation(result: ZoltarMigrationActionResult): any;
export declare function createZoltarMigrationWarningPresentation(result: ZoltarMigrationActionResult, message: string): any;
type PoolUniverseTransactionContext = {
    securityPoolAddress?: string | undefined;
    universeId?: bigint | undefined;
};
type ReportingTransactionContext = PoolUniverseTransactionContext & {
    outcome?: ReportingActionResult['outcome'] | undefined;
};
export declare function createReportingTransactionIntent(actionName: ReportingActionResult['action'], context?: ReportingTransactionContext): any;
export declare function createReportingSuccessPresentation(result: ReportingActionResult): any;
export declare function createReportingWarningPresentation(result: ReportingActionResult, message: string): any;
type PoolOracleTransactionContext = {
    managerAddress: string;
    securityPoolAddress?: string | undefined;
};
export declare function createPoolOracleTransactionIntent(actionName: 'executeStagedOperation' | 'requestPrice', context?: PoolOracleTransactionContext): any;
export declare function createPoolOracleSuccessPresentation(result: OpenOracleActionResult, context?: PoolOracleTransactionContext): any;
export declare function createPoolOracleWarningPresentation(result: OpenOracleActionResult, message: string, context?: PoolOracleTransactionContext): any;
type OpenOracleTransactionContext = {
    openOracleAddress?: string | undefined;
    reportId?: string | undefined;
    token1Symbol?: string | undefined;
    token2Symbol?: string | undefined;
    tokenPair?: string | undefined;
    withdrawalTokenSymbol?: string | undefined;
};
export declare function createOpenOracleTransactionIntent(actionName: OpenOracleActionResult['action'], context?: OpenOracleTransactionContext): any;
export declare function createOpenOracleSuccessPresentation(result: OpenOracleActionResult, context?: OpenOracleTransactionContext): any;
export declare function createOpenOracleWarningPresentation(result: OpenOracleActionResult, message: string, context?: OpenOracleTransactionContext): any;
export {};
//# sourceMappingURL=transactionPresentations.d.ts.map