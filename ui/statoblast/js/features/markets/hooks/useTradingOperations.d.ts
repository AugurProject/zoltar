import type { Address } from '@zoltar/shared/ethereum';
import { createCompleteSetInSecurityPool, loadSecurityPoolMintCapacity, loadTradingDetails as loadTradingDetailsForPool, loadZoltarUniverseSummary, migrateSharesFromUniverse, redeemCompleteSetInSecurityPool, redeemSharesInSecurityPool } from '../../../protocol/index.js';
import { createWalletWriteClient } from '@zoltar/ui-core-shared/lib/clients.js';
import type { ActionFeedback } from '@zoltar/ui-core-shared/lib/actionFeedback.js';
import type { TradingFormState, WriteOperationsParameters } from '../../../types/app.js';
import type { DeploymentStatus, TradingActionResult, TradingDetails, ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js';
type UseTradingOperationsParameters = WriteOperationsParameters & {
    deploymentStatuses: DeploymentStatus[];
    enabled: boolean;
    selectedSecurityPoolAddress?: string;
};
export type UseTradingOperationsDependencies = {
    createCompleteSetInSecurityPool: (accountAddress: Address, callbacks: Parameters<typeof createWalletWriteClient>[1], securityPoolAddress: Address, amount: bigint) => ReturnType<typeof createCompleteSetInSecurityPool>;
    getWalletEthBalance: (walletAddress: Address) => Promise<bigint>;
    loadSecurityPoolMintCapacity: (securityPoolAddress: Address) => ReturnType<typeof loadSecurityPoolMintCapacity>;
    loadTradingDetails: (securityPoolAddress: Address, accountAddress: Address | undefined) => ReturnType<typeof loadTradingDetailsForPool>;
    loadZoltarUniverseSummary: (universeId: bigint) => ReturnType<typeof loadZoltarUniverseSummary>;
    migrateSharesFromUniverse: (accountAddress: Address, callbacks: Parameters<typeof createWalletWriteClient>[1], securityPoolAddress: Address, outcome: Parameters<typeof migrateSharesFromUniverse>[2], targetOutcomeIndexes: bigint[]) => ReturnType<typeof migrateSharesFromUniverse>;
    redeemCompleteSetInSecurityPool: (accountAddress: Address, callbacks: Parameters<typeof createWalletWriteClient>[1], securityPoolAddress: Address, amount: bigint) => ReturnType<typeof redeemCompleteSetInSecurityPool>;
    redeemSharesInSecurityPool: (accountAddress: Address, callbacks: Parameters<typeof createWalletWriteClient>[1], securityPoolAddress: Address) => ReturnType<typeof redeemSharesInSecurityPool>;
};
export declare function useTradingOperations({ accountAddress, deploymentStatuses, enabled, onTransactionCanceled, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted, refreshState, selectedSecurityPoolAddress }: UseTradingOperationsParameters, dependencies?: UseTradingOperationsDependencies): {
    createCompleteSet: () => Promise<void>;
    loadingTradingForkUniverse: boolean;
    loadingTradingDetails: boolean;
    migrateShares: () => Promise<void>;
    redeemCompleteSet: () => Promise<void>;
    redeemShares: () => Promise<void>;
    setTradingForm: (updater: (current: TradingFormState) => TradingFormState) => void;
    tradingDetails: TradingDetails | undefined;
    tradingActiveAction: "createCompleteSet" | "redeemCompleteSet" | "redeemShares" | "migrateShares" | undefined;
    tradingError: string | undefined;
    tradingFeedback: ActionFeedback<"createCompleteSet" | "redeemCompleteSet" | "redeemShares" | "migrateShares"> | undefined;
    tradingForm: TradingFormState;
    tradingForkUniverse: ZoltarUniverseSummary | undefined;
    tradingResult: TradingActionResult | undefined;
};
export {};
//# sourceMappingURL=useTradingOperations.d.ts.map