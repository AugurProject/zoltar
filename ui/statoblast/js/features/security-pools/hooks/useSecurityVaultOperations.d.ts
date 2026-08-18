import type { Address } from '@zoltar/shared/ethereum';
import { loadCoordinatorInitialReportFundingRequirement, loadOracleManagerDetails } from '../../../protocol/index.js';
import { createWalletWriteClient } from '@zoltar/ui-core-shared/lib/clients.js';
import type { ActionFeedback } from '@zoltar/ui-core-shared/lib/actionFeedback.js';
import type { SecurityVaultFormState, WriteOperationsParameters } from '../../../types/app.js';
import type { SecurityVaultActionResult, SecurityVaultDetails } from '@zoltar/ui-core-shared/types/contracts.js';
type UseSecurityVaultOperationsParameters = WriteOperationsParameters & {
    enabled: boolean;
    selectedSecurityPoolAddress?: string;
};
type SecurityVaultReadClient = {
    getBalance: (parameters: {
        address: Address;
    }) => Promise<bigint>;
};
type SecurityVaultProductionWriteClient = ReturnType<typeof createWalletWriteClient>;
type SecurityVaultQueueResult = Pick<SecurityVaultActionResult, 'hash' | 'queuedOperation' | 'stagedExecution'>;
export type UseSecurityVaultOperationsDependencies<TWriteClient = SecurityVaultProductionWriteClient> = {
    approveErc20: (client: TWriteClient, tokenAddress: Address, spenderAddress: Address, amount: bigint, action: 'approveRep') => Promise<SecurityVaultActionResult>;
    createConnectedReadClient: () => SecurityVaultReadClient;
    createWalletWriteClient: (walletAddress: Address, callbacks?: Parameters<typeof createWalletWriteClient>[1]) => TWriteClient;
    depositRepToVaultToSecurityPool: (client: TWriteClient, securityPoolAddress: Address, amount: bigint, targetHealthFactorBps: bigint) => Promise<SecurityVaultActionResult>;
    loadCoordinatorInitialReportFundingRequirement: (client: TWriteClient, managerAddress: Address, walletAddress: Address) => Promise<Awaited<ReturnType<typeof loadCoordinatorInitialReportFundingRequirement>>>;
    loadErc20Balance: (tokenAddress: Address, accountAddress: Address) => Promise<bigint>;
    loadOracleManagerDetails: (managerAddress: Address) => Promise<Awaited<ReturnType<typeof loadOracleManagerDetails>>>;
    loadSecurityVaultDetails: (securityPoolAddress: Address, vaultAddress: Address) => Promise<SecurityVaultDetails | undefined>;
    queueOracleManagerOperation: (client: TWriteClient, managerAddress: Address, operation: 'withdrawRep', targetVault: Address, amount: bigint, validForSeconds: bigint) => Promise<SecurityVaultQueueResult>;
    redeemRepFromVaultFromSecurityPool: (client: TWriteClient, securityPoolAddress: Address, vaultAddress: Address) => Promise<SecurityVaultActionResult>;
    redeemSecurityVaultFees: (client: TWriteClient, securityPoolAddress: Address, vaultAddress: Address) => Promise<SecurityVaultActionResult>;
    updateSecurityVaultFees: (client: TWriteClient, securityPoolAddress: Address, vaultAddress: Address) => Promise<SecurityVaultActionResult>;
};
declare function useSecurityVaultOperationsWithDependencies<TWriteClient>({ accountAddress, enabled, onTransactionCanceled, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted, refreshState, selectedSecurityPoolAddress }: UseSecurityVaultOperationsParameters, dependencies: UseSecurityVaultOperationsDependencies<TWriteClient>): {
    approveRep: (amount?: bigint) => Promise<void>;
    depositRepToVault: () => Promise<void>;
    loadSecurityVault: (vaultAddressInput?: string) => Promise<void>;
    loadingSecurityVault: boolean;
    redeemFees: () => Promise<void>;
    redeemRepFromVault: () => Promise<void>;
    securityVaultActiveAction: "depositRepToVault" | "redeemFees" | "redeemRepFromVault" | "updateVaultFees" | "approveRep" | "queueWithdrawRep" | undefined;
    securityVaultFeedback: ActionFeedback<"depositRepToVault" | "redeemFees" | "redeemRepFromVault" | "updateVaultFees" | "approveRep" | "queueWithdrawRep"> | undefined;
    withdrawRep: () => Promise<void>;
    securityVaultRepApproval: import("@zoltar/ui-core-shared/lib/tokenApproval.js").TokenApprovalState;
    securityVaultDetails: SecurityVaultDetails | undefined;
    securityVaultError: string | undefined;
    securityVaultForm: SecurityVaultFormState;
    securityVaultMissing: boolean;
    walletRepBalanceAttoRep: bigint | undefined;
    walletRepBalanceError: string | undefined;
    walletRepBalanceLoading: boolean;
    securityVaultResult: SecurityVaultActionResult | undefined;
    setSecurityVaultForm: (updater: (current: SecurityVaultFormState) => SecurityVaultFormState) => void;
};
export declare function useSecurityVaultOperations(parameters: UseSecurityVaultOperationsParameters): ReturnType<typeof useSecurityVaultOperationsWithDependencies<SecurityVaultProductionWriteClient>>;
export declare function useSecurityVaultOperations<TWriteClient>(parameters: UseSecurityVaultOperationsParameters, dependencies: UseSecurityVaultOperationsDependencies<TWriteClient>): ReturnType<typeof useSecurityVaultOperationsWithDependencies<TWriteClient>>;
export {};
//# sourceMappingURL=useSecurityVaultOperations.d.ts.map