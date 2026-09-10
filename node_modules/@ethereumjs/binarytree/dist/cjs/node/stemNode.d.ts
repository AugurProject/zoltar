import { BinaryNodeType } from './types.ts';
import type { BinaryNodeOptions } from './types.ts';
export declare class StemBinaryNode {
    stem: Uint8Array;
    values: (Uint8Array | null)[];
    type: 1;
    constructor(options: BinaryNodeOptions[typeof BinaryNodeType.Stem]);
    static fromRawNode(rawNode: Uint8Array[]): StemBinaryNode;
    /**
     * Generates a new Stem node
     * @param stem the 31 byte stem corresponding to the where the stem node is located in the tree
     * @returns a new Stem node
     */
    static create(stem: Uint8Array): StemBinaryNode;
    getValue(index: number): Uint8Array | null;
    setValue(index: number, value: Uint8Array | null): void;
    /**
     * @returns the RLP serialized node
     */
    serialize(): Uint8Array;
    /**
     * Returns the raw serialized representation of the node as an array of Uint8Arrays.
     * The returned array is constructed as follows:
     * - The first element is a Uint8Array containing a single byte that represents the node type,
     * - The second element is the node's `stem` property.
     * - The remaining elements are derived from the node's `values` array:
     *   - For each value, if it is `null`, it is converted to an empty Uint8Array.
     *   - Otherwise, the value is included as-is.
     *
     * @returns {Uint8Array[]} An array of Uint8Arrays representing the node's raw data.
     */
    raw(): Uint8Array[];
}
//# sourceMappingURL=stemNode.d.ts.map