import { tryParseBigIntInput } from './integerInput.js';
const UNIVERSE_QUERY_PARAM = 'universe';
const SECURITY_POOL_QUERY_PARAM = 'securityPool';
const SECURITY_POOL_QUESTION_ID_QUERY_PARAM = 'questionId';
const ZOLTAR_VIEW_QUERY_PARAM = 'zoltarView';
const SECURITY_POOLS_VIEW_QUERY_PARAM = 'securityPoolsView';
const SELECTED_POOL_VIEW_QUERY_PARAM = 'selectedPoolView';
const OPEN_ORACLE_VIEW_QUERY_PARAM = 'openOracleView';
const OPEN_ORACLE_REPORT_ID_QUERY_PARAM = 'openOracleReportId';
function readStringQueryParam(search, key) {
    const value = new URLSearchParams(search).get(key);
    if (value === null || value.trim() === '')
        return undefined;
    return value;
}
function writeStringQueryParam(search, key, value) {
    const params = new URLSearchParams(search);
    if (value === undefined || value.trim() === '') {
        params.delete(key);
    }
    else {
        params.set(key, value.trim());
    }
    const nextSearch = params.toString();
    return nextSearch === '' ? '' : `?${nextSearch}`;
}
export function readUniverseQueryParam(search) {
    const value = readStringQueryParam(search, UNIVERSE_QUERY_PARAM);
    if (value === undefined)
        return undefined;
    const universeId = tryParseBigIntInput(value);
    return universeId !== undefined && universeId >= 0n ? universeId : undefined;
}
export function writeUniverseQueryParam(search, universeId) {
    const params = new URLSearchParams(search);
    if (universeId === undefined) {
        params.delete(UNIVERSE_QUERY_PARAM);
    }
    else {
        params.set(UNIVERSE_QUERY_PARAM, universeId.toString());
    }
    const nextSearch = params.toString();
    return nextSearch === '' ? '' : `?${nextSearch}`;
}
export function readSecurityPoolQueryParam(search) {
    return readStringQueryParam(search, SECURITY_POOL_QUERY_PARAM);
}
export function writeSecurityPoolQueryParam(search, securityPoolAddress) {
    const params = new URLSearchParams(search);
    if (securityPoolAddress === undefined || securityPoolAddress.trim() === '') {
        params.delete(SECURITY_POOL_QUERY_PARAM);
        params.delete(SELECTED_POOL_VIEW_QUERY_PARAM);
    }
    else {
        params.set(SECURITY_POOL_QUERY_PARAM, securityPoolAddress.trim());
        params.set(SECURITY_POOLS_VIEW_QUERY_PARAM, 'operate');
        params.delete(SECURITY_POOL_QUESTION_ID_QUERY_PARAM);
    }
    const nextSearch = params.toString();
    return nextSearch === '' ? '' : `?${nextSearch}`;
}
export function readSecurityPoolQuestionIdQueryParam(search) {
    return readStringQueryParam(search, SECURITY_POOL_QUESTION_ID_QUERY_PARAM);
}
export function writeSecurityPoolQuestionIdQueryParam(search, questionId) {
    const params = new URLSearchParams(search);
    if (questionId === undefined || questionId.trim() === '') {
        params.delete(SECURITY_POOL_QUESTION_ID_QUERY_PARAM);
    }
    else {
        params.set(SECURITY_POOL_QUESTION_ID_QUERY_PARAM, questionId.trim());
        params.set(SECURITY_POOLS_VIEW_QUERY_PARAM, 'create');
        params.delete(SECURITY_POOL_QUERY_PARAM);
        params.delete(SELECTED_POOL_VIEW_QUERY_PARAM);
    }
    const nextSearch = params.toString();
    return nextSearch === '' ? '' : `?${nextSearch}`;
}
export function readZoltarViewQueryParam(search) {
    return readStringQueryParam(search, ZOLTAR_VIEW_QUERY_PARAM);
}
export function writeZoltarViewQueryParam(search, view) {
    return writeStringQueryParam(search, ZOLTAR_VIEW_QUERY_PARAM, view);
}
export function readSecurityPoolsViewQueryParam(search) {
    return readStringQueryParam(search, SECURITY_POOLS_VIEW_QUERY_PARAM);
}
export function writeSecurityPoolsViewQueryParam(search, view) {
    const params = new URLSearchParams(search);
    if (view === undefined || view.trim() === '') {
        params.delete(SECURITY_POOLS_VIEW_QUERY_PARAM);
    }
    else {
        params.set(SECURITY_POOLS_VIEW_QUERY_PARAM, view.trim());
    }
    if (view !== 'operate') {
        params.delete(SECURITY_POOL_QUERY_PARAM);
        params.delete(SELECTED_POOL_VIEW_QUERY_PARAM);
    }
    if (view !== 'create')
        params.delete(SECURITY_POOL_QUESTION_ID_QUERY_PARAM);
    const nextSearch = params.toString();
    return nextSearch === '' ? '' : `?${nextSearch}`;
}
export function readSelectedPoolViewQueryParam(search) {
    return readStringQueryParam(search, SELECTED_POOL_VIEW_QUERY_PARAM);
}
export function writeSelectedPoolViewQueryParam(search, view) {
    const params = new URLSearchParams(search);
    if (view === undefined || view.trim() === '') {
        params.delete(SELECTED_POOL_VIEW_QUERY_PARAM);
    }
    else {
        params.set(SELECTED_POOL_VIEW_QUERY_PARAM, view.trim());
        params.set(SECURITY_POOLS_VIEW_QUERY_PARAM, 'operate');
    }
    const nextSearch = params.toString();
    return nextSearch === '' ? '' : `?${nextSearch}`;
}
export function readOpenOracleReportIdQueryParam(search) {
    return readStringQueryParam(search, OPEN_ORACLE_REPORT_ID_QUERY_PARAM);
}
export function readOpenOracleViewQueryParam(search) {
    return readStringQueryParam(search, OPEN_ORACLE_VIEW_QUERY_PARAM);
}
export function writeOpenOracleViewQueryParam(search, view) {
    const params = new URLSearchParams(search);
    if (view === undefined || view.trim() === '') {
        params.delete(OPEN_ORACLE_VIEW_QUERY_PARAM);
    }
    else {
        params.set(OPEN_ORACLE_VIEW_QUERY_PARAM, view.trim());
    }
    if (view !== 'selected-report')
        params.delete(OPEN_ORACLE_REPORT_ID_QUERY_PARAM);
    const nextSearch = params.toString();
    return nextSearch === '' ? '' : `?${nextSearch}`;
}
export function writeOpenOracleReportIdQueryParam(search, reportId) {
    const params = new URLSearchParams(search);
    if (reportId === undefined || reportId.trim() === '') {
        params.delete(OPEN_ORACLE_REPORT_ID_QUERY_PARAM);
    }
    else {
        params.set(OPEN_ORACLE_REPORT_ID_QUERY_PARAM, reportId.trim());
        params.set(OPEN_ORACLE_VIEW_QUERY_PARAM, 'selected-report');
    }
    const nextSearch = params.toString();
    return nextSearch === '' ? '' : `?${nextSearch}`;
}
//# sourceMappingURL=urlParams.js.map