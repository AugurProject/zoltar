import { readStringQueryParam } from './urlParams.js'

const OPEN_ORACLE_VIEW_QUERY_PARAM = 'openOracleView'
const OPEN_ORACLE_REPORT_ID_QUERY_PARAM = 'openOracleReportId'

export function readOpenOracleReportIdQueryParam(search: string) {
	return readStringQueryParam(search, OPEN_ORACLE_REPORT_ID_QUERY_PARAM)
}

export function readOpenOracleViewQueryParam(search: string) {
	return readStringQueryParam(search, OPEN_ORACLE_VIEW_QUERY_PARAM)
}

export function writeOpenOracleViewQueryParam(search: string, view: string | undefined) {
	const params = new URLSearchParams(search)
	if (view === undefined || view.trim() === '') {
		params.delete(OPEN_ORACLE_VIEW_QUERY_PARAM)
	} else {
		params.set(OPEN_ORACLE_VIEW_QUERY_PARAM, view.trim())
	}

	if (view !== 'selected-report') params.delete(OPEN_ORACLE_REPORT_ID_QUERY_PARAM)

	const nextSearch = params.toString()
	return nextSearch === '' ? '' : `?${nextSearch}`
}

export function writeOpenOracleReportIdQueryParam(search: string, reportId: string | undefined) {
	const params = new URLSearchParams(search)
	if (reportId === undefined || reportId.trim() === '') {
		params.delete(OPEN_ORACLE_REPORT_ID_QUERY_PARAM)
	} else {
		params.set(OPEN_ORACLE_REPORT_ID_QUERY_PARAM, reportId.trim())
		params.set(OPEN_ORACLE_VIEW_QUERY_PARAM, 'selected-report')
	}

	const nextSearch = params.toString()
	return nextSearch === '' ? '' : `?${nextSearch}`
}
