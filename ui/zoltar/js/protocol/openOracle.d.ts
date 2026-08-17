import { type Address, type Hex, type TransactionReceipt } from '@zoltar/shared/ethereum';
import { type OpenOracleStatePreimage } from '@zoltar/shared/openOracle';
import { loadOpenOracleInitialReportPrice } from './openOraclePricing.js';
import type { LiquidationApprovalDetails, OpenOracleActionResult, OpenOracleWithdrawableBalances, OracleManagerDetails, OracleQueueOperation, ReadClient, OpenOracleReportSummaryPage, StagedOracleExecutionResult, StagedOracleQueuedResult, WriteClient } from '@zoltar/ui-core-shared/types/contracts.js';
import { type WriteContractClient } from './core.js';
type CoordinatorInitialReportClient = Parameters<typeof loadOpenOracleInitialReportPrice>[0];
export declare function createOpenOracleReportMissingError(reportId: bigint): Error;
export declare function isOpenOracleReportMissingError(error: unknown): boolean;
export declare function getOpenOracleDisputeSwapToken(game: Pick<OpenOracleStatePreimage['game'], 'currentAmount1' | 'currentAmount2' | 'token1' | 'token2'>, newAmount1: bigint, newAmount2: bigint): `0x${string}`;
export declare function loadOracleManagerDetails(client: ReadClient, managerAddress: Address, openOracleAddress?: Address): Promise<OracleManagerDetails>;
export declare function loadOpenOracleReportDetails(client: ReadClient, openOracleAddress: Address, reportId: bigint): Promise<import('@zoltar/ui-core-shared/types/contracts.js').OpenOracleReportDetails>;
export declare function loadOpenOracleReportSummaries(client: ReadClient, pageIndex: number, pageSize: number): Promise<OpenOracleReportSummaryPage>;
export declare function createOpenOracleReportInstance(client: WriteClient, parameters: {
    disputeDelay: number;
    escalationHalt: bigint;
    exactToken1Report: bigint;
    initialToken2Amount: bigint;
    ethValueAttoEth: bigint;
    feePercentage: number;
    multiplier: number;
    protocolFee: number;
    settlementTime: number;
    settlerRewardAttoEth: bigint;
    token1Address: Address;
    token2Address: Address;
}): Promise<{
    action: "createReportInstance";
    hash: `0x${string}`;
}>;
export declare function loadOracleManagerQueueOperationEthValue(client: Pick<WriteClient, 'readContract'>, managerAddress: Address): Promise<bigint>;
export declare function loadCoordinatorInitialReportFundingRequirement(client: CoordinatorInitialReportClient, managerAddress: Address, walletAddress: Address, proposedRepPerEthPrice?: bigint, requestedInitialAttoWeth?: bigint): Promise<{
    currentRepBalanceAttoRep: any;
    currentWethBalanceAttoEth: any;
    initialReportAmount2: bigint;
    maximumInitialAttoWeth: bigint;
    minimumToken1ReportAttoEth: any;
    proposedRepPerEthPrice: any;
    reputationTokenAddress: `0x${string}`;
    requestedInitialAttoWeth: bigint;
    wethShortfallAttoEth: bigint;
}>;
export declare function requestOraclePrice(client: WriteClient, managerAddress: Address, proposedRepPerEthPrice?: bigint, requestedInitialAttoWeth?: bigint, reviewedRequestValueAttoEth?: bigint): Promise<{
    action: "requestPrice";
    hash: `0x${string}`;
}>;
export declare function executeOracleManagerStagedOperation(client: WriteContractClient, managerAddress: Address, operationId: bigint): Promise<{
    stagedExecution?: StagedOracleExecutionResult;
    action: "executeStagedOperation";
    hash: `0x${string}`;
}>;
export declare function wrapWeth(client: WriteClient, amountAttoEth: bigint): Promise<{
    action: "wrapWeth";
    hash: `0x${string}`;
}>;
export declare function loadOpenOracleWithdrawableBalances(client: Pick<ReadClient, 'readContract'>, openOracleAddress: Address, holder: Address, token1: Address, token2: Address): Promise<OpenOracleWithdrawableBalances>;
export declare function withdrawOpenOracleBalance<TReceipt extends Pick<TransactionReceipt, 'status'>>(client: WriteContractClient<TReceipt>, openOracleAddress: Address, token: Address, amount: bigint, recipient: Address): Promise<OpenOracleActionResult>;
export declare function settleOracleReport(client: WriteClient, openOracleAddress: Address, reportId: bigint): Promise<OpenOracleActionResult>;
export declare function settleOracleReport<TReceipt extends Pick<TransactionReceipt, 'status'>>(client: WriteContractClient<TReceipt>, openOracleAddress: Address, reportId: bigint, preimage: OpenOracleStatePreimage): Promise<OpenOracleActionResult>;
export declare function disputeOracleReport(client: WriteClient, openOracleAddress: Address, reportId: bigint, tokenToSwap: Address, newAmount1: bigint, newAmount2: bigint, _amt2Expected: bigint, stateHash: Hex): Promise<{
    action: "dispute";
    hash: `0x${string}`;
}>;
export type LiquidationApprovalParams = {
    securityPool: Address;
    receiverVault: Address;
    operator: Address;
    targetVault: Address;
    maxCumulativeDebtAttoEth: bigint;
    maxDebtPerLiquidationAttoEth: bigint;
    minPostLiquidationHealthFactorBps: bigint;
    validAfter: bigint;
    validUntil: bigint;
    nonce: bigint;
};
export declare function loadLiquidationApprovalRegistry(client: ReadClient, managerAddress: Address): Promise<any>;
export declare function loadLiquidationApproval(client: ReadClient, managerAddress: Address, approvalId: Hex): Promise<LiquidationApprovalDetails>;
export declare function setLiquidationApproval(client: WriteClient, registryAddress: Address, params: LiquidationApprovalParams): Promise<`0x${string}`>;
export declare function permitLiquidationApproval(client: WriteClient, registryAddress: Address, params: LiquidationApprovalParams, signature: Hex): Promise<`0x${string}`>;
export declare function revokeLiquidationApproval(client: WriteClient, registryAddress: Address, approvalId: Hex): Promise<`0x${string}`>;
export declare function invalidateLiquidationApprovalNonce(client: WriteClient, registryAddress: Address, newNonce: bigint): Promise<`0x${string}`>;
export declare function queueSecurityPoolLiquidation(client: WriteClient, managerAddress: Address, targetVault: Address, amount: bigint, validForSeconds: bigint, requestedInitialAttoWeth?: bigint, receiverVault?: Address, approvalId?: Hex): Promise<{
    stagedExecution?: StagedOracleExecutionResult;
    queuedOperation?: StagedOracleQueuedResult;
    hash: `0x${string}`;
}>;
export declare function queueOracleManagerOperation(client: WriteClient, managerAddress: Address, operation: OracleQueueOperation, targetVault: Address, amount: bigint, validForSeconds: bigint, proposedRepPerEthPrice?: bigint, requestedInitialAttoWeth?: bigint): Promise<{
    stagedExecution?: StagedOracleExecutionResult;
    queuedOperation?: StagedOracleQueuedResult;
    action: "queueOperation";
    hash: `0x${string}`;
}>;
export {};
//# sourceMappingURL=openOracle.d.ts.map