"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InternalBinaryNode = void 0;
const rlp_1 = require("@ethereumjs/rlp");
const util_1 = require("@ethereumjs/util");
const types_ts_1 = require("./types.js");
class InternalBinaryNode {
    constructor(options) {
        this.type = types_ts_1.BinaryNodeType.Internal;
        this.children = options.children ?? Array(2).fill(null);
    }
    static fromRawNode(rawNode) {
        const nodeType = rawNode[0][0];
        if (nodeType !== types_ts_1.BinaryNodeType.Internal) {
            throw (0, util_1.EthereumJSErrorWithoutCode)('Invalid node type');
        }
        // The length of the rawNode should be the # of children * 2 (for hash and path) + 1 for the node type
        if (rawNode.length !== 2 * 2 + 1) {
            throw (0, util_1.EthereumJSErrorWithoutCode)('Invalid node length');
        }
        const [, leftChildHash, rightChildHash, leftChildRawPath, rightChildRawPath] = rawNode;
        const decodeChild = (hash, rawPath) => {
            if (hash.length === 0)
                return null;
            const decoded = rlp_1.RLP.decode(rawPath);
            if (!Array.isArray(decoded) || decoded.length !== 2) {
                throw (0, util_1.EthereumJSErrorWithoutCode)('Invalid RLP encoding for child path');
            }
            const [encodedLength, encodedPath] = decoded;
            if (encodedLength.length !== 1) {
                throw (0, util_1.EthereumJSErrorWithoutCode)('Invalid path length encoding');
            }
            const pathLength = encodedLength[0];
            const path = (0, util_1.bytesToBits)(encodedPath, pathLength);
            return { hash, path };
        };
        const children = [
            decodeChild(leftChildHash, leftChildRawPath),
            decodeChild(rightChildHash, rightChildRawPath),
        ];
        return new InternalBinaryNode({ children });
    }
    /**
     * Generates a new Internal node
     * @param children the children nodes
     * @returns a new Internal node
     */
    static create(children) {
        if (children !== undefined && children.length !== 2) {
            throw (0, util_1.EthereumJSErrorWithoutCode)('Internal node must have 2 children');
        }
        return new InternalBinaryNode({ children });
    }
    getChild(index) {
        return this.children[index];
    }
    setChild(index, child) {
        this.children[index] = child;
    }
    /**
     * @returns the RLP serialized node
     */
    serialize() {
        return rlp_1.RLP.encode(this.raw());
    }
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
    raw() {
        return [
            new Uint8Array([types_ts_1.BinaryNodeType.Internal]),
            ...this.children.map((child) => (child !== null ? child.hash : new Uint8Array())),
            ...this.children.map((child) => child !== null
                ? rlp_1.RLP.encode([new Uint8Array([child.path.length]), (0, util_1.bitsToBytes)(child.path)])
                : new Uint8Array()),
        ];
    }
}
exports.InternalBinaryNode = InternalBinaryNode;
//# sourceMappingURL=internalNode.js.map