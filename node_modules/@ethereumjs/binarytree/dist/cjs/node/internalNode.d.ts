import { BinaryNodeType } from './types.ts';
import type { BinaryNodeOptions, ChildBinaryNode } from './types.ts';
export declare class InternalBinaryNode {
    children: Array<ChildBinaryNode | null>;
    type: 0;
    constructor(options: BinaryNodeOptions[typeof BinaryNodeType.Internal]);
    static fromRawNode(rawNode: Uint8Array[]): InternalBinaryNode;
    /**
     * Generates a new Internal node
     * @param children the children nodes
     * @returns a new Internal node
     */
    static create(children?: (ChildBinaryNode | null)[]): InternalBinaryNode;
    getChild(index: number): ChildBinaryNode | null;
    setChild(index: number, child: ChildBinaryNode | null): void;
    /**
     * @returns the RLP serialized node
     */
    serialize(): Uint8Array;
    /**
     * Returns the raw serialized representation of this internal node as an array of Uint8Arrays.
     *
     * The returned array contains:
     * 1. A single-byte Uint8Array indicating the node type (BinaryNodeType.Internal).
     * 2. For each child (left then right):
     *    - The child’s hash, or an empty Uint8Array if the child is null.
     * 3. For each child (left then right):
     *    - An RLP-encoded tuple [pathLength, packedPathBytes] where:
     *         - `pathLength` is a one-byte Uint8Array representing the number of meaningful bits in the child’s path.
     *         - `packedPathBytes` is the packed byte representation of the child's bit path (as produced by `bitsToBytes`).
     *
     * @returns {Uint8Array[]} An array of Uint8Arrays representing the node's serialized internal data.
     * @dev When decoding, the stored child path (an RLP-encoded tuple) must be converted back into the original bit array.
     */
    raw(): Uint8Array[];
}
//# sourceMappingURL=internalNode.d.ts.map