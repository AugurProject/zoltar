import { buildRouteHref, createRouting, getCurrentRouteHash, getRouteHashSearch, installRouting, type RoutingConfig } from '@zoltar/ui-core-shared/navigation/routing.js'
import { updateSearchParams } from '@zoltar/ui-core-shared/navigation/urlParams.js'
import { isHexAddressInput } from '@zoltar/ui-core-shared/lib/address.js'
import type { StatoblastRoute } from '../types/app.js'
import { buildPoolsRouteHash, parsePoolsRouteHash, POOL_BROWSE_QUERY_PARAMS, POOLS_ROUTE_HASH, STATOBLAST_CONTEXT_QUERY_PARAMS, type PoolsLocation } from './statoblastLocation.js'

type NavigableStatoblastRoute = Exclude<StatoblastRoute, 'not-found'>

// The Pools list view and its browse controls stay out of the Advanced and Deploy URLs. A link built from a list view remembers them, so
// Pools reopens the same view and controls; the memory lasts for the page session, so a reload opens Browse.
let rememberedPoolList: { browseParams: [string, string][]; view: Exclude<PoolsLocation['view'], 'operate'> } | undefined

const STATOBLAST_ROUTING_CONFIG: RoutingConfig<NavigableStatoblastRoute> = {
	defaultRoute: 'pools',
	buildNavigationHref: (route, routeHash, search) => {
		const current = parsePoolsRouteHash(getCurrentRouteHash())
		const params = new URLSearchParams(getRouteHashSearch())
		const rememberedAddress = current === undefined ? (params.get('securityPool') ?? '') : ''
		const address = current?.view === 'operate' ? current.securityPoolAddress : rememberedAddress
		const tab = current?.view === 'operate' ? current.tab : (params.get('selectedPoolView') ?? '')
		if (current !== undefined && current.view !== 'operate') rememberedPoolList = { browseParams: [...params].filter(([key]) => POOL_BROWSE_QUERY_PARAMS.some(browseKey => browseKey === key)), view: current.view }

		if (route === 'pools') {
			if (isHexAddressInput(address)) return buildRouteHref(buildPoolsRouteHash({ securityPoolAddress: address, tab, view: 'operate' }), search)
			if (current !== undefined) return buildRouteHref(buildPoolsRouteHash({ view: current.view === 'operate' ? 'browse' : current.view }), search)
			const remembered = rememberedPoolList
			return buildRouteHref(
				buildPoolsRouteHash({ view: remembered?.view ?? 'browse' }),
				updateSearchParams(search, next => {
					for (const [key, value] of remembered?.browseParams ?? []) if (!next.has(key)) next.append(key, value)
				}),
			)
		}
		return buildRouteHref(
			routeHash,
			updateSearchParams(search, next => {
				if (!isHexAddressInput(address)) return
				next.set('securityPool', address)
				if (tab !== '') next.set('selectedPoolView', tab)
			}),
		)
	},
	routes: [
		{ hash: '#/deploy', name: 'deploy', queryParameters: new Set(STATOBLAST_CONTEXT_QUERY_PARAMS) },
		// Pools lands on Browse pools. The legacy security pools hash resolves to Pools; the URL state rewrites its query onto the pool path.
		{ aliases: ['#/security-pools'], hash: POOLS_ROUTE_HASH, name: 'pools', queryParameters: new Set(['questionId', ...STATOBLAST_CONTEXT_QUERY_PARAMS, ...POOL_BROWSE_QUERY_PARAMS]) },
		{ match: routeHash => (parsePoolsRouteHash(routeHash) === undefined ? undefined : 'pools') },
		{ hash: '#/open-oracle', name: 'open-oracle', queryParameters: new Set(STATOBLAST_CONTEXT_QUERY_PARAMS) },
	],
}

export const statoblastRouting = createRouting(STATOBLAST_ROUTING_CONFIG)

export function installStatoblastRouting() {
	rememberedPoolList = undefined
	installRouting(STATOBLAST_ROUTING_CONFIG)
}
