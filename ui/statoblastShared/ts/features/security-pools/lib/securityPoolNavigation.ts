import { buildRouteHref, getRouteHash, getRouteHashSearch } from '@zoltar/ui-core-shared/navigation/routing.js'
import { readSelectedPoolViewQueryParam, readUniverseQueryParam, writeSecurityPoolQueryParam, writeSelectedPoolViewQueryParam, writeUniverseQueryParam } from '@zoltar/ui-core-shared/navigation/urlParams.js'

export function getSecurityPoolLinkHref(securityPoolAddress: string, selectedPoolView?: string, universeId?: bigint) {
	const currentSearch = getRouteHashSearch()
	const nextSelectedPoolView = selectedPoolView ?? readSelectedPoolViewQueryParam(currentSearch)
	const nextUniverseId = universeId ?? readUniverseQueryParam(currentSearch)
	const securityPoolSearch = writeSecurityPoolQueryParam(currentSearch, securityPoolAddress)
	const selectedPoolViewSearch = writeSelectedPoolViewQueryParam(securityPoolSearch, nextSelectedPoolView)
	const nextSearch = writeUniverseQueryParam(selectedPoolViewSearch, nextUniverseId)
	return buildRouteHref(getRouteHash('security-pools'), nextSearch)
}

export function navigateToSecurityPool(securityPoolAddress: string, selectedPoolView?: string, universeId?: bigint) {
	const href = getSecurityPoolLinkHref(securityPoolAddress, selectedPoolView, universeId)
	if (window.location.hash === href) return

	window.history.pushState({}, '', href)
	window.dispatchEvent(new Event('hashchange'))
}
