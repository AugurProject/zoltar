import { type PrefixedHexString } from '@ethereumjs/util';
import type { BinaryTree } from './binaryTree.ts';
/**
 * Recursively walks down the tree from a given starting node and returns all the leaf values
 * @param tree - The binary tree
 * @param startingNode - The starting node
 * @returns An array of key-value pairs containing the tree keys and associated values
 */
export declare const dumpLeafValues: (tree: BinaryTree, startingNode: Uint8Array) => Promise<[PrefixedHexString, PrefixedHexString][] | undefined>;
/**
 * Recursively walks down the tree from a given starting node and returns all the node paths and hashes
 * @param tree - The binary tree
 * @param startingNode - The starting node
 * @returns An array of key-value pairs containing the tree paths and associated hashes
 */
export declare const dumpNodeHashes: (tree: BinaryTree, startingNode: Uint8Array) => Promise<[string, PrefixedHexString][] | undefined>;
//# sourceMappingURL=util.d.ts.map