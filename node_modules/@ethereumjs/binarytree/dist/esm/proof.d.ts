import type { BinaryTree } from './binaryTree.ts';
/**
 * Saves the nodes from a proof into the tree.
 * @param proof
 */
export declare function binaryTreeFromProof(proof: Uint8Array[]): Promise<BinaryTree>;
/**
 * Verifies a proof.
 * @param rootHash
 * @param key
 * @param proof
 * @throws If proof is found to be invalid.
 * @returns The value from the key, or null if valid proof of non-existence.
 */
export declare function verifyBinaryProof(rootHash: Uint8Array, key: Uint8Array, proof: Uint8Array[]): Promise<Uint8Array | null>;
//# sourceMappingURL=proof.d.ts.map