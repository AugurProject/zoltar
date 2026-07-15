import * as appCopy from '../copy/app.js'
import * as commonCopy from '../copy/common.js'
import { ViewTabs } from './ViewTabs.js'
import { buildRouteHref, getRouteHashSearch } from '../lib/routing.js'
import type { TabNavigationProps } from '../types/components.js'

export function TabNavigation({ route, showDeployTab = true, augurPlaceHolderDeployed, deployRoute, marketRoute, openOracleRoute, securityPoolsRoute, onRouteChange }: TabNavigationProps) {
	const disabledTabReason = appCopy.deploymentRequiredDetail
	const options: Array<{ disabled?: boolean; href: string; label: string; reason?: string; value: Exclude<TabNavigationProps['route'], 'not-found'> }> = []
	const currentRouteSearch = getRouteHashSearch()
	if (showDeployTab) options.push({ value: 'deploy', label: commonCopy.deploy, href: buildRouteHref(deployRoute, currentRouteSearch) })
	options.push({
		value: 'zoltar',
		label: commonCopy.markets,
		href: buildRouteHref(marketRoute, currentRouteSearch),
		disabled: !augurPlaceHolderDeployed,
		...(!augurPlaceHolderDeployed ? { reason: disabledTabReason } : {}),
	})
	options.push({
		value: 'security-pools',
		label: commonCopy.securityPools,
		href: buildRouteHref(securityPoolsRoute, currentRouteSearch),
		disabled: !augurPlaceHolderDeployed,
		...(!augurPlaceHolderDeployed ? { reason: disabledTabReason } : {}),
	})
	options.push({
		value: 'open-oracle',
		label: appCopy.oracleReports,
		href: buildRouteHref(openOracleRoute, currentRouteSearch),
		disabled: !augurPlaceHolderDeployed,
		...(!augurPlaceHolderDeployed ? { reason: disabledTabReason } : {}),
	})

	return (
		<nav className='tab-nav' aria-label={appCopy.applicationSections}>
			<ViewTabs ariaLabel={appCopy.applicationSections} value={route === 'not-found' ? 'deploy' : route} variant='route' onChange={value => onRouteChange(value as Exclude<TabNavigationProps['route'], 'not-found'>)} options={options} />
		</nav>
	)
}
