import * as appCopy from '@zoltar/ui-core-shared/copy/app.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as statoblastAppCopy from '@zoltar/ui-statoblast-shared/copy/app.js'
import { createSecondaryNavigation, resolveSecondaryNavigation, withDeploymentTab } from '@zoltar/ui-core-shared/navigation/appNavigation.js'
import { buildRouteHref, getRouteHashSearch } from '@zoltar/ui-core-shared/navigation/routing.js'
import { writeOpenOracleViewQueryParam } from '@zoltar/ui-core-shared/navigation/openOracleUrlParams.js'
import { updateSearchParams } from '@zoltar/ui-core-shared/navigation/urlParams.js'
import { statoblastRouting } from '@zoltar/ui-statoblast-shared/lib/routing.js'
import { buildPoolsRouteHash } from '@zoltar/ui-statoblast-shared/lib/statoblastLocation.js'
import type { OpenOracleView } from '@zoltar/ui-statoblast-shared/features/oracleTypes.js'
import type { SecurityPoolsView } from '@zoltar/ui-statoblast-shared/features/types.js'
import type { RouteTabDefinition, ViewTabOption } from '@zoltar/ui-core-shared/types/components.js'

type PoolsListView = Exclude<SecurityPoolsView, 'operate'>

function getOpenOracleViewOptions(routeHash: string, search: string): ViewTabOption<OpenOracleView>[] {
	return [
		{ href: buildRouteHref(routeHash, writeOpenOracleViewQueryParam(search, 'browse')), label: appCopy.browseReports, value: 'browse' },
		{ href: buildRouteHref(routeHash, writeOpenOracleViewQueryParam(search, 'create')), label: appCopy.createReport, value: 'create' },
		{ href: buildRouteHref(routeHash, writeOpenOracleViewQueryParam(search, 'selected-report')), label: appCopy.viewReport, value: 'selected-report' },
	]
}

function getPoolsViewHref(view: PoolsListView) {
	const search = updateSearchParams(getRouteHashSearch(), params => {
		if (view !== 'create') params.delete('questionId')
	})
	return buildRouteHref(buildPoolsRouteHash({ view }), search)
}

/** One primary row: the account's portfolio, the pool directory, and Open Oracle as an advanced tool; Deploy joins while deployment is incomplete. */
export function getStatoblastRouteTabs({ route, showDeployTab }: { route: string; showDeployTab: boolean }): RouteTabDefinition[] {
	return withDeploymentTab({
		deploymentTab: { hash: statoblastRouting.getHash('deploy'), label: commonCopy.deploy, route: 'deploy' },
		deploymentIncomplete: showDeployTab,
		route,
		tabs: [
			{ hash: statoblastRouting.getHash('portfolio'), label: statoblastAppCopy.portfolio, route: 'portfolio' },
			{ hash: statoblastRouting.getHash('pools'), label: statoblastAppCopy.pools, route: 'pools' },
			{ hash: statoblastRouting.getHash('open-oracle'), label: statoblastAppCopy.advanced, route: 'open-oracle' },
		],
	})
}

export function getRouteSecondaryNavigation({
	activeOpenOracleView,
	activeSecurityPoolsView,
	route,
	setOpenOracleView,
	setSecurityPoolsView,
}: {
	activeOpenOracleView: OpenOracleView
	activeSecurityPoolsView: SecurityPoolsView
	route: string
	setOpenOracleView: (view: OpenOracleView) => void
	setSecurityPoolsView: (view: SecurityPoolsView) => void
}) {
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
						{ href: getPoolsViewHref('universes'), label: commonCopy.universe, value: 'universes' },
					],
				})
	const openOracleViews = createSecondaryNavigation<OpenOracleView>({ ariaLabel: statoblastAppCopy.oracleReportViews, value: activeOpenOracleView, onChange: setOpenOracleView, options: getOpenOracleViewOptions(statoblastRouting.getHash('open-oracle'), getRouteHashSearch()) })
	return resolveSecondaryNavigation({ route, secondaryByRoute: { 'open-oracle': openOracleViews, pools: poolsViews } })
}

export function getTransactionRouteKey({ activeOpenOracleView, activeSecurityPoolsView, route }: { activeOpenOracleView: OpenOracleView; activeSecurityPoolsView: SecurityPoolsView; route: string }) {
	if (route === 'pools') return `${route}:${activeSecurityPoolsView}`
	if (route === 'open-oracle') return `${route}:${activeOpenOracleView}`
	return route
}
