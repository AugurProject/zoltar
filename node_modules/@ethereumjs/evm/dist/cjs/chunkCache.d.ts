import type { PrefixedHexString } from '@ethereumjs/util';
import type { BinaryChunkAccessEvent } from './binaryTreeAccessWitness.ts';
export declare class ChunkCache {
    cache: Map<PrefixedHexString, BinaryChunkAccessEvent>;
    constructor();
    set(stemKey: PrefixedHexString, accessedStem: BinaryChunkAccessEvent): void;
    get(stemHex: PrefixedHexString): BinaryChunkAccessEvent | undefined;
    del(stemHex: PrefixedHexString): void;
    commit(): [PrefixedHexString, BinaryChunkAccessEvent][];
    clear(): void;
    size(): number;
}
//# sourceMappingURL=chunkCache.d.ts.map