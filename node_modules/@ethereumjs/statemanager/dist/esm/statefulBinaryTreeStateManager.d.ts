import { BinaryTree } from '@ethereumjs/binarytree';
import type { Address, BinaryTreeExecutionWitness, PrefixedHexString } from '@ethereumjs/util';
import { Account } from '@ethereumjs/util';
import { OriginalStorageCache } from './cache/originalStorageCache.ts';
import type { AccountFields, BinaryTreeAccessWitnessInterface, BinaryTreeAccessedStateWithAddress, GenesisState, StateManagerInterface, StorageDump, StorageRange } from '@ethereumjs/common';
import type { Debugger } from 'debug';
import type { Caches } from './cache/caches.ts';
import type { StatefulBinaryTreeStateManagerOpts } from './types.ts';
export declare class StatefulBinaryTreeStateManager implements StateManagerInterface {
    protected _debug: Debugger;
    protected _caches?: Caches;
    preStateRoot: Uint8Array;
    originalStorageCache: OriginalStorageCache;
    hashFunction: (input: Uint8Array) => Uint8Array;
    protected _tree: BinaryTree;
    protected _checkpointCount: number;
    private _postState;
    /**
     * StateManager is run in DEBUG mode (default: false)
     * Taken from DEBUG environment variable
     *
     * Safeguards on debug() calls are added for
     * performance reasons to avoid string literal evaluation
     * @hidden
     */
    protected readonly DEBUG: boolean;
    private keccakFunction;
    constructor(opts: StatefulBinaryTreeStateManagerOpts);
    /**
     * Gets the account associated with `address` or `undefined` if account does not exist
     * @param address - Address of the `account` to get
     */
    getAccount: (address: Address) => Promise<Account | undefined>;
    initBinaryTreeExecutionWitness(_blockNum: bigint, executionWitness?: BinaryTreeExecutionWitness | null): void;
    /**
     * Saves an account into state under the provided `address`.
     * @param address - Address under which to store `account`
     * @param account - The account to store or undefined if to be deleted
     */
    putAccount: (address: Address, account?: Account) => Promise<void>;
    /**
     * Deletes an account from state under the provided `address`.
     * @param address - Address of the account which should be deleted
     */
    deleteAccount: (address: Address) => Promise<void>;
    modifyAccountFields: (address: Address, accountFields: AccountFields) => Promise<void>;
    putCode: (address: Address, value: Uint8Array) => Promise<void>;
    getCode: (address: Address) => Promise<Uint8Array>;
    getCodeSize: (address: Address) => Promise<number>;
    getStorage: (address: Address, key: Uint8Array) => Promise<Uint8Array>;
    putStorage: (address: Address, key: Uint8Array, value: Uint8Array) => Promise<void>;
    clearStorage: (address: Address) => Promise<void>;
    checkpoint: () => Promise<void>;
    commit: () => Promise<void>;
    revert: () => Promise<void>;
    flush: () => Promise<void>;
    getComputedValue(accessedState: BinaryTreeAccessedStateWithAddress): Promise<PrefixedHexString | null>;
    verifyBinaryTreePostState(accessWitness: BinaryTreeAccessWitnessInterface): Promise<boolean>;
    getStateRoot(): Promise<Uint8Array>;
    setStateRoot(stateRoot: Uint8Array, clearCache?: boolean): Promise<void>;
    hasStateRoot(root: Uint8Array): Promise<boolean>;
    dumpStorage?(_address: Address): Promise<StorageDump>;
    dumpStorageRange?(_address: Address, _startKey: bigint, _limit: number): Promise<StorageRange>;
    clearCaches(): void;
    shallowCopy(_downlevelCaches?: boolean): StateManagerInterface;
    checkChunkWitnessPresent(_address: Address, _codeOffset: number): Promise<boolean>;
    generateCanonicalGenesis(genesisState: GenesisState): Promise<void>;
}
//# sourceMappingURL=statefulBinaryTreeStateManager.d.ts.map