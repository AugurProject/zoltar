import type { AccessEventFlags, BinaryTreeAccessWitnessInterface, BinaryTreeAccessedState, BinaryTreeAccessedStateWithAddress, RawBinaryTreeAccessedState } from '@ethereumjs/common';
import type { StatefulBinaryTreeStateManager } from '@ethereumjs/statemanager';
import type { Address, BinaryTreeExecutionWitness, PrefixedHexString } from '@ethereumjs/util';
import { ChunkCache } from './chunkCache.ts';
import { StemCache } from './stemCache.ts';
export type BinaryStemAccessEvent = {
    write?: boolean;
};
export type BinaryChunkAccessEvent = BinaryStemAccessEvent & {
    fill?: boolean;
};
export type BinaryStemMeta = {
    address: Address;
    treeIndex: number | bigint;
};
export declare function decodeBinaryAccessState(treeIndex: number | bigint, chunkIndex: number): BinaryTreeAccessedState;
export declare class BinaryTreeAccessWitness implements BinaryTreeAccessWitnessInterface {
    stems: Map<PrefixedHexString, BinaryStemAccessEvent & BinaryStemMeta>;
    chunks: Map<PrefixedHexString, BinaryChunkAccessEvent>;
    stemCache: StemCache;
    chunkCache: ChunkCache;
    hashFunction: (msg: Uint8Array) => Uint8Array;
    constructor(opts: {
        hashFunction: (msg: Uint8Array) => Uint8Array;
        stems?: Map<PrefixedHexString, BinaryStemAccessEvent & BinaryStemMeta>;
        chunks?: Map<PrefixedHexString, BinaryChunkAccessEvent>;
    });
    readAccountBasicData(address: Address): bigint;
    writeAccountBasicData(address: Address): bigint;
    readAccountCodeHash(address: Address): bigint;
    writeAccountCodeHash(address: Address): bigint;
    readAccountHeader(address: Address): bigint;
    writeAccountHeader(address: Address): bigint;
    readAccountCodeChunks(contract: Address, startPc: number, endPc: number): bigint;
    writeAccountCodeChunks(contract: Address, startPc: number, endPc: number): bigint;
    readAccountStorage(address: Address, storageSlot: bigint): bigint;
    writeAccountStorage(address: Address, storageSlot: bigint): bigint;
    touchAddressOnWriteAndComputeGas(address: Address, treeIndex: number | bigint, subIndex: number | Uint8Array): bigint;
    touchAddressOnReadAndComputeGas(address: Address, treeIndex: number | bigint, subIndex: number | Uint8Array): bigint;
    touchAddressAndComputeGas(address: Address, treeIndex: number | bigint, subIndex: number | Uint8Array, { isWrite }: {
        isWrite?: boolean;
    }): bigint;
    touchAddress(address: Address, treeIndex: number | bigint, subIndex: number | Uint8Array, { isWrite }?: {
        isWrite?: boolean;
    }): AccessEventFlags;
    merge(accessWitness: BinaryTreeAccessWitness): void;
    commit(): void;
    revert(): void;
    debugWitnessCost(): void;
    rawAccesses(): Generator<RawBinaryTreeAccessedState>;
    accesses(): Generator<BinaryTreeAccessedStateWithAddress>;
}
/**
 * Generate a {@link BinaryTreeExecutionWitness} from a state manager and an access witness.
 * @param stateManager - The state manager containing the state to generate the witness for.
 * @param accessWitness - The access witness containing the accessed states.
 * @param parentStateRoot - The parent state root (i.e. prestate root) to generate the witness for.
 * @returns The generated binary tree execution witness
 */
export declare const generateBinaryExecutionWitness: (stateManager: StatefulBinaryTreeStateManager, accessWitness: BinaryTreeAccessWitness, parentStateRoot: Uint8Array) => Promise<BinaryTreeExecutionWitness>;
//# sourceMappingURL=binaryTreeAccessWitness.d.ts.map