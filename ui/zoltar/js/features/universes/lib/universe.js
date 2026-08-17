import { buildRouteHref, getCurrentRouteHash, getRouteHashSearch } from '@zoltar/ui-core-shared/lib/routing.js';
import { readUniverseQueryParam, writeUniverseQueryParam } from '@zoltar/ui-core-shared/lib/urlParams.js';
import { getGenesisReputationTokenAddress } from '../../../protocol/activeProtocolAddresses.js';
export { getGenesisReputationTokenAddress };
export function formatUniverseLabel(universeId) {
    return universeId === 0n ? `Genesis (${formatUniverseIdHex(universeId)})` : `Universe ${formatUniverseIdHex(universeId)}`;
}
export function formatUniverseDisplayLabel(universeId) {
    const fullLabel = formatUniverseLabel(universeId);
    if (universeId === 0n || fullLabel.length <= 28)
        return fullLabel;
    const universeIdHex = formatUniverseIdHex(universeId);
    return `Universe ${universeIdHex.slice(0, 10)}…${universeIdHex.slice(-6)}`;
}
export function formatUniverseIdHex(universeId) {
    return `0x${universeId.toString(16)}`;
}
export function getUniverseLinkHref(universeId) {
    const nextSearch = writeUniverseQueryParam(getRouteHashSearch(), universeId);
    return buildRouteHref(getCurrentRouteHash(), nextSearch);
}
export function navigateToUniverse(universeId) {
    const currentUniverseId = readUniverseQueryParam(getRouteHashSearch());
    if (currentUniverseId === universeId)
        return;
    window.history.pushState({}, '', getUniverseLinkHref(universeId));
    window.dispatchEvent(new PopStateEvent('popstate'));
}
export function formatUniverseCollectionLabel(universeIds) {
    const uniqueUniverseIds = [...new Set(universeIds)];
    if (uniqueUniverseIds.length === 0)
        return formatUniverseLabel(0n);
    if (uniqueUniverseIds.length === 1) {
        const universeId = uniqueUniverseIds[0];
        if (universeId === undefined)
            return formatUniverseLabel(0n);
        return formatUniverseLabel(universeId);
    }
    return `Multiple (${uniqueUniverseIds.map(formatUniverseIdHex).join(', ')})`;
}
//# sourceMappingURL=universe.js.map