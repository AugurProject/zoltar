import { type Address } from '@zoltar/core-shared/evm/ethereum';
export type SepoliaRepAllocation = {
    readonly address: Address;
    readonly amount: bigint;
};
export declare const SEPOLIA_REP_ALLOCATIONS: readonly [Readonly<{
    address: `0x${string}`;
    amount: bigint;
}>, Readonly<{
    address: `0x${string}`;
    amount: bigint;
}>, Readonly<{
    address: `0x${string}`;
    amount: bigint;
}>, Readonly<{
    address: `0x${string}`;
    amount: bigint;
}>, Readonly<{
    address: `0x${string}`;
    amount: bigint;
}>];
export declare const SEPOLIA_REP_TOTAL_THEORETICAL_SUPPLY: bigint;
