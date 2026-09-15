import * as appCopy from '@zoltar/ui-core-shared/copy/app.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as statoblastAppCopy from '@zoltar/ui-statoblast-shared/copy/app.js'
import { createSecondaryNavigation, resolveSecondaryNavigation, withDeploymentTab } from '@zoltar/ui-core-shared/navigation/appNavigation.js'
import { buildRouteHref, getRouteHashSearch } from '@zoltar/ui-core-shared/navigation/routing.js'
import { writeOpenOracleViewQueryParam } from '@zoltar/ui-core-shared/navigation/openOracleUrlParams.js'
import { writeSecurityPoolsViewQueryParam } from '@zoltar/ui-core-shared/navigation/urlParams.js'
import { statoblastRouting } from '@zoltar/ui-statoblast-shared/lib/routing.js'
import type { OpenOracleView } from '@zoltar/ui-statoblast-shared/features/oracleTypes.js'
import type { SecurityPoolsView } from '@zoltar/ui-statoblast-shared/features/types.js'
import type { RouteTabDefinition, ViewTabOption } from '@zoltar/ui-core-shared/types/components.js'

function getOpenOracleViewOptions(routeHash: string, search: string): ViewTabOption<OpenOracleView>[] {
	return [
		{ href: buildRouteHref(routeHash, writeOpenOracleViewQueryParam(search, 'browse')), label: appCopy.browseReports, value: 'browse' },
		{ href: buildRouteHref(routeHash, writeOpenOracleViewQueryParam(search, 'create')), label: appCopy.createReport, value: 'create' },
		{ href: buildRouteHref(routeHash, writeOpenOracleViewQueryParam(search, 'selected-report')), label: appCopy.viewReport, value: 'selected-report' },
	]
}

export function getShowDeployTab({ applicationDeploymentMissing, deploymentStatusError, deploymentStatuses, hasLoadedDeploymentStatuses }: { applicationDeploymentMissing: boolean; deploymentStatusError: string | undefined; deploymentStatuses: readonly { deployed: boolean }[]; hasLoadedDeploymentStatuses: boolean }) {
	return deploymentStatusError !== undefined || applicationDeploymentMissing || (hasLoadedDeploymentStatuses && deploymentStatuses.some(step => !step.deployed))
}

export function getStatoblastRouteTabs({ route, showDeployTab }: { route: string; showDeployTab: boolean }): RouteTabDefinition[] {
	return withDeploymentTab({
		deploymentTab: { hash: statoblastRouting.getHash('deploy'), label: commonCopy.deploy, route: 'deploy' },
		deploymentIncomplete: showDeployTab,
		route,
		tabs: [
			{ hash: statoblastRouting.getHash('security-pools'), label: commonCopy.securityPools, route: 'security-pools' },
			{ hash: statoblastRouting.getHash('open-oracle'), label: statoblastAppCopy.oracleReports, route: 'open-oracle' },
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
	const securityPoolsHash = statoblastRouting.getHash('security-pools')
	const securityPoolViews = createSecondaryNavigation<SecurityPoolsView>({
		ariaLabel: appCopy.securityPoolsViews,
		value: activeSecurityPoolsView,
		onChange: setSecurityPoolsView,
		options: [
			{ href: buildRouteHref(securityPoolsHash, writeSecurityPoolsViewQueryParam(getRouteHashSearch(), 'browse')), label: commonCopy.browsePools, value: 'browse' },
			{ href: buildRouteHref(securityPoolsHash, writeSecurityPoolsViewQueryParam(getRouteHashSearch(), 'create')), label: commonCopy.createPool, value: 'create' },
			{ href: buildRouteHref(securityPoolsHash, writeSecurityPoolsViewQueryParam(getRouteHashSearch(), 'operate')), label: commonCopy.managePool, value: 'operate' },
			{ href: buildRouteHref(securityPoolsHash, writeSecurityPoolsViewQueryParam(getRouteHashSearch(), 'universes')), label: commonCopy.universe, value: 'universes' },
		],
	})
	const openOracleViews = createSecondaryNavigation<OpenOracleView>({ ariaLabel: statoblastAppCopy.oracleReportViews, value: activeOpenOracleView, onChange: setOpenOracleView, options: getOpenOracleViewOptions(statoblastRouting.getHash('open-oracle'), getRouteHashSearch()) })
	return resolveSecondaryNavigation({ route, secondaryByRoute: { 'open-oracle': openOracleViews, 'security-pools': securityPoolViews } })
}

export function getTransactionRouteKey({ activeOpenOracleView, activeSecurityPoolsView, route }: { activeOpenOracleView: OpenOracleView; activeSecurityPoolsView: SecurityPoolsView; route: string }) {
	if (route === 'security-pools') return `${route}:${activeSecurityPoolsView}`
	if (route === 'open-oracle') return `${route}:${activeOpenOracleView}`
	return route
}
