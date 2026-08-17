import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "preact/jsx-runtime";
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import * as commonCopy from '../copy/common.js';
import { getActiveBackend } from '../lib/activeEnvironment.js';
import { useRequestGuard } from '../lib/requestGuard.js';
import { normalizeWalletAssetFailure, watchActiveWalletAsset } from '../lib/walletAsset.js';
import { AddressValue } from './AddressValue.js';
import { LoadingText } from './LoadingText.js';
import { getWrongNetworkMessage } from '../lib/network.js';
import { sameAddress } from '../lib/address.js';
function getErrorMessage(result) {
    if (result.status === 'wrong-network')
        return getWrongNetworkMessage() ?? commonCopy.mainnetRequiredReason;
    if (result.status === 'unsupported')
        return commonCopy.walletAssetAutomaticImportUnavailable;
    if (result.status === 'unavailable')
        return commonCopy.walletAssetUnavailable;
    if (result.status === 'failed')
        return commonCopy.walletAssetRequestFailed;
    return undefined;
}
export function WalletAssetControl({ accountAddress, address, isSupportedChain, onWatchAsset = watchActiveWalletAsset, tokenLabel }) {
    const currentScope = useRef({ accountAddress, address, generation: 0, isSupportedChain });
    if (!sameAddress(currentScope.current.accountAddress, accountAddress) || !sameAddress(currentScope.current.address, address) || currentScope.current.isSupportedChain !== isSupportedChain)
        currentScope.current = { accountAddress, address, generation: currentScope.current.generation + 1, isSupportedChain };
    const scopeGeneration = currentScope.current.generation;
    const [storedState, setState] = useState({ scopeGeneration, status: 'idle' });
    const state = storedState.scopeGeneration === scopeGeneration ? storedState : { status: 'idle' };
    const networkRequirementId = useId();
    const backend = getActiveBackend();
    const walletImportAvailable = accountAddress !== undefined && backend.id === 'injected' && backend.hasWallet() && backend.getProvider() !== undefined;
    const nextWatchAssetRequest = useRequestGuard();
    useEffect(() => () => {
        nextWatchAssetRequest();
    }, [nextWatchAssetRequest]);
    if (!walletImportAvailable)
        return _jsx(AddressValue, { address: address });
    const handleWatchAsset = async () => {
        if (state.status === 'pending' || state.status === 'accepted' || !isSupportedChain)
            return;
        const isCurrent = nextWatchAssetRequest();
        const isCurrentScope = () => isCurrent() && currentScope.current.generation === scopeGeneration;
        setState({ scopeGeneration, status: 'pending' });
        let result;
        try {
            result = await onWatchAsset(address, accountAddress, isCurrentScope);
        }
        catch (error) {
            result = normalizeWalletAssetFailure(error);
        }
        if (!isCurrentScope())
            return;
        if (result.status === 'accepted') {
            setState({ scopeGeneration, status: 'accepted' });
            return;
        }
        const errorMessage = getErrorMessage(result);
        setState(errorMessage === undefined ? { scopeGeneration, status: 'idle' } : { message: errorMessage, scopeGeneration, status: 'error' });
    };
    const actionLabel = (() => {
        if (state.status === 'accepted')
            return commonCopy.walletAssetRequestAccepted;
        if (state.status === 'error')
            return commonCopy.retry;
        return commonCopy.addToWallet;
    })();
    const accessibleActionLabel = (() => {
        if (state.status === 'accepted')
            return commonCopy.formatWalletAssetRequestAccepted(tokenLabel);
        if (state.status === 'pending')
            return commonCopy.formatOpeningWalletForToken(tokenLabel);
        if (state.status === 'error')
            return commonCopy.formatRetryWalletAssetRequest(tokenLabel);
        return commonCopy.formatAddTokenToWallet(tokenLabel);
    })();
    const actionIcon = (() => {
        if (state.status === 'accepted')
            return '✓';
        if (state.status === 'error')
            return '↻';
        return '+';
    })();
    return (_jsxs("span", { className: 'wallet-asset-control', children: [_jsx(AddressValue, { address: address }), _jsx("button", { "aria-describedby": isSupportedChain ? undefined : networkRequirementId, "aria-label": accessibleActionLabel, className: `wallet-asset-action wallet-asset-action-${state.status}`, disabled: !isSupportedChain || state.status === 'pending' || state.status === 'accepted', onClick: () => void handleWatchAsset(), type: 'button', children: state.status === 'pending' ? (_jsx(LoadingText, { children: commonCopy.openingWallet })) : (_jsxs(_Fragment, { children: [_jsx("span", { "aria-hidden": 'true', className: 'wallet-asset-action-icon', children: actionIcon }), _jsx("span", { children: actionLabel })] })) }), isSupportedChain ? undefined : (_jsx("span", { className: 'wallet-asset-prerequisite', id: networkRequirementId, children: getWrongNetworkMessage() ?? commonCopy.mainnetRequiredReason })), state.status === 'accepted' ? (_jsx("span", { "aria-live": 'polite', className: 'visually-hidden', role: 'status', children: commonCopy.formatWalletAssetRequestAccepted(tokenLabel) })) : undefined, state.status === 'error' ? (_jsx("span", { "aria-live": 'assertive', className: 'wallet-asset-feedback', role: 'alert', children: state.message })) : undefined] }));
}
//# sourceMappingURL=WalletAssetControl.js.map