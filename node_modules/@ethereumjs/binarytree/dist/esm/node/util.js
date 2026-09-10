import { RLP } from '@ethereumjs/rlp';
import { EthereumJSErrorWithoutCode } from '@ethereumjs/util';
import { InternalBinaryNode } from "./internalNode.js";
import { StemBinaryNode } from "./stemNode.js";
import { BinaryNodeType } from "./types.js";
export function decodeRawBinaryNode(raw) {
    const nodeType = raw[0][0];
    switch (nodeType) {
        case BinaryNodeType.Internal:
            return InternalBinaryNode.fromRawNode(raw);
        case BinaryNodeType.Stem:
            return StemBinaryNode.fromRawNode(raw);
        default:
            throw EthereumJSErrorWithoutCode('Invalid node type');
    }
}
export function decodeBinaryNode(raw) {
    const decoded = RLP.decode(Uint8Array.from(raw));
    if (!Array.isArray(decoded)) {
        throw EthereumJSErrorWithoutCode('Invalid node');
    }
    return decodeRawBinaryNode(decoded);
}
export function isRawBinaryNode(node) {
    return Array.isArray(node) && !(node instanceof Uint8Array);
}
export function isInternalBinaryNode(node) {
    return node.type === BinaryNodeType.Internal;
}
export function isStemBinaryNode(node) {
    return node.type === BinaryNodeType.Stem;
}
//# sourceMappingURL=util.js.map