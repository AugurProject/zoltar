import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "preact/jsx-runtime";
import * as appCopy from '../../copy/app.js';
import * as commonCopy from '../../copy/common.js';
import { NoticeStack } from '../../components/NoticeStack.js';
function formatRpcSourceLabel(source) {
    if (source === 'url')
        return appCopy.pageUrl;
    if (source === 'localStorage')
        return appCopy.localStorage;
    if (source === 'environment')
        return appCopy.environment;
    if (source === 'global')
        return appCopy.globalRuntime;
    if (source === 'override')
        return appCopy.explicitOverride;
    return appCopy.defaultSource;
}
function getConfiguredRpcLabel(readBackendStatus) {
    return readBackendStatus.transportMode === 'provider' ? appCopy.configuredFallbackReadRpc : appCopy.activeReadRpc;
}
function getReadBackendNoticeDetail(readBackendMessage) {
    if (readBackendMessage.includes('stale'))
        return `${readBackendMessage} ${appCopy.staleReadBackendDetail}`;
    return `${readBackendMessage} ${appCopy.readWriteNetworkMismatchDetail}`;
}
function buildRpcOverrideNotice(readBackendStatus) {
    if (readBackendStatus === undefined)
        return undefined;
    if (readBackendStatus.rejectedRpcOverride !== undefined) {
        const rejectedOverride = readBackendStatus.rejectedRpcOverride;
        const configuredRpcLabel = getConfiguredRpcLabel(readBackendStatus);
        return {
            detail: appCopy.readRpcOverrideIgnoredDetail,
            id: 'read-rpc-override-ignored',
            technicalDetails: appCopy.formatReadRpcOverrideIgnoredDetail(formatRpcSourceLabel(rejectedOverride.source), rejectedOverride.url, rejectedOverride.reason, configuredRpcLabel, readBackendStatus.rpcUrl),
            tone: 'warning',
            title: appCopy.readRpcOverrideIgnored,
        };
    }
    if (readBackendStatus.rpcSource === 'url')
        return {
            detail: appCopy.customReadRpcWarningDetail,
            id: 'url-read-rpc-override',
            technicalDetails: appCopy.formatReadRpcOverrideFromUrlDetail(getConfiguredRpcLabel(readBackendStatus), readBackendStatus.rpcUrl),
            tone: 'warning',
            title: appCopy.urlProvidedReadRpc,
        };
    if (readBackendStatus.rpcSource === 'default')
        return undefined;
    return {
        detail: appCopy.customReadRpcWarningDetail,
        id: 'read-rpc-override-active',
        technicalDetails: appCopy.formatReadRpcOverrideActiveDetail(getConfiguredRpcLabel(readBackendStatus), formatRpcSourceLabel(readBackendStatus.rpcSource), readBackendStatus.rpcUrl),
        tone: 'pending',
        title: appCopy.readRpcOverrideActive,
    };
}
export function AppStatusNotices({ errorMessage, errorMessages = [], loadingZoltarUniverse = false, onRetryZoltarUniverse, readBackendMessage, readBackendStatus, simulationBootstrapError, showAugurStatoblastDeploymentWarning, zoltarUniverseError }) {
    const items = [];
    const rpcOverrideNotice = buildRpcOverrideNotice(readBackendStatus);
    if (simulationBootstrapError !== undefined)
        items.push({ detail: simulationBootstrapError, id: 'simulation-bootstrap-error', tone: 'blocking', title: appCopy.simulationBootstrapFailed });
    if (showAugurStatoblastDeploymentWarning)
        items.push({ detail: appCopy.deploymentIncompleteReason, id: 'setup-incomplete', tone: 'blocking', title: appCopy.setupIncomplete });
    if (readBackendMessage !== undefined)
        items.push({ detail: getReadBackendNoticeDetail(readBackendMessage), id: 'read-backend-mismatch', tone: 'blocking', title: appCopy.readRpcMismatch });
    if (zoltarUniverseError !== undefined)
        items.push({
            detail: (_jsxs(_Fragment, { children: [_jsx("p", { children: zoltarUniverseError }), onRetryZoltarUniverse === undefined ? undefined : (_jsx("div", { className: 'actions', children: _jsx("button", { type: 'button', className: 'secondary', disabled: loadingZoltarUniverse, onClick: onRetryZoltarUniverse, children: loadingZoltarUniverse ? commonCopy.retrying : commonCopy.retry }) }))] })),
            id: 'zoltar-universe-error',
            tone: 'blocking',
            title: commonCopy.error,
        });
    const distinctErrorMessages = [...new Set([errorMessage, ...errorMessages].filter((message) => message !== undefined))];
    for (const [index, message] of distinctErrorMessages.entries())
        items.push({ detail: message, id: `app-error-${index.toString()}`, tone: 'blocking', title: commonCopy.error });
    if (rpcOverrideNotice !== undefined)
        items.push(rpcOverrideNotice);
    return _jsx(NoticeStack, { items: items });
}
//# sourceMappingURL=AppStatusNotices.js.map