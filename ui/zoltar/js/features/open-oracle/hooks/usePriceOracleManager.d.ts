import type { Address, Hash } from '@zoltar/shared/ethereum';
import { loadCoordinatorInitialReportFundingRequirement } from '../../../protocol/index.js';
import { createConnectedReadClient, createWalletWriteClient } from '@zoltar/ui-core-shared/lib/clients.js';
import type { ActionFeedback } from '@zoltar/ui-core-shared/lib/actionFeedback.js';
import type { WriteOperationsParameters } from '../../../types/app.js';
import type { OpenOracleActionResult, OracleManagerDetails } from '@zoltar/ui-core-shared/types/contracts.js';
type UsePriceOracleManagerParameters = {
    accountAddress: Address | undefined;
    onTransactionFailed?: WriteOperationsParameters['onTransactionFailed'];
    onTransactionFinished: () => void;
    onTransactionPresented: WriteOperationsParameters['onTransactionPresented'];
    onTransactionPrepared?: WriteOperationsParameters['onTransactionPrepared'];
    onTransactionRequested: WriteOperationsParameters['onTransactionRequested'];
    onTransactionSubmitted: (hash: Hash) => void;
    refreshState: WriteOperationsParameters['refreshState'];
};
type PriceOracleReadClient = Pick<ReturnType<typeof createConnectedReadClient>, 'getBalance'>;
type PriceOracleProductionWriteClient = ReturnType<typeof createWalletWriteClient>;
type CoordinatorInitialReportFunding = Awaited<ReturnType<typeof loadCoordinatorInitialReportFundingRequirement>>;
export type UsePriceOracleManagerDependencies<TWriteClient = PriceOracleProductionWriteClient> = {
    createConnectedReadClient: () => PriceOracleReadClient;
    createWalletWriteClient: (accountAddress: Address, callbacks?: Parameters<typeof createWalletWriteClient>[1]) => TWriteClient;
    executeOracleManagerStagedOperation: (client: TWriteClient, managerAddress: Address, operationId: bigint) => Promise<OpenOracleActionResult>;
    loadCoordinatorInitialReportFundingRequirement: (client: TWriteClient, managerAddress: Address, walletAddress: Address) => Promise<CoordinatorInitialReportFunding>;
    loadOracleManagerDetails: (managerAddress: Address) => Promise<OracleManagerDetails>;
    requestOraclePrice: (client: TWriteClient, managerAddress: Address, proposedRepPerEthPrice: bigint, requestedInitialAttoWeth: bigint, reviewedRequestValueAttoEth: bigint) => Promise<OpenOracleActionResult>;
};
declare function usePriceOracleManagerWithDependencies<TWriteClient>({ accountAddress, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted, refreshState }: UsePriceOracleManagerParameters, dependencies: UsePriceOracleManagerDependencies<TWriteClient>): {
    executePendingPoolOperation: (managerAddress: Address, operationId: bigint, securityPoolAddress?: Address) => Promise<void>;
    loadingPoolOracleManager: boolean;
    loadPoolOracleManager: (managerAddress: Address) => Promise<void>;
    poolOracleActiveAction: "dispute" | "settle" | "approveToken1" | "approveToken2" | "createReportInstance" | "executeStagedOperation" | "queueOperation" | "requestPrice" | "withdrawBalance" | "wrapWeth" | undefined;
    poolOracleFeedback: ActionFeedback<"dispute" | "settle" | "approveToken1" | "approveToken2" | "createReportInstance" | "executeStagedOperation" | "queueOperation" | "requestPrice" | "withdrawBalance" | "wrapWeth"> | undefined;
    poolOracleManagerDetails: OracleManagerDetails | undefined;
    poolOracleManagerError: string | undefined;
    poolOracleManagerErrorAddress: `0x${string}` | undefined;
    poolPriceOracleResult: OpenOracleActionResult | undefined;
    requestPoolPrice: (managerAddress: Address, securityPoolAddress: Address, reviewedRequestValueAttoEth: bigint) => Promise<void>;
};
export declare function usePriceOracleManager(parameters: UsePriceOracleManagerParameters): ReturnType<typeof usePriceOracleManagerWithDependencies<PriceOracleProductionWriteClient>>;
export declare function usePriceOracleManager<TWriteClient>(parameters: UsePriceOracleManagerParameters, dependencies: UsePriceOracleManagerDependencies<TWriteClient>): ReturnType<typeof usePriceOracleManagerWithDependencies<TWriteClient>>;
export {};
//# sourceMappingURL=usePriceOracleManager.d.ts.map