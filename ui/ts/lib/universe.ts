import { getAddress, type Address } from 'viem'
import { readUniverseQueryParam, writeUniverseQueryParam } from './urlParams.js'

export const GENESIS_REPUTATION_TOKEN_ADDRESS = getAddress('0x221657776846890989a759ba2973e427dff5c9bb') satisfies Address

export function formatUniverseLabel(universeId: bigint) {
	return universeId === 0n ? 'Genesis (0)' : `Universe ${universeId.toString()}`
}

export function getUniverseLinkHref(universeId: bigint) {
	const nextSearch = writeUniverseQueryParam(window.location.search, universeId)
	return `${window.location.pathname}${nextSearch}${window.location.hash}`
}

export function navigateToUniverse(universeId: bigint) {
	const currentUniverseId = readUniverseQueryParam(window.location.search)
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
