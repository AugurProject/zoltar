import * as commonCopy from '../copy/common.js';
import * as userMessagesCopy from '../copy/userMessages.js';
import { assertNever } from './assert.js';
import { getWrongNetworkMessage } from './network.js';
const METRIC_PLACEHOLDER = commonCopy.metricUnavailablePlaceholder;
function createPresentation(key, presentation) {
    return { key, ...presentation };
}
export function getMetricPlaceholderPresentation(value, options) {
    if (value !== undefined)
        return undefined;
    if (options?.loading === true)
        return createPresentation('loading', {
            badgeLabel: commonCopy.loading,
            badgeTone: 'pending',
            placeholder: commonCopy.loadingWithEllipsis,
        });
    return createPresentation('unavailable', {
        placeholder: METRIC_PLACEHOLDER,
    });
}
export function getPoolRegistryPresentation(input) {
    if (input.mode === 'collection') {
        if (input.poolCount > 0)
            return undefined;
        if (input.isLoading)
            return createPresentation('loading', {
                badgeLabel: commonCopy.loading,
                badgeTone: 'pending',
                detail: userMessagesCopy.refreshingPoolRegistryDetail,
                detailIsLoading: true,
            });
        if (!input.hasLoaded)
            return createPresentation('not_checked', {
                badgeLabel: userMessagesCopy.notChecked,
                badgeTone: 'muted',
                detail: userMessagesCopy.uncheckedPoolRegistryDetail,
            });
        return createPresentation('empty', {
            actionHint: userMessagesCopy.emptyPoolRegistryActionHint,
            badgeLabel: commonCopy.none,
            badgeTone: 'muted',
            detail: userMessagesCopy.emptyPoolRegistryDetail,
        });
    }
    switch (input.state) {
        case 'loading':
            return createPresentation('loading', {
                badgeLabel: commonCopy.loading,
                badgeTone: 'pending',
                detail: commonCopy.loadingWithEllipsis,
                detailIsLoading: true,
            });
        case 'unknown':
            return createPresentation('not_checked', {
                badgeLabel: userMessagesCopy.notChecked,
                badgeTone: 'muted',
            });
        case 'missing':
            return createPresentation('not_found', {
                badgeLabel: commonCopy.notFound,
                badgeTone: 'blocked',
            });
        case 'ready':
            return undefined;
        default:
            return assertNever(input.state);
    }
}
export function getUniversePresentation(state) {
    switch (state) {
        case 'loading':
            return createPresentation('loading', {
                badgeLabel: commonCopy.loading,
                badgeTone: 'pending',
                detail: commonCopy.loadingUniverseDetails,
            });
        case 'unknown':
            return createPresentation('not_checked', {
                badgeLabel: userMessagesCopy.notChecked,
                badgeTone: 'muted',
                detail: userMessagesCopy.uncheckedUniverseDetail,
            });
        case 'missing':
            return createPresentation('not_found', {
                actionHint: commonCopy.goToGenesisUniverse,
                badgeLabel: commonCopy.notFound,
                badgeTone: 'blocked',
                detail: userMessagesCopy.missingUniverseDetail,
            });
        case 'ready':
            return undefined;
        default:
            return assertNever(state);
    }
}
export function getWalletPresentation({ accountAddress, hasInjectedWallet, hasWallet, isOnActiveAppChain, isSupportedChain }) {
    const walletAvailable = hasWallet ?? hasInjectedWallet ?? true;
    const supportedChain = isSupportedChain ?? isOnActiveAppChain ?? true;
    if (!walletAvailable)
        return createPresentation('wallet_disconnected', {
            badgeLabel: commonCopy.connectWallet,
            badgeTone: 'blocked',
            detail: userMessagesCopy.walletInstallationRequired,
        });
    if (accountAddress === undefined)
        return createPresentation('wallet_disconnected', {
            badgeLabel: commonCopy.connectWallet,
            badgeTone: 'blocked',
            detail: commonCopy.walletConnectionRequired,
        });
    if (!supportedChain)
        return createPresentation('wrong_network', {
            badgeLabel: userMessagesCopy.wrongNetwork,
            badgeTone: 'blocked',
            detail: getWrongNetworkMessage() ?? commonCopy.mainnetRequiredReason,
        });
    return undefined;
}
export function getReportPresentation({ kind, state }) {
    switch (state) {
        case 'loading':
            return createPresentation('loading', {
                detail: userMessagesCopy.retrieving,
                detailIsLoading: true,
            });
        case 'unknown':
            return undefined;
        case 'missing':
            return createPresentation('not_found', {
                badgeLabel: commonCopy.notFound,
                badgeTone: 'blocked',
                detail: userMessagesCopy.formatMissingLookupDetail(kind),
            });
        case 'ready':
            return undefined;
        default:
            return assertNever(state);
    }
}
//# sourceMappingURL=userCopy.js.map