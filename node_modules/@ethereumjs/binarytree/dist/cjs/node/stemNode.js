"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StemBinaryNode = void 0;
const rlp_1 = require("@ethereumjs/rlp");
const util_1 = require("@ethereumjs/util");
const types_ts_1 = require("./types.js");
class StemBinaryNode {
    constructor(options) {
        this.type = types_ts_1.BinaryNodeType.Stem;
        this.stem = options.stem;
        this.values = options.values ?? new Array(256).fill(null);
    }
    static fromRawNode(rawNode) {
        const nodeType = rawNode[0][0];
        if (nodeType !== types_ts_1.BinaryNodeType.Stem) {
            throw (0, util_1.EthereumJSErrorWithoutCode)('Invalid node type');
        }
        // The length of the rawNode should be the # of values (node width) + 2 for the node type and the stem
        if (rawNode.length !== types_ts_1.NODE_WIDTH + 2) {
            throw (0, util_1.EthereumJSErrorWithoutCode)('Invalid node length');
        }
        const stem = rawNode[1];
        const rawValues = rawNode.slice(2, rawNode.length);
        const values = rawValues.map((el) => (el.length === 0 ? null : el));
        return new StemBinaryNode({ stem, values });
    }
    /**
     * Generates a new Stem node
     * @param stem the 31 byte stem corresponding to the where the stem node is located in the tree
     * @returns a new Stem node
     */
    static create(stem) {
        return new StemBinaryNode({ stem });
    }
    // Retrieve the value at the provided index from the values array
    getValue(index) {
        return this.values[index];
    }
    setValue(index, value) {
        this.values[index] = value;
    }
    /**
     * @returns the RLP serialized node
     */
    serialize() {
        return rlp_1.RLP.encode(this.raw());
    }
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
    raw() {
        return [
            new Uint8Array([types_ts_1.BinaryNodeType.Stem]),
            this.stem,
            ...this.values.map((val) => {
                switch (val) {
                    case null:
                        return new Uint8Array();
                    default:
                        return val;
                }
            }),
        ];
    }
}
exports.StemBinaryNode = StemBinaryNode;
//# sourceMappingURL=stemNode.js.map