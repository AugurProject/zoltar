import { type Address, type TransactionReceipt } from '@zoltar/shared/ethereum';
import type { ReadClient, ReportingOutcomeKey, TradingDetails, WriteClient } from '@zoltar/ui-core-shared/types/contracts.js';
import { type WriteContractClient } from '@zoltar/ui-zoltar/protocol/core.js';
type ReadWriteContractClient<TReceipt extends Pick<TransactionReceipt, 'status'> = TransactionReceipt> = Pick<ReadClient, 'readContract'> & WriteContractClient<TReceipt>;
type SecurityPoolMintCapacity = {
    currentRetentionRate?: bigint;
    currentTimestamp?: bigint;
    feeEndTimestamp?: bigint;
    feeIndexRemainder?: bigint;
    lastUpdatedFeeAccumulator?: bigint;
    settlementCollateralAttoEth: bigint;
    feeEligibleCapacityOwnershipAttoRep: bigint;
    mintingCapacityAttoEth: bigint;
    shareTokenSupplyAttoShares: bigint;
    totalPoolHeldAttoRep: bigint;
    totalCapacityOwnershipAttoRep: bigint;
    isPriceValid: boolean;
    totalFeesOwedRemainder?: bigint;
};
export declare function loadSecurityPoolMintCapacity(client: Pick<ReadClient, 'getBlock' | 'multicall'>, securityPoolAddress: Address): Promise<SecurityPoolMintCapacity>;
export declare function loadTradingDetails(client: ReadClient, securityPoolAddress: Address, accountAddress: Address | undefined): Promise<TradingDetails>;
export declare function redeemSharesInSecurityPool(client: WriteClient, securityPoolAddress: Address): Promise<{
    action: "redeemShares";
    hash: `0x${string}`;
    securityPoolAddress: `0x${string}`;
    universeId: bigint;
}>;
export declare function migrateSharesFromUniverse<TReceipt extends Pick<TransactionReceipt, 'status'>>(client: ReadWriteContractClient<TReceipt>, securityPoolAddress: Address, shareOutcome: ReportingOutcomeKey, targetOutcomeIndexes: bigint[]): Promise<{
    action: "migrateShares";
    hash: `0x${string}`;
    securityPoolAddress: `0x${string}`;
    shareOutcome: ReportingOutcomeKey;
    targetOutcomeIndexes: bigint[];
    universeId: bigint;
}>;
export declare function createCompleteSetInSecurityPool(client: WriteClient, securityPoolAddress: Address, amount: bigint): Promise<{
    action: "createCompleteSet";
    hash: `0x${string}`;
    securityPoolAddress: `0x${string}`;
    universeId: bigint;
}>;
export declare function redeemCompleteSetInSecurityPool(client: WriteClient, securityPoolAddress: Address, amount: bigint): Promise<{
    action: "redeemCompleteSet";
    hash: `0x${string}`;
    securityPoolAddress: `0x${string}`;
    universeId: bigint;
}>;
export {};
//# sourceMappingURL=trading.d.ts.map