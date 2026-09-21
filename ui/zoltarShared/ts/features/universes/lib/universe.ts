import { buildRouteHref, getCurrentRouteHash, getRouteHashSearch } from '@zoltar/ui-core-shared/navigation/routing.js'
import { readUniverseQueryParam, writeUniverseQueryParam } from '@zoltar/ui-core-shared/navigation/urlParams.js'
import { getGenesisReputationTokenAddress } from '../../../protocol/activeProtocolAddresses.js'

export { getGenesisReputationTokenAddress }

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
