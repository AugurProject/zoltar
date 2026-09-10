import { ExtensionOrLeafMPTNodeBase } from './extensionOrLeafNodeBase.ts';
import type { Nibbles, RawLeafMPTNode } from '../types.ts';
export declare class LeafMPTNode extends ExtensionOrLeafMPTNodeBase {
    constructor(nibbles: Nibbles, value: Uint8Array);
    raw(): RawLeafMPTNode;
}
//# sourceMappingURL=leaf.d.ts.map