import { InternalBinaryNode } from './internalNode.ts';
import { StemBinaryNode } from './stemNode.ts';
import { type BinaryNode } from './types.ts';
export declare function decodeRawBinaryNode(raw: Uint8Array[]): BinaryNode;
export declare function decodeBinaryNode(raw: Uint8Array): BinaryNode;
export declare function isRawBinaryNode(node: Uint8Array | Uint8Array[]): node is Uint8Array[];
export declare function isInternalBinaryNode(node: BinaryNode): node is InternalBinaryNode;
export declare function isStemBinaryNode(node: BinaryNode): node is StemBinaryNode;
//# sourceMappingURL=util.d.ts.map