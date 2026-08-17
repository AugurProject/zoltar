import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "preact/jsx-runtime";
import * as appCopy from '@zoltar/ui-core-shared/copy/app.js';
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js';
import { useState } from 'preact/hooks';
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js';
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js';
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js';
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js';
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js';
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js';
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js';
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js';
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js';
import { UniverseLink } from '../../features/universes/components/UniverseLink.js';
import { getChainDisplayLabel, getChainIdDecimalLabel, getKnownChainName, isActiveAppChain } from '@zoltar/ui-core-shared/lib/network.js';
import { renderRepPriceSourceLabel } from '../../features/open-oracle/lib/repPriceSource.js';
import { getActiveNetworkProfile } from '@zoltar/ui-core-shared/lib/activeEnvironment.js';
import { getNetworkSwitchTarget } from '@zoltar/ui-core-shared/lib/networkProfile.js';
function getWalletNetworkLabel(chainId) {
    if (chainId === undefined)
        return appCopy.unknownNetwork;
    if (chainId === '0xaa36a7')
        return appCopy.sepoliaNetwork;
    const chainLabel = getChainDisplayLabel(chainId);
    if (chainLabel === undefined)
        return appCopy.unknownNetwork;
    const chainName = getKnownChainName(chainId);
    if (chainName === undefined)
        return chainLabel;
    const decimalChainId = getChainIdDecimalLabel(chainId);
    return decimalChainId === undefined ? chainName : appCopy.formatNetworkWithChainId(chainName, decimalChainId);
}
function renderRepPriceFailure(failure) {
    if (failure === undefined)
        return undefined;
    return (_jsx("span", { className: 'currency-value unavailable rep-price-failure', role: 'status', children: failure === 'rpc-error' ? appCopy.repPriceRequestFailed : appCopy.repPriceNoLiquidity }));
}
export function OverviewPanels({ activeUniverseId, accountState, isConnectingWallet, isManagingWallet, isLoadingRepPrices, isRefreshingRepPrices, isLoadingUniverseRepBalance, onConnect, onChangeWallet, onDisconnectWallet, onGoToGenesisUniverse, onRefreshRepPrices, onSwitchNetwork, parentUniverseId, readBackendStatus, repPerEthFailure, repPerEthPrice, repPerEthSource, repPerEthSourceUrl, repUsdcFailure, repUsdcPrice, repUsdcSource, repUsdcSourceUrl, universeForkTime, universeHasForked, universePresentation, universeLabel, universeRepBalanceAttoRep, isRefreshing, walletBootstrapComplete, }) {
    const [showEnvironmentDetails, setShowEnvironmentDetails] = useState(false);
    const effectiveReadBackendStatus = readBackendStatus ?? {
        blockNumber: undefined,
        blockTimestamp: undefined,
        rpcSource: 'default',
        rpcUrl: 'Unavailable',
        transportMode: 'provider',
    };
    const isWalletBootstrapLoading = !walletBootstrapComplete && accountState.address === undefined;
    const isWalletAddressLoading = isConnectingWallet || isWalletBootstrapLoading;
    const shouldShowParentUniverse = parentUniverseId !== undefined && activeUniverseId !== 0n && parentUniverseId !== activeUniverseId;
    const isBrowserSimulationReadBackend = effectiveReadBackendStatus.rpcUrl === 'browser-simulation';
    const activeNetworkProfile = getActiveNetworkProfile();
    const isRepPricingUnavailable = activeNetworkProfile.repPricingMode === 'unavailable';
    const repPricingUnavailableLabel = appCopy.formatRepPricingUnavailable(activeNetworkProfile.displayName);
    const walletOnActiveNetwork = isActiveAppChain(accountState.chainId);
    const hasWrongWalletNetwork = accountState.address !== undefined && !walletOnActiveNetwork && !isBrowserSimulationReadBackend;
    const showAccountBalances = walletBootstrapComplete && accountState.address !== undefined && !hasWrongWalletNetwork;
    const environmentBadge = (() => {
        if (isBrowserSimulationReadBackend)
            return _jsx(Badge, { tone: 'warning', children: appCopy.simulation });
        if (hasWrongWalletNetwork)
            return _jsx(Badge, { tone: 'danger', children: appCopy.formatWrongNetworkBadgeLabel(getChainDisplayLabel(accountState.chainId) ?? appCopy.unknownNetwork) });
        if (accountState.address === undefined)
            return undefined;
        return _jsx(Badge, { tone: 'ok', children: appCopy.connected });
    })();
    const environmentDescription = (() => {
        if (isBrowserSimulationReadBackend)
            return appCopy.simulationNetworkDisclaimer;
        return undefined;
    })();
    const activeNetworkBadge = activeNetworkProfile.id === 'simulation' ? undefined : _jsx(Badge, { children: activeNetworkProfile.displayName });
    const walletNetworkLabel = (() => {
        if (!walletOnActiveNetwork)
            return getWalletNetworkLabel(accountState.chainId);
        if (activeNetworkProfile.id === 'sepolia')
            return appCopy.sepoliaNetwork;
        return appCopy.ethereumMainnet;
    })();
    const accountActions = (() => {
        if (accountState.address === undefined)
            return (_jsx("button", { className: 'secondary', type: 'button', onClick: onConnect, disabled: isConnectingWallet, children: isConnectingWallet ? _jsx(LoadingText, { children: appCopy.connecting }) : commonCopy.connectWallet }));
        if (isBrowserSimulationReadBackend)
            return undefined;
        return (_jsxs("details", { className: 'account-menu', children: [_jsx("summary", { className: 'secondary', children: appCopy.accountMenu }), _jsxs("div", { className: 'account-menu-popover', children: [_jsxs("p", { className: 'account-menu-network', children: [_jsx("span", { children: appCopy.currentNetwork }), _jsx("strong", { children: walletNetworkLabel })] }), _jsx("button", { className: 'secondary', type: 'button', onClick: onChangeWallet, disabled: isManagingWallet, children: appCopy.changeWallet }), hasWrongWalletNetwork ? (_jsx("button", { className: 'primary', type: 'button', onClick: onSwitchNetwork, disabled: isManagingWallet, children: appCopy.formatSwitchToNetwork(getNetworkSwitchTarget(getActiveNetworkProfile())) })) : undefined, _jsx("button", { className: 'quiet', type: 'button', onClick: onDisconnectWallet, disabled: isManagingWallet, children: isManagingWallet ? appCopy.managingWallet : appCopy.disconnectWallet })] })] }));
    })();
    const operationsHeaderDescription = (() => {
        const forkDescription = (() => {
            if (!universeHasForked)
                return undefined;
            if (universeForkTime === undefined)
                return appCopy.universeForkedDetail;
            return (_jsxs(_Fragment, { children: [appCopy.zoltarForkedOn, " ", _jsx(TimestampValue, { timestamp: universeForkTime }), "."] }));
        })();
        if (environmentDescription === undefined)
            return forkDescription;
        if (forkDescription === undefined)
            return environmentDescription;
        return (_jsxs(_Fragment, { children: [environmentDescription, " ", forkDescription] }));
    })();
    return (_jsx("section", { className: 'overview-shell', children: _jsxs("article", { className: `overview-panel overview-wallet-panel${isBrowserSimulationReadBackend ? ' is-simulation' : ''}`, children: [_jsx(RouteHeader, { actions: accountActions, badge: _jsxs("span", { className: 'environment-badge-row', children: [activeNetworkBadge, environmentBadge, universeHasForked ? _jsx(Badge, { tone: 'warning', children: commonCopy.forked }) : undefined] }), description: operationsHeaderDescription, eyebrow: appCopy.operations, title: appCopy.augurStatoblastTitle }), _jsxs(DataGrid, { className: `overview-inline-metrics ${showEnvironmentDetails ? 'mobile-expanded' : ''}`.trim(), columns: 'auto', children: [_jsx(MetricField, { className: 'overview-address-metric', label: appCopy.address, children: (() => {
                                if (isWalletAddressLoading)
                                    return (_jsxs("span", { className: 'loading-value', children: [_jsx("span", { className: 'spinner', "aria-hidden": 'true' }), appCopy.connecting] }));
                                if (accountState.address === undefined)
                                    return appCopy.notConnected;
                                return _jsx(AddressValue, { address: accountState.address, responsiveAbbreviation: true });
                            })() }), showAccountBalances ? (_jsxs(_Fragment, { children: [_jsx(MetricField, { className: 'overview-simulation-secondary', label: commonCopy.eth, children: _jsx(CurrencyValue, { value: accountState.ethBalanceAttoEth, loading: isRefreshing && accountState.ethBalanceAttoEth === undefined, suffix: commonCopy.eth, compactWhenOverflow: true }) }), _jsx(MetricField, { className: 'overview-metric-secondary', label: commonCopy.weth, children: _jsx(CurrencyValue, { value: accountState.wethBalanceAttoEth, loading: isRefreshing && accountState.wethBalanceAttoEth === undefined, suffix: commonCopy.weth, compactWhenOverflow: true }) }), _jsx(MetricField, { className: 'overview-simulation-secondary', label: commonCopy.rep, children: _jsx(CurrencyValue, { value: universeRepBalanceAttoRep, loading: isLoadingUniverseRepBalance, suffix: commonCopy.rep, compactWhenOverflow: true }) })] })) : undefined, _jsx(MetricField, { className: 'overview-metric-secondary', label: _jsxs("span", { className: 'metric-label-with-action', children: [_jsxs("span", { children: [appCopy.repPerEthCompact, " ", renderRepPriceSourceLabel(repPerEthSource, repPerEthSourceUrl)] }), isRepPricingUnavailable ? undefined : (_jsx("button", { type: 'button', className: 'quiet metric-label-refresh', onClick: onRefreshRepPrices, disabled: isRefreshingRepPrices, "aria-label": appCopy.refreshRepPrices, title: isRefreshingRepPrices ? appCopy.refreshingRepPrices : appCopy.refreshRepPrices, children: "\u21BB" }))] }), children: isRepPricingUnavailable ? repPricingUnavailableLabel : (renderRepPriceFailure(repPerEthPrice === undefined && !isLoadingRepPrices ? repPerEthFailure : undefined) ?? _jsx(CurrencyValue, { value: repPerEthPrice, loading: isLoadingRepPrices, copyable: false })) }), _jsx(MetricField, { className: 'overview-metric-secondary', label: _jsxs(_Fragment, { children: [appCopy.repUsdc, " ", renderRepPriceSourceLabel(repUsdcSource, repUsdcSourceUrl)] }), children: isRepPricingUnavailable ? repPricingUnavailableLabel : (renderRepPriceFailure(repUsdcPrice === undefined && !isLoadingRepPrices ? repUsdcFailure : undefined) ?? _jsx(CurrencyValue, { value: repUsdcPrice, loading: isLoadingRepPrices, suffix: appCopy.usdc, units: 6 })) }), _jsx(MetricField, { className: 'overview-universe-metric', label: commonCopy.universe, children: universeLabel }), shouldShowParentUniverse ? (_jsx(MetricField, { className: 'overview-metric-secondary', label: appCopy.parentUniverse, children: _jsx(UniverseLink, { universeId: parentUniverseId }) })) : undefined] }), _jsx("button", { className: 'overview-details-toggle secondary', type: 'button', "aria-expanded": showEnvironmentDetails, onClick: () => setShowEnvironmentDetails(current => !current), children: showEnvironmentDetails ? appCopy.hideEnvironmentDetails : appCopy.showEnvironmentDetails }), universePresentation === undefined ? undefined : (_jsx(StateHint, { className: 'overview-universe-state', presentation: universePresentation, actions: _jsx("button", { className: 'secondary', onClick: onGoToGenesisUniverse, children: commonCopy.goToGenesisUniverse }) }))] }) }));
}
//# sourceMappingURL=OverviewPanels.js.map