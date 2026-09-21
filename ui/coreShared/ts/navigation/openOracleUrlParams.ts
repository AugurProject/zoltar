import { readStringQueryParam, setOrDeleteSearchParam, updateSearchParams } from './urlParams.js'

const OPEN_ORACLE_VIEW_QUERY_PARAM = 'openOracleView'
const OPEN_ORACLE_REPORT_ID_QUERY_PARAM = 'openOracleReportId'

export function readOpenOracleReportIdQueryParam(search: string) {
	return readStringQueryParam(search, OPEN_ORACLE_REPORT_ID_QUERY_PARAM)
}

export function readOpenOracleViewQueryParam(search: string) {
	return readStringQueryParam(search, OPEN_ORACLE_VIEW_QUERY_PARAM)
}

export function writeOpenOracleViewQueryParam(search: string, view: string | undefined) {
	return updateSearchParams(search, params => {
		setOrDeleteSearchParam(params, OPEN_ORACLE_VIEW_QUERY_PARAM, view)
		if (view !== 'selected-report') params.delete(OPEN_ORACLE_REPORT_ID_QUERY_PARAM)
	})
}

export function writeOpenOracleReportIdQueryParam(search: string, reportId: string | undefined) {
	return updateSearchParams(search, params => {
		if (setOrDeleteSearchParam(params, OPEN_ORACLE_REPORT_ID_QUERY_PARAM, reportId) === undefined) return
		params.set(OPEN_ORACLE_VIEW_QUERY_PARAM, 'selected-report')
	})
}
