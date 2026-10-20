import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as zoltarCopy from '@zoltar/ui-zoltar-shared/copy/zoltar.js'
import * as openOracleCopy from '@zoltar/ui-statoblast-shared/copy/openOracle.js'
import * as statoblastAppCopy from '@zoltar/ui-statoblast-shared/copy/app.js'
import { createSecondaryNavigation, resolveSecondaryNavigation, withDeploymentTab } from '@zoltar/ui-core-shared/navigation/appNavigation.js'
import { buildRouteHref, getRouteHashSearch, parseRouteHash } from '@zoltar/ui-core-shared/navigation/routing.js'
import { statoblastRouting } from '@zoltar/ui-statoblast-shared/lib/routing.js'
import { buildPoolsRouteHash, parsePoolsRouteHash, writePoolsLocationSearch } from '@zoltar/ui-statoblast-shared/lib/statoblastLocation.js'
import type { SecurityPoolsView } from '@zoltar/ui-statoblast-shared/features/types.js'
import type { RouteTabDefinition } from '@zoltar/ui-core-shared/types/components.js'

type PoolsListView = Exclude<SecurityPoolsView, 'operate'>

export function getPoolsViewHref(view: PoolsListView) {
	const search = writePoolsLocationSearch(getRouteHashSearch(), parsePoolsRouteHash(parseRouteHash(window.location.hash).routeHash), { view })
	return buildRouteHref(buildPoolsRouteHash({ view }), search)
}

/** Pools and price requests share one primary row; Deploy joins while deployment is incomplete, and the other sections are disabled while required contracts are missing. */
export function getStatoblastRouteTabs({ applicationDeploymentMissing, route, showDeployTab }: { applicationDeploymentMissing: boolean; route: string; showDeployTab: boolean }): RouteTabDefinition[] {
	return withDeploymentTab({
		deploymentMissing: applicationDeploymentMissing,
		deploymentTab: { hash: statoblastRouting.getHash('deploy'), label: commonCopy.deploy, route: 'deploy' },
		deploymentIncomplete: showDeployTab,
		route,
		tabs: [
			{ hash: statoblastRouting.getHash('pools'), label: statoblastAppCopy.pools, route: 'pools' },
			{ hash: statoblastRouting.getHash('open-oracle'), label: openOracleCopy.priceReports, route: 'open-oracle' },
		],
	})
}

export function getRouteSecondaryNavigation({ activeSecurityPoolsView, route, setSecurityPoolsView }: { activeSecurityPoolsView: SecurityPoolsView; route: string; setSecurityPoolsView: (view: SecurityPoolsView) => void }) {
	// A pool page is its own record with a back link and stage tabs; the list views would only compete with them.
	const poolsViews =
		activeSecurityPoolsView === 'operate'
			? undefined
			: createSecondaryNavigation<PoolsListView>({
					ariaLabel: statoblastAppCopy.poolsViews,
					value: activeSecurityPoolsView,
					onChange: setSecurityPoolsView,
					options: [
						{ href: getPoolsViewHref('browse'), label: commonCopy.browsePools, value: 'browse' },
						{ href: getPoolsViewHref('create'), label: commonCopy.createPool, value: 'create' },
						{ href: getPoolsViewHref('universes'), label: zoltarCopy.universesTitle, value: 'universes' },
						...(activeSecurityPoolsView === 'migrate' ? [{ href: getPoolsViewHref('migrate'), label: zoltarCopy.migrateRep, value: 'migrate' as const }] : []),
					],
				})
	return resolveSecondaryNavigation({ route, secondaryByRoute: { pools: poolsViews } })
}

export function getTransactionRouteKey({ activeSecurityPoolsView, route }: { activeSecurityPoolsView: SecurityPoolsView; route: string }) {
	if (route === 'pools') return `${route}:${activeSecurityPoolsView}`
	return route
}
