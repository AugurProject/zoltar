import type { TransactionIntent } from '@zoltar/ui-core-shared/types/components.js';
import type { ForkAuctionActionResult, ReportingActionResult, SecurityPoolCreationResult, SecurityPoolOverviewActionResult, SecurityVaultActionResult, TradingActionResult } from '@zoltar/ui-core-shared/types/contracts.js';
type PoolUniverseTransactionContext = {
    securityPoolAddress?: string | undefined;
    universeId?: bigint | undefined;
};
type SecurityPoolCreationTransactionContext = {
    initialReportPriorityFeeGwei?: string | undefined;
    questionId?: string | undefined;
    statoblastSecurityMultiplierBps?: bigint | undefined;
};
export declare function createSecurityPoolCreationTransactionIntent(context?: SecurityPoolCreationTransactionContext): TransactionIntent;
export declare function createSecurityPoolCreationSuccessPresentation(result: SecurityPoolCreationResult): import("@zoltar/ui-core-shared/types/components.js").GlobalTransactionPresentation;
export declare function createSecurityPoolCreationWarningPresentation(result: SecurityPoolCreationResult, message: string): import("@zoltar/ui-core-shared/types/components.js").GlobalTransactionPresentation;
type SecurityVaultTransactionContext = {
    securityPoolAddress?: string | undefined;
    vaultAddress?: string | undefined;
};
export declare function createSecurityVaultTransactionIntent(actionName: SecurityVaultActionResult['action'], context?: SecurityVaultTransactionContext): TransactionIntent;
export declare function createSecurityVaultSuccessPresentation(result: SecurityVaultActionResult, context?: SecurityVaultTransactionContext): import("@zoltar/ui-core-shared/types/components.js").GlobalTransactionPresentation;
export declare function createSecurityVaultWarningPresentation(result: SecurityVaultActionResult, message: string, context?: SecurityVaultTransactionContext): import("@zoltar/ui-core-shared/types/components.js").GlobalTransactionPresentation;
type TradingTransactionContext = PoolUniverseTransactionContext & {
    shareOutcome?: ReportingActionResult['outcome'] | undefined;
};
export declare function createTradingTransactionIntent(actionName: TradingActionResult['action'], context?: TradingTransactionContext): TransactionIntent;
export declare function createTradingSuccessPresentation(result: TradingActionResult): import("@zoltar/ui-core-shared/types/components.js").GlobalTransactionPresentation;
export declare function createTradingWarningPresentation(result: TradingActionResult, message: string): import("@zoltar/ui-core-shared/types/components.js").GlobalTransactionPresentation;
type LiquidationTransactionContext = PoolUniverseTransactionContext & {
    amount?: string | undefined;
    targetVault?: string | undefined;
};
export declare function createLiquidationTransactionIntent(context?: LiquidationTransactionContext): TransactionIntent;
export declare function createLiquidationSuccessPresentation(result: SecurityPoolOverviewActionResult, context?: LiquidationTransactionContext): import("@zoltar/ui-core-shared/types/components.js").GlobalTransactionPresentation;
export declare function createLiquidationFailurePresentation(result: SecurityPoolOverviewActionResult, detail: string, context?: LiquidationTransactionContext): import("@zoltar/ui-core-shared/types/components.js").GlobalTransactionPresentation;
export declare function createLiquidationWarningPresentation(result: SecurityPoolOverviewActionResult, message: string, context?: LiquidationTransactionContext): import("@zoltar/ui-core-shared/types/components.js").GlobalTransactionPresentation;
export declare function createForkAuctionTransactionIntent(actionName: ForkAuctionActionResult['action'], { context, submittedTitle }?: {
    context?: PoolUniverseTransactionContext;
    submittedTitle?: TransactionIntent['submittedTitle'];
}): TransactionIntent;
export declare function createForkAuctionSuccessPresentation(result: ForkAuctionActionResult): import("@zoltar/ui-core-shared/types/components.js").GlobalTransactionPresentation;
export declare function createForkAuctionWarningPresentation(result: ForkAuctionActionResult, message: string): import("@zoltar/ui-core-shared/types/components.js").GlobalTransactionPresentation;
export { createDeploymentSuccessPresentation, createDeploymentTransactionIntent, createMarketCreationSuccessPresentation, createMarketCreationTransactionIntent, createMarketCreationWarningPresentation, createOpenOracleSuccessPresentation, createOpenOracleTransactionIntent, createOpenOracleWarningPresentation, createPoolOracleSuccessPresentation, createPoolOracleTransactionIntent, createPoolOracleWarningPresentation, createReportingSuccessPresentation, createReportingTransactionIntent, createReportingWarningPresentation, createChildUniverseSuccessPresentation, createChildUniverseTransactionIntent, createChildUniverseWarningPresentation, createZoltarForkSuccessPresentation, createZoltarForkTransactionIntent, createZoltarForkWarningPresentation, createZoltarMigrationSuccessPresentation, createZoltarMigrationTransactionIntent, createZoltarMigrationWarningPresentation, } from '@zoltar/ui-zoltar/features/transactionPresentations.js';
//# sourceMappingURL=transactionPresentations.d.ts.map