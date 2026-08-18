import type { ComponentChildren } from 'preact';
import type { ListedSecurityPool, SecurityPoolVaultSummary } from '@zoltar/ui-core-shared/types/contracts.js';
type SecurityPoolVaultDirectoryProps = {
    emptyState: ComponentChildren;
    pool: ListedSecurityPool | undefined;
    renderActions?: (vault: SecurityPoolVaultSummary) => ComponentChildren;
    renderBadge?: (vault: SecurityPoolVaultSummary) => ComponentChildren;
    renderTitle?: (vault: SecurityPoolVaultSummary) => ComponentChildren;
    repPerEthPrice: bigint | undefined;
    repPerEthSource: 'mock' | 'v3' | 'v4' | undefined;
    repPerEthSourceUrl: string | undefined;
};
export declare function SecurityPoolVaultDirectory({ emptyState, pool, renderActions, renderBadge, renderTitle, repPerEthPrice, repPerEthSource, repPerEthSourceUrl }: SecurityPoolVaultDirectoryProps): import("preact").JSX.Element;
export {};
//# sourceMappingURL=SecurityPoolVaultDirectory.d.ts.map