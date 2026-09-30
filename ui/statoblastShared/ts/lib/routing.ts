import { buildRouteHref, createRouting, getCurrentRouteHash, getRouteHashSearch, installRouting, type RoutingConfig } from '@zoltar/ui-core-shared/navigation/routing.js'
import { updateSearchParams } from '@zoltar/ui-core-shared/navigation/urlParams.js'
import { resolveEnumValue } from '@zoltar/ui-core-shared/forms/viewState.js'
import { isHexAddressInput } from '@zoltar/ui-core-shared/lib/address.js'
import type { Route } from '../types/app.js'
import { buildPoolsRouteHash, parsePoolsRouteHash, POOLS_ROUTE_HASH, STATOBLAST_CONTEXT_QUERY_PARAMS } from './statoblastLocation.js'

type StatoblastRoute = Exclude<Route, 'not-found'>

const STATOBLAST_ROUTING_CONFIG: RoutingConfig<StatoblastRoute> = {
	defaultRoute: 'pools',
	buildNavigationHref: (route, routeHash, search) => {
		const current = parsePoolsRouteHash(getCurrentRouteHash())
		const params = new URLSearchParams(getRouteHashSearch())
		const rememberedAddress = current === undefined ? (params.get('securityPool') ?? '') : ''
		const address = current?.view === 'operate' ? current.securityPoolAddress : rememberedAddress
		const tab = current?.view === 'operate' ? current.tab : (params.get('selectedPoolView') ?? '')

		const nextSearch = updateSearchParams(search, next => next.delete('poolsView'))
		if (route === 'pools') {
			if (isHexAddressInput(address)) return buildRouteHref(buildPoolsRouteHash({ securityPoolAddress: address, tab, view: 'operate' }), nextSearch)
			const rememberedView = resolveEnumValue(params.get('poolsView') ?? '', 'browse', ['open', 'browse', 'create', 'universes'])
			const view = current !== undefined && current.view !== 'operate' ? current.view : rememberedView
			return buildRouteHref(buildPoolsRouteHash({ view }), nextSearch)
		}
		return buildRouteHref(
			routeHash,
			updateSearchParams(nextSearch, next => {
				if (isHexAddressInput(address)) {
					next.set('securityPool', address)
					if (tab !== '') next.set('selectedPoolView', tab)
				} else if (current !== undefined && current.view !== 'operate') {
					next.set('poolsView', current.view)
				} else {
					const view = params.get('poolsView')
					if (view !== null) next.set('poolsView', view)
				}
			}),
		)
	},
	routes: [
		{ hash: '#/deploy', name: 'deploy', queryParameters: new Set(STATOBLAST_CONTEXT_QUERY_PARAMS) },
		// Pools lands on Browse pools. The legacy security pools hash resolves to Pools; the URL state rewrites its query onto the pool path.
		{ aliases: [buildPoolsRouteHash({ view: 'open' }), '#/security-pools'], hash: POOLS_ROUTE_HASH, name: 'pools', queryParameters: new Set(['questionId', ...STATOBLAST_CONTEXT_QUERY_PARAMS]) },
		{ match: routeHash => (parsePoolsRouteHash(routeHash) === undefined ? undefined : 'pools') },
		{ hash: '#/open-oracle', name: 'open-oracle', queryParameters: new Set(STATOBLAST_CONTEXT_QUERY_PARAMS) },
	],
}

export const statoblastRouting = createRouting(STATOBLAST_ROUTING_CONFIG)

export function installStatoblastRouting() {
	installRouting(STATOBLAST_ROUTING_CONFIG)
}
