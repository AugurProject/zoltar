import type { GenesisOutcome } from '@zoltar/zoltar-shared/deployment/genesisUniverses'
import { parseRouteHash } from './routing.js'
import { readGenesisQueryParam, writeGenesisQueryParam } from './urlParams.js'

type GenesisLocation = Pick<Location, 'hash' | 'search'>

/** Hash parameters override page parameters, including an invalid or empty choice. */
export function readGenesisOutcomeFromLocation(location: GenesisLocation = window.location) {
	const hashSearch = parseRouteHash(location.hash).search
	return readGenesisQueryParam(new URLSearchParams(hashSearch).has('genesis') ? hashSearch : location.search)
}

/** Selecting an initial branch preserves a deep link; returning to the Augur parent or switching branches retires deployment-specific state. */
export function getGenesisUniverseHref(outcome: GenesisOutcome | undefined, resetUniverse = false, href = window.location.href) {
	const url = new URL(href)
	const route = parseRouteHash(url.hash)
	url.search = writeGenesisQueryParam(url.search, outcome)
	const params = new URLSearchParams(route.search)
	params.delete('genesis')
	if (resetUniverse) {
		const environmentParameters = ['genesis', 'network', 'rpcUrl', 'simScenario', 'simulate', 'simWallet']
		for (const key of [...params.keys()]) if (!environmentParameters.includes(key)) params.delete(key)
		for (const key of [...url.searchParams.keys()]) if (!environmentParameters.includes(key)) url.searchParams.delete(key)
	}
	const search = params.toString()
	url.hash = `${resetUniverse ? '#/' : route.routeHash}${search === '' ? '' : `?${search}`}`
	return url.href
}
