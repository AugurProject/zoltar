import { ViewTabs } from './ViewTabs.js'
import { buildRouteHref, getRouteHashSearch } from '../lib/routing.js'
import { UI_STRING_APPLICATION_SECTIONS, UI_STRING_DEPLOY, UI_STRING_DEPLOY_THE_APPLICATION_CONTRACTS_BEFORE_USING_THIS_SECTION, UI_STRING_MARKETS, UI_STRING_ORACLE_REPORTS, UI_STRING_SECURITY_POOLS } from '../lib/uiStrings.js'
import type { TabNavigationProps } from '../types/components.js'

export function TabNavigation({ route, showDeployTab = true, augurPlaceHolderDeployed, deployRoute, marketRoute, openOracleRoute, securityPoolsRoute, onRouteChange }: TabNavigationProps) {
	const disabledTabReason = UI_STRING_DEPLOY_THE_APPLICATION_CONTRACTS_BEFORE_USING_THIS_SECTION
	const options: Array<{ disabled?: boolean; href: string; label: string; reason?: string; value: Exclude<TabNavigationProps['route'], 'not-found'> }> = []
	const currentRouteSearch = getRouteHashSearch()
	if (showDeployTab) options.push({ value: 'deploy', label: UI_STRING_DEPLOY, href: buildRouteHref(deployRoute, currentRouteSearch) })
	options.push({
		value: 'zoltar',
		label: UI_STRING_MARKETS,
		href: buildRouteHref(marketRoute, currentRouteSearch),
		disabled: !augurPlaceHolderDeployed,
		...(!augurPlaceHolderDeployed ? { reason: disabledTabReason } : {}),
	})
	options.push({
		value: 'security-pools',
		label: UI_STRING_SECURITY_POOLS,
		href: buildRouteHref(securityPoolsRoute, currentRouteSearch),
		disabled: !augurPlaceHolderDeployed,
		...(!augurPlaceHolderDeployed ? { reason: disabledTabReason } : {}),
	})
	options.push({
		value: 'open-oracle',
		label: UI_STRING_ORACLE_REPORTS,
		href: buildRouteHref(openOracleRoute, currentRouteSearch),
		disabled: !augurPlaceHolderDeployed,
		...(!augurPlaceHolderDeployed ? { reason: disabledTabReason } : {}),
	})

	return (
		<nav className='tab-nav' aria-label={UI_STRING_APPLICATION_SECTIONS}>
			<ViewTabs ariaLabel={UI_STRING_APPLICATION_SECTIONS} value={route === 'not-found' ? 'deploy' : route} variant='route' onChange={value => onRouteChange(value as Exclude<TabNavigationProps['route'], 'not-found'>)} options={options} />
		</nav>
	)
}
