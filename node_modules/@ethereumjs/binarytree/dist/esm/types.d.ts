import type { DB, ValueEncoding } from '@ethereumjs/util';
export interface BinaryTreeOpts {
    /**
     * A database instance.
     */
    db: DB<string, string | Uint8Array>;
    /**
     * A `Uint8Array` for the root of a previously stored tree
     */
    root?: Uint8Array;
    /**
     * Store the root inside the database after every `write` operation
     */
    useRootPersistence: boolean;
    /**
     * LRU cache for tree nodes to allow for faster node retrieval.
     *
     * Default: 0 (deactivated)
     */
    cacheSize: number;
    /**
     * Hash function used for hashing the tree nodes.
     */
    hashFunction: (msg: Uint8Array) => Uint8Array;
}
export interface CheckpointDBOpts {
    /**
     * A database instance.
     */
    db: DB<string, string | Uint8Array>;
    /**
     * ValueEncoding of the database (the values which are `put`/`get` in the db are of this type). Defaults to `string`
     */
    valueEncoding?: ValueEncoding;
    /**
     * Cache size (default: 0)
     */
    cacheSize?: number;
}
export type Checkpoint = {
    keyValueMap: Map<string, Uint8Array | undefined>;
    root: Uint8Array;
};
export declare const ROOT_DB_KEY: Uint8Array<ArrayBufferLike>;
//# sourceMappingURL=types.d.ts.map