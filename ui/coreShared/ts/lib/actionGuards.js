import * as commonCopy from '../copy/common.js';
import { getWrongNetworkMessage } from './network.js';
function getWalletRequiredReason(walletRequiredReason) {
    return walletRequiredReason ?? commonCopy.walletConnectionRequired;
}
export function getWalletActiveAppChainGuardState({ accountAddress, isOnActiveAppChain, walletRequiredReason }) {
    if (accountAddress === undefined)
        return { blocked: true, reason: getWalletRequiredReason(walletRequiredReason) };
    if (!isOnActiveAppChain)
        return { blocked: true, reason: getWrongNetworkMessage() ?? commonCopy.mainnetRequiredReason };
    return { blocked: false, reason: undefined };
}
export function getWalletActiveAppChainGuardMessage(parameters) {
    const guardState = getWalletActiveAppChainGuardState(parameters);
    return guardState.reason;
}
export function getWalletConnectionActiveAppChainGuardState({ isOnActiveAppChain, walletConnected, walletRequiredReason }) {
    if (!walletConnected)
        return { blocked: true, reason: getWalletRequiredReason(walletRequiredReason) };
    if (!isOnActiveAppChain)
        return { blocked: true, reason: getWrongNetworkMessage() ?? commonCopy.mainnetRequiredReason };
    return { blocked: false, reason: undefined };
}
export function getWalletActiveAppChainActionAvailability({ accountAddress, isOnActiveAppChain, walletRequiredReason }) {
    const guardState = getWalletActiveAppChainGuardState({ accountAddress, isOnActiveAppChain, walletRequiredReason });
    if (!guardState.blocked)
        return undefined;
    return { disabled: true, reason: guardState.reason };
}
//# sourceMappingURL=actionGuards.js.map