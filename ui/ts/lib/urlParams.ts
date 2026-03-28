const UNIVERSE_QUERY_PARAM = 'universe'
const SECURITY_POOL_QUERY_PARAM = 'securityPool'
const ZOLTAR_VIEW_QUERY_PARAM = 'zoltarView'
const SELECTED_POOL_VIEW_QUERY_PARAM = 'selectedPoolView'

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
	return nextSearch === '' ? '' : `?${ nextSearch }`
}

export function readUniverseQueryParam(search: string) {
	const value = readStringQueryParam(search, UNIVERSE_QUERY_PARAM)
	if (value === undefined) return undefined

	try {
		return BigInt(value)
	} catch {
		return undefined
	}
}

export function writeUniverseQueryParam(search: string, universeId: bigint | undefined) {
	const params = new URLSearchParams(search)
	if (universeId === undefined) {
		params.delete(UNIVERSE_QUERY_PARAM)
	} else {
		params.set(UNIVERSE_QUERY_PARAM, universeId.toString())
	}

	const nextSearch = params.toString()
	return nextSearch === '' ? '' : `?${ nextSearch }`
}

export function readSecurityPoolQueryParam(search: string) {
	return readStringQueryParam(search, SECURITY_POOL_QUERY_PARAM)
}

export function writeSecurityPoolQueryParam(search: string, securityPoolAddress: string | undefined) {
	return writeStringQueryParam(search, SECURITY_POOL_QUERY_PARAM, securityPoolAddress)
}

export function readZoltarViewQueryParam(search: string) {
	return readStringQueryParam(search, ZOLTAR_VIEW_QUERY_PARAM)
}

export function writeZoltarViewQueryParam(search: string, view: string | undefined) {
	return writeStringQueryParam(search, ZOLTAR_VIEW_QUERY_PARAM, view)
}

export function readSelectedPoolViewQueryParam(search: string) {
	return readStringQueryParam(search, SELECTED_POOL_VIEW_QUERY_PARAM)
}

export function writeSelectedPoolViewQueryParam(search: string, view: string | undefined) {
	return writeStringQueryParam(search, SELECTED_POOL_VIEW_QUERY_PARAM, view)
}
