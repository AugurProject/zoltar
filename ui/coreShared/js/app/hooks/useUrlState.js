import { useSignal } from '@preact/signals';
import { useCallback, useEffect } from 'preact/hooks';
import { buildRouteHref, getCurrentRouteHash, getRouteHashSearch } from '../../lib/routing.js';
import { readOpenOracleViewQueryParam, readOpenOracleReportIdQueryParam, readSecurityPoolsViewQueryParam, readSecurityPoolQuestionIdQueryParam, readSecurityPoolQueryParam, readSelectedPoolViewQueryParam, readUniverseQueryParam, readZoltarViewQueryParam, writeOpenOracleViewQueryParam, writeOpenOracleReportIdQueryParam, writeSecurityPoolsViewQueryParam, writeSecurityPoolQuestionIdQueryParam, writeSecurityPoolQueryParam, writeSelectedPoolViewQueryParam, writeUniverseQueryParam, writeZoltarViewQueryParam, } from '../../lib/urlParams.js';
function readUrlState(search) {
    return {
        activeUniverseId: readUniverseQueryParam(search) ?? 0n,
        openOracleView: readOpenOracleViewQueryParam(search) ?? '',
        openOracleReportId: readOpenOracleReportIdQueryParam(search) ?? '',
        securityPoolsView: readSecurityPoolsViewQueryParam(search) ?? '',
        selectedPoolView: readSelectedPoolViewQueryParam(search) ?? '',
        securityPoolAddress: readSecurityPoolQueryParam(search) ?? '',
        securityPoolQuestionId: readSecurityPoolQuestionIdQueryParam(search) ?? '',
        zoltarView: readZoltarViewQueryParam(search) ?? '',
    };
}
function getCurrentUrlStateSearch() {
    return getRouteHashSearch();
}
function readCurrentUrlState() {
    return readUrlState(getCurrentUrlStateSearch());
}
function pushCurrentUrl(nextSearch) {
    window.history.pushState({}, '', buildRouteHref(getCurrentRouteHash(), nextSearch));
}
export function useUrlState() {
    const urlState = useSignal(readCurrentUrlState());
    useEffect(() => {
        const syncUrlState = () => {
            urlState.value = readCurrentUrlState();
        };
        window.addEventListener('hashchange', syncUrlState);
        window.addEventListener('popstate', syncUrlState);
        return () => {
            window.removeEventListener('hashchange', syncUrlState);
            window.removeEventListener('popstate', syncUrlState);
        };
    }, []);
    const applyUrlStateUpdate = useCallback((nextSearch) => {
        if (nextSearch === getCurrentUrlStateSearch())
            return;
        pushCurrentUrl(nextSearch);
        urlState.value = readUrlState(nextSearch);
    }, []);
    const setActiveUniverseId = useCallback((universeId) => {
        const nextSearch = writeUniverseQueryParam(getCurrentUrlStateSearch(), universeId);
        applyUrlStateUpdate(nextSearch);
    }, [applyUrlStateUpdate]);
    const setSecurityPoolAddress = useCallback((securityPoolAddress) => {
        const nextSearch = writeSecurityPoolQueryParam(getCurrentUrlStateSearch(), securityPoolAddress === '' ? undefined : securityPoolAddress);
        applyUrlStateUpdate(nextSearch);
    }, [applyUrlStateUpdate]);
    const setSecurityPoolQuestionId = useCallback((questionId) => {
        const nextSearch = writeSecurityPoolQuestionIdQueryParam(getCurrentUrlStateSearch(), questionId === '' ? undefined : questionId);
        applyUrlStateUpdate(nextSearch);
    }, [applyUrlStateUpdate]);
    const setOpenOracleReport = useCallback((reportId) => {
        const nextSearch = writeOpenOracleReportIdQueryParam(getCurrentUrlStateSearch(), reportId === '' ? undefined : reportId);
        applyUrlStateUpdate(nextSearch);
    }, [applyUrlStateUpdate]);
    const setOpenOracleView = useCallback((view) => {
        const nextSearch = writeOpenOracleViewQueryParam(getCurrentUrlStateSearch(), view === '' ? undefined : view);
        applyUrlStateUpdate(nextSearch);
    }, [applyUrlStateUpdate]);
    const setSecurityPoolsView = useCallback((view) => {
        const nextSearch = writeSecurityPoolsViewQueryParam(getCurrentUrlStateSearch(), view === '' ? undefined : view);
        applyUrlStateUpdate(nextSearch);
    }, [applyUrlStateUpdate]);
    const setSelectedPoolView = useCallback((view) => {
        const nextSearch = writeSelectedPoolViewQueryParam(getCurrentUrlStateSearch(), view === '' ? undefined : view);
        applyUrlStateUpdate(nextSearch);
    }, [applyUrlStateUpdate]);
    const setZoltarView = useCallback((view) => {
        const nextSearch = writeZoltarViewQueryParam(getCurrentUrlStateSearch(), view === '' ? undefined : view);
        applyUrlStateUpdate(nextSearch);
    }, [applyUrlStateUpdate]);
    return {
        activeUniverseId: urlState.value.activeUniverseId,
        openOracleView: urlState.value.openOracleView,
        openOracleReportId: urlState.value.openOracleReportId,
        securityPoolsView: urlState.value.securityPoolsView,
        selectedPoolView: urlState.value.selectedPoolView,
        securityPoolAddress: urlState.value.securityPoolAddress,
        securityPoolQuestionId: urlState.value.securityPoolQuestionId,
        zoltarView: urlState.value.zoltarView,
        setActiveUniverseId,
        setOpenOracleReport,
        setOpenOracleView,
        setSecurityPoolsView,
        setSelectedPoolView,
        setSecurityPoolAddress,
        setSecurityPoolQuestionId,
        setZoltarView,
    };
}
//# sourceMappingURL=useUrlState.js.map