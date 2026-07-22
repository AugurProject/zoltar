import * as appCopy from '../copy/app.js'
import * as commonCopy from '../copy/common.js'
import { ViewTabs } from './ViewTabs.js'
import { buildRouteHref, getTopLevelRouteSearch } from '../lib/routing.js'
import type { TabNavigationProps } from '../types/components.js'

export function TabNavigation({ route, showDeployTab = true, augurStatoblastDeployed, deployRoute, marketRoute, openOracleRoute, securityPoolsRoute, onRouteChange }: TabNavigationProps) {
	const disabledTabReason = appCopy.deploymentRequiredDetail
	const options: Array<{ disabled?: boolean; href: string; label: string; reason?: string; value: Exclude<TabNavigationProps['route'], 'not-found'> }> = []
	if (showDeployTab) options.push({ value: 'deploy', label: commonCopy.deploy, href: buildRouteHref(deployRoute, getTopLevelRouteSearch('deploy')) })
	options.push({
		value: 'zoltar',
		label: commonCopy.zoltar,
		href: buildRouteHref(marketRoute, getTopLevelRouteSearch('zoltar')),
		disabled: !augurStatoblastDeployed,
		...(!augurStatoblastDeployed ? { reason: disabledTabReason } : {}),
	})
	options.push({
		value: 'security-pools',
		label: commonCopy.securityPools,
		href: buildRouteHref(securityPoolsRoute, getTopLevelRouteSearch('security-pools')),
		disabled: !augurStatoblastDeployed,
		...(!augurStatoblastDeployed ? { reason: disabledTabReason } : {}),
	})
	options.push({
		value: 'open-oracle',
		label: appCopy.oracleReports,
		href: buildRouteHref(openOracleRoute, getTopLevelRouteSearch('open-oracle')),
		disabled: !augurStatoblastDeployed,
		...(!augurStatoblastDeployed ? { reason: disabledTabReason } : {}),
	})

	return (
		<nav className='tab-nav' aria-label={appCopy.applicationSections} role='navigation'>
			<ViewTabs ariaLabel={appCopy.applicationSections} semantics='navigation' value={route === 'not-found' ? 'deploy' : route} variant='route' onChange={value => onRouteChange(value as Exclude<TabNavigationProps['route'], 'not-found'>)} options={options} />
			<label className='mobile-route-select'>
				<span>{appCopy.currentApplicationSection}</span>
				<select aria-label={appCopy.currentApplicationSection} value={route === 'not-found' ? 'deploy' : route} onChange={event => onRouteChange(event.currentTarget.value as Exclude<TabNavigationProps['route'], 'not-found'>)}>
					{options.map(option => (
						<option key={option.value} value={option.value} disabled={option.disabled}>
							{option.label}
						</option>
					))}
				</select>
			</label>
			<a className='protocol-guide-link' href={appCopy.protocolGuideHref} target='_blank' rel='noreferrer'>
				{appCopy.protocolGuide}
			</a>
		</nav>
	)
}
