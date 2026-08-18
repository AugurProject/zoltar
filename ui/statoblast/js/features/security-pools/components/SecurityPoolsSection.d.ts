import type { SecurityPoolsSectionProps, SecurityPoolsView } from '../../types.js';
export declare function shouldRefreshSelectedPoolDataOnViewOpen({ currentSecurityPoolAddress, nextSecurityPoolAddress, nextView, selectedPoolHasLoadedDetails }: {
    currentSecurityPoolAddress: string;
    nextSecurityPoolAddress?: string | undefined;
    nextView: SecurityPoolsView;
    selectedPoolHasLoadedDetails: boolean;
}): boolean;
export declare function SecurityPoolsSection({ activeView, createPool, onActiveUniverseChange, onActiveViewChange, overview, workflow }: SecurityPoolsSectionProps): import("preact").JSX.Element;
//# sourceMappingURL=SecurityPoolsSection.d.ts.map