const UNIVERSE_QUERY_PARAM = 'universe'

export function readUniverseQueryParam(search: string) {
	const value = new URLSearchParams(search).get(UNIVERSE_QUERY_PARAM)
	if (value === null || value.trim() === '') return undefined

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
