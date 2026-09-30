import { buildRouteHref, getCurrentRouteHash, getRouteHashSearch } from '@zoltar/ui-core-shared/navigation/routing.js'
import { readUniverseQueryParam, writeUniverseQueryParam } from '@zoltar/ui-core-shared/navigation/urlParams.js'
import { buildPoolPageRouteHash, parsePoolsRouteHash, writePoolsLocationSearch } from '../../../lib/statoblastLocation.js'

/** Links to `#/pools/<address>/<tab>`, keeping the current pool tab unless one is given and carrying the pool's universe. */
export function getSecurityPoolLinkHref(securityPoolAddress: string, selectedPoolView?: string, universeId?: bigint) {
	const currentSearch = getRouteHashSearch()
	const currentLocation = parsePoolsRouteHash(getCurrentRouteHash())
	const nextSelectedPoolView = selectedPoolView ?? (currentLocation?.view === 'operate' ? currentLocation.tab : '')
	const nextUniverseId = universeId ?? readUniverseQueryParam(currentSearch)
	const poolSearch = writePoolsLocationSearch(currentSearch, currentLocation, { securityPoolAddress, tab: nextSelectedPoolView, view: 'operate' })
	return buildRouteHref(buildPoolPageRouteHash(securityPoolAddress, nextSelectedPoolView), writeUniverseQueryParam(poolSearch, nextUniverseId))
}

export function navigateToSecurityPool(securityPoolAddress: string, selectedPoolView?: string, universeId?: bigint) {
	const href = getSecurityPoolLinkHref(securityPoolAddress, selectedPoolView, universeId)
	if (window.location.hash === href) return

	window.history.pushState({}, '', href)
	window.dispatchEvent(new Event('hashchange'))
}
