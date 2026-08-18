import { useEffect, useRef } from 'preact/hooks';
import { normalizeAddress } from '@zoltar/ui-core-shared/lib/address.js';
export function shouldLoadOpenOracleReportFromUrl({ environmentReady, route, urlOpenOracleReportId }) {
    return environmentReady && route === 'open-oracle' && urlOpenOracleReportId !== '';
}
export function shouldRefreshSelectedPoolForRoute({ environmentReady, route, securityPoolAddress, selectedPoolSecurityPoolAddress, walletBootstrapComplete }) {
    return environmentReady && route === 'security-pools' && walletBootstrapComplete && securityPoolAddress !== '' && selectedPoolSecurityPoolAddress === undefined;
}
export function shouldSyncSecurityPoolAddressToRouteForms({ route }) {
    return route === 'security-pools';
}
export function getSelectedVaultOwnerForRoutePoolChange({ accountAddress, lastSecurityPoolAddress, route, securityPoolAddress }) {
    if (route !== 'security-pools')
        return undefined;
    const normalizedSecurityPoolAddress = normalizeAddress(securityPoolAddress) ?? '';
    const normalizedLastSecurityPoolAddress = normalizeAddress(lastSecurityPoolAddress);
    if (normalizedSecurityPoolAddress === normalizedLastSecurityPoolAddress)
        return undefined;
    if (normalizedSecurityPoolAddress === '')
        return '';
    return accountAddress?.toString() ?? '';
}
export function useAppRouteEffects({ accountAddress, augurStatoblastDeploymentMissing, activeEnvironmentNonce, environmentReady, loadOracleReport, loadSecurityPools, navigate, resetSecurityPoolCreation, route, securityPoolAddress, securityPoolQuestionId, securityPoolResultHash, selectedPoolSecurityPoolAddress, setForkAuctionFormSecurityPoolAddress, setOpenOracleFormReportId, setReportingFormSecurityPoolAddress, setSecurityVaultFormSelectedVaultOwner, setSecurityVaultFormSecurityPoolAddress, setSecurityPoolFormMarketId, setTradingFormSecurityPoolAddress, tradingResultHash, urlOpenOracleReportId, walletBootstrapComplete, }) {
    const loadOracleReportRef = useRef(loadOracleReport);
    const loadSecurityPoolsRef = useRef(loadSecurityPools);
    const navigateRef = useRef(navigate);
    const lastRequestedOpenOracleReportId = useRef(undefined);
    const lastRequestedSecurityPoolAddress = useRef(undefined);
    const lastSelectedPoolEnvironmentNonce = useRef(undefined);
    const lastSelectedSecurityPoolAddress = useRef(undefined);
    const lastSyncedOpenOracleReportId = useRef(undefined);
    const lastSyncedSecurityPoolQuestionId = useRef(undefined);
    loadOracleReportRef.current = loadOracleReport;
    loadSecurityPoolsRef.current = loadSecurityPools;
    navigateRef.current = navigate;
    useEffect(() => {
        if (route !== 'open-oracle') {
            lastSyncedOpenOracleReportId.current = undefined;
            return;
        }
        const normalizedReportId = urlOpenOracleReportId.trim();
        if (lastSyncedOpenOracleReportId.current === normalizedReportId)
            return;
        lastSyncedOpenOracleReportId.current = normalizedReportId;
        setOpenOracleFormReportId(normalizedReportId);
    }, [route, setOpenOracleFormReportId, urlOpenOracleReportId]);
    useEffect(() => {
        const shouldLoadReport = shouldLoadOpenOracleReportFromUrl({ environmentReady, route, urlOpenOracleReportId });
        if (!shouldLoadReport) {
            lastRequestedOpenOracleReportId.current = undefined;
            return;
        }
        const requestKey = `${activeEnvironmentNonce}:${urlOpenOracleReportId}`;
        if (lastRequestedOpenOracleReportId.current === requestKey)
            return;
        lastRequestedOpenOracleReportId.current = requestKey;
        void loadOracleReportRef.current(urlOpenOracleReportId);
    }, [activeEnvironmentNonce, environmentReady, route, urlOpenOracleReportId]);
    useEffect(() => {
        if (route !== 'security-pools') {
            lastSyncedSecurityPoolQuestionId.current = undefined;
            return;
        }
        if (lastSyncedSecurityPoolQuestionId.current === securityPoolQuestionId)
            return;
        lastSyncedSecurityPoolQuestionId.current = securityPoolQuestionId;
        resetSecurityPoolCreation();
        setSecurityPoolFormMarketId(securityPoolQuestionId);
    }, [resetSecurityPoolCreation, route, securityPoolQuestionId, setSecurityPoolFormMarketId]);
    useEffect(() => {
        if (!shouldSyncSecurityPoolAddressToRouteForms({ route, securityPoolAddress }))
            return;
        setSecurityVaultFormSecurityPoolAddress(securityPoolAddress);
        setTradingFormSecurityPoolAddress(securityPoolAddress);
        setForkAuctionFormSecurityPoolAddress(securityPoolAddress);
        setReportingFormSecurityPoolAddress(securityPoolAddress);
    }, [route, securityPoolAddress, setForkAuctionFormSecurityPoolAddress, setReportingFormSecurityPoolAddress, setSecurityVaultFormSecurityPoolAddress, setTradingFormSecurityPoolAddress]);
    useEffect(() => {
        const nextSelectedVaultOwner = getSelectedVaultOwnerForRoutePoolChange({
            accountAddress,
            lastSecurityPoolAddress: lastSelectedSecurityPoolAddress.current,
            route,
            securityPoolAddress,
        });
        if (nextSelectedVaultOwner !== undefined)
            setSecurityVaultFormSelectedVaultOwner(nextSelectedVaultOwner);
        if (route !== 'security-pools') {
            lastSelectedSecurityPoolAddress.current = undefined;
            return;
        }
        lastSelectedSecurityPoolAddress.current = normalizeAddress(securityPoolAddress) ?? '';
    }, [accountAddress, route, securityPoolAddress, setSecurityVaultFormSelectedVaultOwner]);
    useEffect(() => {
        const previousEnvironmentNonce = lastSelectedPoolEnvironmentNonce.current;
        if (previousEnvironmentNonce === undefined)
            lastSelectedPoolEnvironmentNonce.current = activeEnvironmentNonce;
        const selectedPoolEnvironmentChanged = previousEnvironmentNonce !== undefined && previousEnvironmentNonce !== activeEnvironmentNonce;
        if (!selectedPoolEnvironmentChanged &&
            !shouldRefreshSelectedPoolForRoute({
                environmentReady,
                route,
                securityPoolAddress,
                selectedPoolSecurityPoolAddress,
                walletBootstrapComplete,
            })) {
            if (route !== 'security-pools' || securityPoolAddress === '' || selectedPoolSecurityPoolAddress !== undefined || !environmentReady || !walletBootstrapComplete)
                lastRequestedSecurityPoolAddress.current = undefined;
            return;
        }
        if (!environmentReady || route !== 'security-pools' || securityPoolAddress === '' || !walletBootstrapComplete)
            return;
        const requestKey = `${activeEnvironmentNonce}:${securityPoolAddress}`;
        if (lastRequestedSecurityPoolAddress.current === requestKey)
            return;
        lastRequestedSecurityPoolAddress.current = requestKey;
        lastSelectedPoolEnvironmentNonce.current = activeEnvironmentNonce;
        void loadSecurityPoolsRef.current(securityPoolAddress);
    }, [activeEnvironmentNonce, environmentReady, route, securityPoolAddress, selectedPoolSecurityPoolAddress, walletBootstrapComplete]);
    useEffect(() => {
        if (!environmentReady)
            return;
        if (route !== 'security-pools')
            return;
        if (securityPoolResultHash === undefined)
            return;
        void loadSecurityPoolsRef.current(securityPoolAddress === '' ? undefined : securityPoolAddress);
    }, [environmentReady, route, securityPoolAddress, securityPoolResultHash]);
    useEffect(() => {
        if (!environmentReady)
            return;
        if (route !== 'security-pools')
            return;
        if (tradingResultHash === undefined)
            return;
        void loadSecurityPoolsRef.current(securityPoolAddress);
    }, [environmentReady, route, securityPoolAddress, tradingResultHash]);
    useEffect(() => {
        if (!augurStatoblastDeploymentMissing)
            return;
        if (route === 'deploy')
            return;
        navigateRef.current('deploy');
    }, [augurStatoblastDeploymentMissing, route]);
}
//# sourceMappingURL=useAppRouteEffects.js.map