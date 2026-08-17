import { useEffect, useRef } from 'preact/hooks';
export function shouldLoadOpenOracleReportFromUrl({ environmentReady, route, urlOpenOracleReportId }) {
    return environmentReady && route === 'open-oracle' && urlOpenOracleReportId !== '';
}
export function useAppRouteEffects({ augurStatoblastDeploymentMissing, activeEnvironmentNonce, environmentReady, loadOracleReport, navigate, route, setOpenOracleFormReportId, urlOpenOracleReportId }) {
    const loadOracleReportRef = useRef(loadOracleReport);
    const navigateRef = useRef(navigate);
    const lastRequestedOpenOracleReportId = useRef(undefined);
    const lastSyncedOpenOracleReportId = useRef(undefined);
    loadOracleReportRef.current = loadOracleReport;
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
        if (!augurStatoblastDeploymentMissing)
            return;
        if (route === 'deploy')
            return;
        navigateRef.current('deploy');
    }, [augurStatoblastDeploymentMissing, route]);
}
//# sourceMappingURL=useAppRouteEffects.js.map