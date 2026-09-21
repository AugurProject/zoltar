import { tryParseBigIntInput } from '../forms/integerInput.js'

const UNIVERSE_QUERY_PARAM = 'universe'
const SECURITY_POOL_QUERY_PARAM = 'securityPool'
const SECURITY_POOL_QUESTION_ID_QUERY_PARAM = 'questionId'
const ZOLTAR_VIEW_QUERY_PARAM = 'zoltarView'
const SECURITY_POOLS_VIEW_QUERY_PARAM = 'securityPoolsView'
const SELECTED_POOL_VIEW_QUERY_PARAM = 'selectedPoolView'

export function readStringQueryParam(search: string, key: string) {
	const value = new URLSearchParams(search).get(key)
	if (value === null || value.trim() === '') return undefined
	return value
}

/** Applies `mutate` to the parsed search parameters and serializes them back, omitting the `?` when nothing remains. */
export function updateSearchParams(search: string, mutate: (params: URLSearchParams) => void) {
	const params = new URLSearchParams(search)
	mutate(params)
	const nextSearch = params.toString()
	return nextSearch === '' ? '' : `?${nextSearch}`
}

/** Sets `key` to the trimmed value, or deletes it for an empty value; returns the trimmed value so callers can branch on presence. */
export function setOrDeleteSearchParam(params: URLSearchParams, key: string, value: string | undefined) {
	const trimmed = value?.trim() ?? ''
	if (trimmed === '') {
		params.delete(key)
		return undefined
	}
	params.set(key, trimmed)
	return trimmed
}

function writeStringQueryParam(search: string, key: string, value: string | undefined) {
	return updateSearchParams(search, params => setOrDeleteSearchParam(params, key, value))
}

export function readUniverseQueryParam(search: string) {
	const value = readStringQueryParam(search, UNIVERSE_QUERY_PARAM)
	if (value === undefined) return undefined
	const universeId = tryParseBigIntInput(value)
	return universeId !== undefined && universeId >= 0n ? universeId : undefined
}

export function writeUniverseQueryParam(search: string, universeId: bigint | undefined) {
	return writeStringQueryParam(search, UNIVERSE_QUERY_PARAM, universeId?.toString())
}

export function readSecurityPoolQueryParam(search: string) {
	return readStringQueryParam(search, SECURITY_POOL_QUERY_PARAM)
}

export function writeSecurityPoolQueryParam(search: string, securityPoolAddress: string | undefined) {
	return updateSearchParams(search, params => {
		if (setOrDeleteSearchParam(params, SECURITY_POOL_QUERY_PARAM, securityPoolAddress) === undefined) {
			params.delete(SELECTED_POOL_VIEW_QUERY_PARAM)
			return
		}
		params.set(SECURITY_POOLS_VIEW_QUERY_PARAM, 'operate')
		params.delete(SECURITY_POOL_QUESTION_ID_QUERY_PARAM)
	})
}

export function readSecurityPoolQuestionIdQueryParam(search: string) {
	return readStringQueryParam(search, SECURITY_POOL_QUESTION_ID_QUERY_PARAM)
}

export function writeSecurityPoolQuestionIdQueryParam(search: string, questionId: string | undefined) {
	return updateSearchParams(search, params => {
		if (setOrDeleteSearchParam(params, SECURITY_POOL_QUESTION_ID_QUERY_PARAM, questionId) === undefined) return
		params.set(SECURITY_POOLS_VIEW_QUERY_PARAM, 'create')
		params.delete(SECURITY_POOL_QUERY_PARAM)
		params.delete(SELECTED_POOL_VIEW_QUERY_PARAM)
	})
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
	return updateSearchParams(search, params => {
		setOrDeleteSearchParam(params, SECURITY_POOLS_VIEW_QUERY_PARAM, view)
		if (view !== 'create') params.delete(SECURITY_POOL_QUESTION_ID_QUERY_PARAM)
		if (view !== 'operate') params.delete(SELECTED_POOL_VIEW_QUERY_PARAM)
	})
}

export function readSelectedPoolViewQueryParam(search: string) {
	return readStringQueryParam(search, SELECTED_POOL_VIEW_QUERY_PARAM)
}

export function writeSelectedPoolViewQueryParam(search: string, view: string | undefined) {
	return updateSearchParams(search, params => {
		if (setOrDeleteSearchParam(params, SELECTED_POOL_VIEW_QUERY_PARAM, view) === undefined) return
		params.set(SECURITY_POOLS_VIEW_QUERY_PARAM, 'operate')
	})
}
