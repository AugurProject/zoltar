import { jsx as _jsx, jsxs as _jsxs } from "preact/jsx-runtime";
import { SecurityPoolSection } from './SecurityPoolSection.js';
import { SecurityPoolWorkflowSection } from './SecurityPoolWorkflowSection.js';
import { SecurityPoolsOverviewSection } from './SecurityPoolsOverviewSection.js';
import { sameCaseInsensitiveText } from '@zoltar/ui-core-shared/lib/caseInsensitive.js';
export function shouldRefreshSelectedPoolDataOnViewOpen({ currentSecurityPoolAddress, nextSecurityPoolAddress, nextView, selectedPoolHasLoadedDetails }) {
    if (nextView !== 'operate')
        return false;
    const resolvedSecurityPoolAddress = nextSecurityPoolAddress ?? currentSecurityPoolAddress;
    return resolvedSecurityPoolAddress.trim() !== '' && !selectedPoolHasLoadedDetails;
}
export function SecurityPoolsSection({ activeView, createPool, onActiveUniverseChange, onActiveViewChange, overview, workflow }) {
    const view = activeView;
    const openView = (nextView, nextSecurityPoolAddress) => {
        onActiveViewChange(nextView);
        const resolvedSecurityPoolAddress = nextSecurityPoolAddress ?? workflow.securityPoolAddress;
        const selectedPool = overview.securityPools.find(pool => sameCaseInsensitiveText(pool.securityPoolAddress, resolvedSecurityPoolAddress));
        const selectedPoolHasLoadedDetails = selectedPool !== undefined && selectedPool.hasLoadedVaults !== false;
        if (!shouldRefreshSelectedPoolDataOnViewOpen({ currentSecurityPoolAddress: workflow.securityPoolAddress, nextSecurityPoolAddress, nextView, selectedPoolHasLoadedDetails }))
            return;
        workflow.onRefreshSelectedPoolData(resolvedSecurityPoolAddress);
    };
    return (_jsxs("div", { className: 'route-view-flow', children: [view === 'browse' ? (_jsx(SecurityPoolsOverviewSection, { ...overview, onSelectSecurityPool: (securityPoolAddress, universeId) => {
                    onActiveUniverseChange?.(universeId);
                    workflow.onSecurityPoolAddressChange(securityPoolAddress);
                    openView('operate', securityPoolAddress);
                } })) : undefined, view === 'create' ? (_jsx(SecurityPoolSection, { ...createPool, onReturnToBrowse: () => openView('browse'), showHeader: false, onOpenCreatedPool: (securityPoolAddress, universeId) => {
                    onActiveUniverseChange?.(universeId);
                    workflow.onSecurityPoolAddressChange(securityPoolAddress);
                    openView('operate', securityPoolAddress);
                } })) : undefined, view === 'operate' ? _jsx(SecurityPoolWorkflowSection, { ...workflow, showHeader: false }) : undefined] }));
}
//# sourceMappingURL=SecurityPoolsSection.js.map