import { ViewTabs } from './ViewTabs.js'
import { buildRouteHref, getRouteHashSearch } from '../lib/routing.js'
import type { TabNavigationProps } from '../types/components.js'

export function TabNavigation({ route, showDeployTab = true, augurPlaceHolderDeployed, deployRoute, marketRoute, openOracleRoute, securityPoolsRoute, onRouteChange }: TabNavigationProps) {
	const disabledTabReason = 'Deploy the application contracts before using this section.'
	const options: Array<{ disabled?: boolean; href: string; label: string; reason?: string; value: Exclude<TabNavigationProps['route'], 'not-found'> }> = []
	const currentRouteSearch = getRouteHashSearch()
	if (showDeployTab) options.push({ value: 'deploy', label: 'Deploy', href: buildRouteHref(deployRoute, currentRouteSearch) })
	options.push({
		value: 'zoltar',
		label: 'Markets',
		href: buildRouteHref(marketRoute, currentRouteSearch),
		disabled: !augurPlaceHolderDeployed,
		...(!augurPlaceHolderDeployed ? { reason: disabledTabReason } : {}),
	})
	options.push({
		value: 'security-pools',
		label: 'Security Pools',
		href: buildRouteHref(securityPoolsRoute, currentRouteSearch),
		disabled: !augurPlaceHolderDeployed,
		...(!augurPlaceHolderDeployed ? { reason: disabledTabReason } : {}),
	})
	options.push({
		value: 'open-oracle',
		label: 'Oracle Reports',
		href: buildRouteHref(openOracleRoute, currentRouteSearch),
		disabled: !augurPlaceHolderDeployed,
		...(!augurPlaceHolderDeployed ? { reason: disabledTabReason } : {}),
	})

	return (
		<nav className='tab-nav' aria-label='Application sections'>
			<ViewTabs ariaLabel='Application sections' value={route === 'not-found' ? 'deploy' : route} variant='route' onChange={value => onRouteChange(value as Exclude<TabNavigationProps['route'], 'not-found'>)} options={options} />
		</nav>
	)
}
