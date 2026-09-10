import type { AbiValue } from '@zoltar/core-shared/evm/ethereum';
export type Address = `0x${string}`;
export type Hash = `0x${string}`;
export type ContractRequest = Readonly<{
    address: Address;
    functionName: string;
    args: readonly AbiValue[];
    value?: bigint;
}>;
export type SimulationResult<T> = Readonly<{
    blockNumber: bigint;
    blockHash: Hash;
    request: ContractRequest;
    result: T;
}>;
export type SimulationClient<T> = Readonly<{
    getBlock(): Promise<Readonly<{
        number: bigint | null;
        hash: Hash | null;
    }>>;
    simulate(request: ContractRequest, blockHash: Hash): Promise<T>;
}>;
export declare function enterPositionRequest(router: Address, pair: Address, longOutcome: 'YES' | 'NO', amountAttoEth: bigint, minimumLongAttoShares: bigint, recipient: Address, deadline: bigint): ContractRequest;
export declare function exitPositionRequest(router: Address, pair: Address, longOutcome: 'YES' | 'NO', completeSetShares: bigint, maximumLongShares: bigint, minimumAttoEth: bigint, recipient: Address, deadline: bigint): ContractRequest;
export declare function initializeLiquidityRequest(router: Address, pool: Address, amountAttoEth: bigint, conditionalYesBps: bigint, minimumLiquidity: bigint, recipient: Address, deadline: bigint): ContractRequest;
export declare function addLiquidityRequest(router: Address, pair: Address, amountAttoEth: bigint, minimumLiquidity: bigint, recipient: Address, deadline: bigint): ContractRequest;
export declare function removeLiquidityRequest(router: Address, pair: Address, liquidity: bigint, minimumYes: bigint, minimumNo: bigint, recipient: Address, deadline: bigint): ContractRequest;
export declare function redeemCompleteSetRequest(router: Address, securityPool: Address, amountAttoShares: bigint, minimumAttoEth: bigint, recipient: Address, deadline: bigint): ContractRequest;
export declare function redeemWinningSharesRequest(securityPool: Address): ContractRequest;
export declare function migrateSharesRequest(shareToken: Address, universeId: bigint, sourceOutcome: 'INVALID' | 'YES' | 'NO', targetOutcomeIndexes: readonly bigint[]): ContractRequest;
export declare function simulateAuthoritatively<T>(client: SimulationClient<T>, request: ContractRequest): Promise<SimulationResult<T>>;
export declare function requireFreshSimulation<T>(client: Pick<SimulationClient<T>, 'getBlock'>, simulation: SimulationResult<T>): Promise<Readonly<{
    address: Address;
    functionName: string;
    args: readonly AbiValue[];
    value?: bigint;
}>>;
export declare function extractEventResult<T>(logs: readonly unknown[], decode: (log: unknown) => {
    eventName: string;
    args: T;
} | undefined, eventName: string): T;
