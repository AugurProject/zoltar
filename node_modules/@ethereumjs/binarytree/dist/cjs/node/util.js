"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeRawBinaryNode = decodeRawBinaryNode;
exports.decodeBinaryNode = decodeBinaryNode;
exports.isRawBinaryNode = isRawBinaryNode;
exports.isInternalBinaryNode = isInternalBinaryNode;
exports.isStemBinaryNode = isStemBinaryNode;
const rlp_1 = require("@ethereumjs/rlp");
const util_1 = require("@ethereumjs/util");
const internalNode_ts_1 = require("./internalNode.js");
const stemNode_ts_1 = require("./stemNode.js");
const types_ts_1 = require("./types.js");
function decodeRawBinaryNode(raw) {
    const nodeType = raw[0][0];
    switch (nodeType) {
        case types_ts_1.BinaryNodeType.Internal:
            return internalNode_ts_1.InternalBinaryNode.fromRawNode(raw);
        case types_ts_1.BinaryNodeType.Stem:
            return stemNode_ts_1.StemBinaryNode.fromRawNode(raw);
        default:
            throw (0, util_1.EthereumJSErrorWithoutCode)('Invalid node type');
    }
}
function decodeBinaryNode(raw) {
    const decoded = rlp_1.RLP.decode(Uint8Array.from(raw));
    if (!Array.isArray(decoded)) {
        throw (0, util_1.EthereumJSErrorWithoutCode)('Invalid node');
    }
    return decodeRawBinaryNode(decoded);
}
function isRawBinaryNode(node) {
    return Array.isArray(node) && !(node instanceof Uint8Array);
}
function isInternalBinaryNode(node) {
    return node.type === types_ts_1.BinaryNodeType.Internal;
}
function isStemBinaryNode(node) {
    return node.type === types_ts_1.BinaryNodeType.Stem;
}
//# sourceMappingURL=util.js.map