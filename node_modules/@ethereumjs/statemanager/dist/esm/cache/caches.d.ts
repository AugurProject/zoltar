import { AccountCache } from './account.ts';
import { CodeCache } from './code.ts';
import { StorageCache } from './storage.ts';
import { type CacheOpts, type CachesStateManagerOpts } from './types.ts';
import type { Address } from '@ethereumjs/util';
export declare class Caches {
    account?: AccountCache;
    code?: CodeCache;
    storage?: StorageCache;
    settings: Record<'account' | 'code' | 'storage', CacheOpts>;
    constructor(opts?: CachesStateManagerOpts);
    checkpoint(): void;
    clear(): void;
    commit(): void;
    deleteAccount(address: Address): void;
    shallowCopy(downlevelCaches: boolean): Caches | undefined;
    revert(): void;
}
//# sourceMappingURL=caches.d.ts.map