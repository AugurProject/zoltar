import type { ListedSecurityPool } from '@zoltar/ui-core-shared/types/contracts.js';
type ForkActivitySource = Pick<ListedSecurityPool, 'forkOutcome' | 'migratedAttoRep' | 'systemState' | 'truthAuctionStartedAt'>;
export declare function deriveHasForkActivity(source: ForkActivitySource): boolean;
export {};
//# sourceMappingURL=forkActivity.d.ts.map