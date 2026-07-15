import { tryParseBigIntInput } from './integerInput.js'

const UNIVERSE_QUERY_PARAM = 'universe'
const SECURITY_POOL_QUERY_PARAM = 'securityPool'
const ZOLTAR_VIEW_QUERY_PARAM = 'zoltarView'
const SECURITY_POOLS_VIEW_QUERY_PARAM = 'securityPoolsView'
const SELECTED_POOL_VIEW_QUERY_PARAM = 'selectedPoolView'
const OPEN_ORACLE_VIEW_QUERY_PARAM = 'openOracleView'
const OPEN_ORACLE_REPORT_ID_QUERY_PARAM = 'openOracleReportId'

function readStringQueryParam(search: string, key: string) {
	const value = new URLSearchParams(search).get(key)
	if (value === null || value.trim() === '') return undefined
	return value
}

function writeStringQueryParam(search: string, key: string, value: string | undefined) {
	const params = new URLSearchParams(search)
	if (value === undefined || value.trim() === '') {
		params.delete(key)
	} else {
		params.set(key, value.trim())
	}

	const nextSearch = params.toString()
	return nextSearch === '' ? '' : `?${nextSearch}`
}

export function readUniverseQueryParam(search: string) {
	const value = readStringQueryParam(search, UNIVERSE_QUERY_PARAM)
	if (value === undefined) return undefined
	return tryParseBigIntInput(value)
}

export function writeUniverseQueryParam(search: string, universeId: bigint | undefined) {
	const params = new URLSearchParams(search)
	if (universeId === undefined) {
		params.delete(UNIVERSE_QUERY_PARAM)
	} else {
		params.set(UNIVERSE_QUERY_PARAM, universeId.toString())
	}

	const nextSearch = params.toString()
	return nextSearch === '' ? '' : `?${nextSearch}`
}

export function readSecurityPoolQueryParam(search: string) {
	return readStringQueryParam(search, SECURITY_POOL_QUERY_PARAM)
}

export function writeSecurityPoolQueryParam(search: string, securityPoolAddress: string | undefined) {
	const params = new URLSearchParams(search)
	if (securityPoolAddress === undefined || securityPoolAddress.trim() === '') {
		params.delete(SECURITY_POOL_QUERY_PARAM)
		params.delete(SELECTED_POOL_VIEW_QUERY_PARAM)
	} else {
		params.set(SECURITY_POOL_QUERY_PARAM, securityPoolAddress.trim())
		params.set(SECURITY_POOLS_VIEW_QUERY_PARAM, 'operate')
	}

	const nextSearch = params.toString()
	return nextSearch === '' ? '' : `?${nextSearch}`
}

export function readZoltarViewQueryParam(search: string) {
	return readStringQueryParam(search, ZOLTAR_VIEW_QUERY_PARAM)
}

export function writeZoltarViewQueryParam(search: string, view: string | undefined) {
	return writeStringQueryParam(search, ZOLTAR_VIEW_QUERY_PARAM, view)
}

export function readSecurityPoolsViewQueryParam(search: string) {
	return readStringQueryParam(search, SECURITY_POOLS_VIEW_QUERY_PARAM)
}

export function writeSecurityPoolsViewQueryParam(search: string, view: string | undefined) {
	const params = new URLSearchParams(search)
	if (view === undefined || view.trim() === '') {
		params.delete(SECURITY_POOLS_VIEW_QUERY_PARAM)
	} else {
		params.set(SECURITY_POOLS_VIEW_QUERY_PARAM, view.trim())
	}

	if (view !== 'operate') {
		params.delete(SECURITY_POOL_QUERY_PARAM)
		params.delete(SELECTED_POOL_VIEW_QUERY_PARAM)
	}

	const nextSearch = params.toString()
	return nextSearch === '' ? '' : `?${nextSearch}`
}

export function readSelectedPoolViewQueryParam(search: string) {
	return readStringQueryParam(search, SELECTED_POOL_VIEW_QUERY_PARAM)
}

export function writeSelectedPoolViewQueryParam(search: string, view: string | undefined) {
	const params = new URLSearchParams(search)
	if (view === undefined || view.trim() === '') {
		params.delete(SELECTED_POOL_VIEW_QUERY_PARAM)
	} else {
		params.set(SELECTED_POOL_VIEW_QUERY_PARAM, view.trim())
		params.set(SECURITY_POOLS_VIEW_QUERY_PARAM, 'operate')
	}

	const nextSearch = params.toString()
	return nextSearch === '' ? '' : `?${nextSearch}`
}

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
