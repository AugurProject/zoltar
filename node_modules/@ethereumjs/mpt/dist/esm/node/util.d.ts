import { type NestedUint8Array } from '@ethereumjs/util';
import { BranchMPTNode } from './branch.ts';
import { ExtensionMPTNode } from './extension.ts';
import { LeafMPTNode } from './leaf.ts';
export declare function decodeRawMPTNode(raw: Uint8Array[]): BranchMPTNode | ExtensionMPTNode | LeafMPTNode;
export declare function isRawMPTNode(n: Uint8Array | NestedUint8Array): n is Uint8Array[];
export declare function decodeMPTNode(node: Uint8Array): BranchMPTNode | ExtensionMPTNode | LeafMPTNode;
//# sourceMappingURL=util.d.ts.map