import { buildRouteHref, getCurrentRouteHash, getRouteHashSearch } from './routing.js'
import { readUniverseQueryParam, writeUniverseQueryParam } from './urlParams.js'

/** The current route with only the shared `universe` query parameter changed. */
export function getUniverseLinkHref(universeId: bigint) {
	const nextSearch = writeUniverseQueryParam(getRouteHashSearch(), universeId)
	return buildRouteHref(getCurrentRouteHash(), nextSearch)
}

export function navigateToUniverse(universeId: bigint) {
	const currentUniverseId = readUniverseQueryParam(getRouteHashSearch())
	if (currentUniverseId === universeId) return

	window.history.pushState({}, '', getUniverseLinkHref(universeId))
	window.dispatchEvent(new PopStateEvent('popstate'))
}
