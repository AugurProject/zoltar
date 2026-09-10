import { Lock } from '@ethereumjs/util';
import { CheckpointDB } from './db/index.ts';
import { StemBinaryNode } from './node/stemNode.ts';
import { type BinaryTreeOpts } from './types.ts';
import type { Debugger } from 'debug';
import type { BinaryNode } from './node/types.ts';
interface Path {
    node: BinaryNode | null;
    remaining: number[];
    stack: Array<[BinaryNode, number[]]>;
}
/**
 * The basic binary tree interface, use with `import { BinaryTree } from '@ethereumjs/binarytree'`.
 *
 * A BinaryTree object can be created with the constructor method:
 *
 * - {@link createBinaryTree}
 */
export declare class BinaryTree {
    /** The options for instantiating the binary tree */
    protected _opts: BinaryTreeOpts;
    /** The root for an empty tree */
    EMPTY_TREE_ROOT: Uint8Array;
    protected _db: CheckpointDB;
    protected _hashLen: number;
    protected _lock: Lock;
    protected _root: Uint8Array;
    protected DEBUG: boolean;
    protected _debug: Debugger;
    protected debug: (...args: any) => void;
    /**
     * Creates a new binary tree.
     * @param opts Options for instantiating the binary tree
     *
     * Note: in most cases, the static {@link createBinaryTree} constructor should be used. It uses the same API but provides sensible defaults
     */
    constructor(opts: BinaryTreeOpts);
    /**
     * Gets and/or Sets the current root of the `tree`
     */
    root(value?: Uint8Array | null): Uint8Array;
    /**
     * Checks if a given root exists.
     */
    checkRoot(root: Uint8Array): Promise<boolean>;
    /**
     * Gets values at a given binary tree `stem` and set of suffixes
     * @param stem - the stem of the stem node where we're seeking values
     * @param suffixes - an array of suffixes corresponding to the values desired
     * @returns A Promise that resolves to an array of `Uint8Array`s or `null` depending on if values were found.
     * If the stem is not found, will return an empty array.
     */
    get(stem: Uint8Array, suffixes: number[]): Promise<(Uint8Array | null)[]>;
    /**
     * Stores a given `value` at the given `key` or performs a deletion if `value` is null.
     * @param stem - the stem (must be 31 bytes) to store the value at.
     * @param suffixes - array of suffixes at which to store individual values.
     * @param values - the value(s) to store (or null for deletion).
     * @returns A Promise that resolves once the value is stored.
     */
    put(stem: Uint8Array, suffixes: number[], values: (Uint8Array | null)[]): Promise<void>;
    /**
     * Helper method for updating or creating the parent internal node for a given stem node.
     * If the nearest node is a stem node with a different stem, a new internal node is created
     * to branch at the first differing bit.
     * If the nearest node is an internal node, its child reference is updated.
     *
     * @param stemNode - The child stem node that will be referenced by the new/updated internal node.
     * @param nearestNode - The nearest node to the new stem node.
     * @param pathToNode - The path (in bits) to `nearestNode` as known from the trie.
     * @returns An array of nodes and their partial paths from the new stem node to the branch parent node
     *          or `undefined` if no changes were made.
     */
    updateBranch(stemNode: StemBinaryNode, nearestNode: BinaryNode, pathToNode: number[], pathToParent: number[]): {
        node: BinaryNode;
        parentPath: number[];
    }[] | undefined;
    /**
     * Tries to find a path to the node for the given key.
     * It returns a `Path` object containing:
     *   - `node`: the found node (if any),
     *   - `stack`: an array of tuples [node, path] representing the nodes encountered,
     *   - `remaining`: the bits of the key that were not matched.
     *
     * @param keyInBytes - the search key as a byte array.
     * @returns A Promise that resolves to a Path object.
     */
    findPath(keyInBytes: Uint8Array): Promise<Path>;
    /**
     * Deletes a given `key` from the tree.
     * @param stem - the stem of the stem node to delete from
     * @param suffixes - the suffixes to delete
     * @returns A Promise that resolves once the key is deleted.
     */
    del(stem: Uint8Array, suffixes: number[]): Promise<void>;
    /**
     * Create empty root node for initializing an empty tree.
     */
    createRootNode(): Promise<void>;
    /**
     * Creates the initial node from an empty tree.
     * @private
     */
    protected _createInitialNode(stem: Uint8Array, indexes: number[], values: (Uint8Array | null)[]): Promise<void>;
    /**
     * Saves a stack of nodes to the database.
     *
     * @param putStack - an array of tuples of keys (the partial path of the node in the trie) and nodes (BinaryNodes)
     */
    saveStack(putStack: [Uint8Array, BinaryNode | null][]): Promise<void>;
    /**
     * Creates a proof from a tree and key that can be verified using {@link BinaryTree.verifyBinaryProof}.
     * @param key a 32 byte binary tree key (31 byte stem + 1 byte suffix)
     */
    createBinaryProof(key: Uint8Array): Promise<Uint8Array[]>;
    /**
     * The `data` event is given an `Object` that has two properties; the `key` and the `value`. Both should be Uint8Arrays.
     * @return Returns a [stream](https://nodejs.org/dist/latest-v12.x/docs/api/stream.html#stream_class_stream_readable) of the contents of the `tree`
     */
    createReadStream(): any;
    /**
     * Returns a copy of the underlying tree.
     *
     * Note on db: the copy will create a reference to the
     * same underlying database.
     *
     * Note on cache: for memory reasons a copy will not
     * recreate a new LRU cache but initialize with cache
     * being deactivated.
     *
     * @param includeCheckpoints - If true and during a checkpoint, the copy will contain the checkpointing metadata and will use the same scratch as underlying db.
     */
    shallowCopy(includeCheckpoints?: boolean): BinaryTree;
    /**
     * Persists the root hash in the underlying database
     */
    persistRoot(): Promise<void>;
    /**
     * Is the tree during a checkpoint phase?
     */
    hasCheckpoints(): boolean;
    /**
     * Creates a checkpoint that can later be reverted to or committed.
     * After this is called, all changes can be reverted until `commit` is called.
     */
    checkpoint(): void;
    /**
     * Commits a checkpoint to disk, if current checkpoint is not nested.
     * If nested, only sets the parent checkpoint as current checkpoint.
     * @throws If not during a checkpoint phase
     */
    commit(): Promise<void>;
    /**
     * Reverts the tree to the state it was at when `checkpoint` was first called.
     * If during a nested checkpoint, sets root to most recent checkpoint, and sets
     * parent checkpoint as current.
     */
    revert(): Promise<void>;
    /**
     * Flushes all checkpoints, restoring the initial checkpoint state.
     */
    flushCheckpoints(): void;
    protected hash(msg: Uint8Array | null): Uint8Array;
    protected merkelize(node: BinaryNode | null): Uint8Array;
}
export {};
//# sourceMappingURL=binaryTree.d.ts.map