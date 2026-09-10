import { ExtensionOrLeafMPTNodeBase } from './extensionOrLeafNodeBase.ts';
import type { Nibbles, RawExtensionMPTNode } from '../types.ts';
export declare class ExtensionMPTNode extends ExtensionOrLeafMPTNodeBase {
    constructor(nibbles: Nibbles, value: Uint8Array);
    raw(): RawExtensionMPTNode;
}
//# sourceMappingURL=extension.d.ts.map