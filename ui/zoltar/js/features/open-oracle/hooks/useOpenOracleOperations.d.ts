import { type Abi, type Address, type Hash } from '@zoltar/shared/ethereum';
import { createWalletWriteClient } from '@zoltar/ui-core-shared/lib/clients.js';
import { parseOpenOracleCreateFormSubmission } from '../lib/openOracle.js';
import type { OpenOracleCreateFormState, OpenOracleFormState, WriteOperationsParameters } from '../../../types/app.js';
import type { OpenOracleActionResult, OpenOracleReportDetails, OpenOracleWithdrawableBalances } from '@zoltar/ui-core-shared/types/contracts.js';
import type { OpenOracleReportLookupState } from '../../types.js';
type UseOpenOracleOperationsParameters = WriteOperationsParameters & {
    enabled: boolean;
    onReportSettled?: () => Promise<void> | void;
};
type OpenOracleReadClient = {
    getBalance: (parameters: {
        address: Address;
    }) => Promise<bigint>;
    readContract: (parameters: {
        abi: Abi;
        address: Address;
        args: readonly unknown[];
        functionName: string;
    }) => Promise<unknown>;
};
type OpenOracleProductionWriteClient = ReturnType<typeof createWalletWriteClient>;
type OpenOracleRawReadResult = {
    error?: unknown;
    result?: unknown;
    status: 'failure' | 'success';
};
export type UseOpenOracleOperationsDependencies<TWriteClient = OpenOracleProductionWriteClient> = {
    approveErc20: (client: TWriteClient, tokenAddress: Address, spenderAddress: Address, amount: bigint, action: 'approveToken1' | 'approveToken2') => Promise<OpenOracleActionResult>;
    createConnectedReadClient: () => OpenOracleReadClient;
    createOpenOracleReportInstance: (client: TWriteClient, parameters: ReturnType<typeof parseOpenOracleCreateFormSubmission>) => Promise<OpenOracleActionResult>;
    createWalletWriteClient: (accountAddress: Address, callbacks?: Parameters<typeof createWalletWriteClient>[1]) => TWriteClient;
    disputeOracleReport: (client: TWriteClient, openOracleAddress: Address, reportId: bigint, tokenToSwap: Address, newAmount1: bigint, newAmount2: bigint, currentAmount2: bigint, stateHash: Hash) => Promise<OpenOracleActionResult>;
    loadOpenOracleReportDetails: (openOracleAddress: Address, reportId: bigint) => Promise<OpenOracleReportDetails>;
    loadOpenOracleWithdrawableBalances: (openOracleAddress: Address, holder: Address, token1: Address, token2: Address) => Promise<OpenOracleWithdrawableBalances>;
    readOptionalMulticall: (contracts: readonly unknown[]) => Promise<readonly OpenOracleRawReadResult[]>;
    settleOracleReport: (client: TWriteClient, openOracleAddress: Address, reportId: bigint) => Promise<OpenOracleActionResult>;
    withdrawOpenOracleBalance: (client: TWriteClient, openOracleAddress: Address, token: Address, amount: bigint, recipient: Address) => Promise<OpenOracleActionResult>;
};
declare function useOpenOracleOperationsWithDependencies<TWriteClient>({ accountAddress, enabled, onReportSettled, onTransactionCanceled, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted, refreshState }: UseOpenOracleOperationsParameters, dependencies: UseOpenOracleOperationsDependencies<TWriteClient>): {
    approveToken1: (amount?: bigint) => Promise<void>;
    approveToken2: (amount?: bigint) => Promise<void>;
    cancelWithdrawalBalanceCheck: () => void;
    createOpenOracleGame: () => Promise<void>;
    disputeReport: () => Promise<void>;
    loadOracleReport: (reportIdInput?: string) => Promise<void>;
    openOracleActiveAction: any;
    openOracleActiveWithdrawalBalance: string | number | symbol | undefined;
    loadingOpenOracleCreate: boolean;
    openOracleCreateForm: any;
    openOracleCreateFieldErrors: Partial<Record<"token1Address" | "token2Address", string>>;
    openOracleDisputeSubmission: import("../lib/openOracle.js").OpenOracleDisputeSubmissionDetails | undefined;
    openOracleError: string | undefined;
    openOracleFeedback: any;
    openOracleForm: any;
    openOracleTokenAccessState: {
        token1Approval: TokenApprovalState;
        token1Balance: bigint | undefined;
        token1BalanceError: string | undefined;
        token1Decimals: any;
        token2Approval: TokenApprovalState;
        token2Balance: bigint | undefined;
        token2BalanceError: string | undefined;
        token2Decimals: any;
        tokenAccessLoadingInitial: any;
        tokenAccessRefreshing: any;
    };
    openOracleReportLookupState: OpenOracleReportLookupState;
    openOracleReportDetails: any;
    openOracleResult: any;
    openOracleWithdrawalBalanceChecking: boolean;
    openOracleWithdrawalReviewMessage: {
        balance: keyof OpenOracleWithdrawableBalances;
        message: string;
    } | undefined;
    openOracleWithdrawableBalances: any;
    openOracleWithdrawableBalancesError: string | undefined;
    openOracleWithdrawableBalancesLoading: any;
    resetOpenOracleCreateForm: () => void;
    setOpenOracleCreateForm: (updater: (current: OpenOracleCreateFormState) => OpenOracleCreateFormState) => void;
    setOpenOracleForm: (updater: (current: OpenOracleFormState) => OpenOracleFormState) => void;
    settleReport: () => Promise<void>;
    withdrawBalance: (balance: keyof OpenOracleWithdrawableBalances, reviewedAmount: bigint) => Promise<void>;
};
export declare function useOpenOracleOperations(parameters: UseOpenOracleOperationsParameters): ReturnType<typeof useOpenOracleOperationsWithDependencies<OpenOracleProductionWriteClient>>;
export declare function useOpenOracleOperations<TWriteClient>(parameters: UseOpenOracleOperationsParameters, dependencies: UseOpenOracleOperationsDependencies<TWriteClient>): ReturnType<typeof useOpenOracleOperationsWithDependencies<TWriteClient>>;
export {};
//# sourceMappingURL=useOpenOracleOperations.d.ts.map