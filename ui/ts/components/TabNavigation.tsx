import { ViewTabs } from './ViewTabs.js'
import { buildRouteHref, getRouteHashSearch } from '../lib/routing.js'
import { UI_STRINGS } from '../lib/uiStrings.js'
import type { TabNavigationProps } from '../types/components.js'

export function TabNavigation({ route, showDeployTab = true, augurPlaceHolderDeployed, deployRoute, marketRoute, openOracleRoute, securityPoolsRoute, onRouteChange }: TabNavigationProps) {
	const disabledTabReason = UI_STRINGS.tabNavigation.deployContractsFirstReason
	const options: Array<{ disabled?: boolean; href: string; label: string; reason?: string; value: Exclude<TabNavigationProps['route'], 'not-found'> }> = []
	const currentRouteSearch = getRouteHashSearch()
	if (showDeployTab) options.push({ value: 'deploy', label: UI_STRINGS.tabNavigation.deployTabLabel, href: buildRouteHref(deployRoute, currentRouteSearch) })
	options.push({
		value: 'zoltar',
		label: UI_STRINGS.tabNavigation.marketsTabLabel,
		href: buildRouteHref(marketRoute, currentRouteSearch),
		disabled: !augurPlaceHolderDeployed,
		...(!augurPlaceHolderDeployed ? { reason: disabledTabReason } : {}),
	})
	options.push({
		value: 'security-pools',
		label: UI_STRINGS.tabNavigation.securityPoolsTabLabel,
		href: buildRouteHref(securityPoolsRoute, currentRouteSearch),
		disabled: !augurPlaceHolderDeployed,
		...(!augurPlaceHolderDeployed ? { reason: disabledTabReason } : {}),
	})
	options.push({
		value: 'open-oracle',
		label: UI_STRINGS.tabNavigation.oracleReportsTabLabel,
		href: buildRouteHref(openOracleRoute, currentRouteSearch),
		disabled: !augurPlaceHolderDeployed,
		...(!augurPlaceHolderDeployed ? { reason: disabledTabReason } : {}),
	})

	return (
		<nav className='tab-nav' aria-label={UI_STRINGS.tabNavigation.applicationSectionsAriaLabel}>
			<ViewTabs ariaLabel={UI_STRINGS.tabNavigation.applicationSectionsAriaLabel} value={route === 'not-found' ? 'deploy' : route} variant='route' onChange={value => onRouteChange(value as Exclude<TabNavigationProps['route'], 'not-found'>)} options={options} />
		</nav>
	)
}
