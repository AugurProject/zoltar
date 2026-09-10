"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeRawMPTNode = decodeRawMPTNode;
exports.isRawMPTNode = isRawMPTNode;
exports.decodeMPTNode = decodeMPTNode;
const rlp_1 = require("@ethereumjs/rlp");
const util_1 = require("@ethereumjs/util");
const hex_ts_1 = require("../util/hex.js");
const nibbles_ts_1 = require("../util/nibbles.js");
const branch_ts_1 = require("./branch.js");
const extension_ts_1 = require("./extension.js");
const leaf_ts_1 = require("./leaf.js");
function decodeRawMPTNode(raw) {
    if (raw.length === 17) {
        return branch_ts_1.BranchMPTNode.fromArray(raw);
    }
    else if (raw.length === 2) {
        const nibbles = (0, nibbles_ts_1.bytesToNibbles)(raw[0]);
        if ((0, hex_ts_1.isTerminator)(nibbles)) {
            return new leaf_ts_1.LeafMPTNode(leaf_ts_1.LeafMPTNode.decodeKey(nibbles), raw[1]);
        }
        return new extension_ts_1.ExtensionMPTNode(extension_ts_1.ExtensionMPTNode.decodeKey(nibbles), raw[1]);
    }
    else {
        throw (0, util_1.EthereumJSErrorWithoutCode)('Invalid node');
    }
}
function isRawMPTNode(n) {
    return Array.isArray(n) && !(n instanceof Uint8Array);
}
function decodeMPTNode(node) {
    const decodedNode = rlp_1.RLP.decode(Uint8Array.from(node));
    if (!isRawMPTNode(decodedNode)) {
        throw (0, util_1.EthereumJSErrorWithoutCode)('Invalid node');
    }
    return decodeRawMPTNode(decodedNode);
}
//# sourceMappingURL=util.js.map