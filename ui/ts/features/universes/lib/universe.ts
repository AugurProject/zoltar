import { buildRouteHref, getCurrentRouteHash, getRouteHashSearch } from '../../../lib/routing.js'
import { readUniverseQueryParam, writeUniverseQueryParam } from '../../../lib/urlParams.js'
import { getGenesisReputationTokenAddress } from '../../../protocol/activeProtocolAddresses.js'

export { getGenesisReputationTokenAddress }

export function formatUniverseLabel(universeId: bigint) {
	return universeId === 0n ? 'Genesis (0)' : `Universe ${universeId.toString()}`
}

export function formatUniverseIdHex(universeId: bigint) {
	return `0x${universeId.toString(16)}`
}

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

export function formatUniverseCollectionLabel(universeIds: bigint[]) {
	const uniqueUniverseIds = [...new Set(universeIds)]
	if (uniqueUniverseIds.length === 0) return formatUniverseLabel(0n)
	if (uniqueUniverseIds.length === 1) {
		const universeId = uniqueUniverseIds[0]
		if (universeId === undefined) return formatUniverseLabel(0n)
		return formatUniverseLabel(universeId)
	}
	return `Multiple (${uniqueUniverseIds.map(universeId => universeId.toString()).join(', ')})`
}
