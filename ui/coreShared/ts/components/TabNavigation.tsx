import * as appCopy from '../copy/app.js'
import { ViewTabs } from './ViewTabs.js'
import { buildRouteHref, getTopLevelRouteSearch } from '../lib/routing.js'
import type { RouteTabDefinition } from '../types/components.js'

type TabNavigationProps = {
	route: string
	tabs: readonly RouteTabDefinition[]
	onRouteChange: (route: string) => void
}

export function TabNavigation({ route, tabs, onRouteChange }: TabNavigationProps) {
	const options = tabs.map(tab => ({
		value: tab.route,
		label: tab.label,
		href: buildRouteHref(tab.hash, getTopLevelRouteSearch(tab.route)),
		...(tab.disabled ? { disabled: true } : {}),
		...(tab.disabled && tab.disabledReason !== undefined ? { reason: tab.disabledReason } : {}),
	}))
	const disabledReason = tabs.find(tab => tab.disabled)?.disabledReason
	const fallbackRoute = tabs[0]?.route ?? route
	const effectiveRoute = route === 'not-found' ? fallbackRoute : route

	return (
		<nav className='tab-nav' aria-label={appCopy.applicationSections} role='navigation'>
			<ViewTabs ariaLabel={appCopy.applicationSections} semantics='navigation' value={effectiveRoute} variant='route' onChange={value => onRouteChange(value)} options={options} />
			<label className='mobile-route-select'>
				<span>{appCopy.currentApplicationSection}</span>
				<select aria-label={appCopy.currentApplicationSection} value={effectiveRoute} onChange={event => onRouteChange(event.currentTarget.value)}>
					{options.map(option => (
						<option key={option.value} value={option.value} disabled={option.disabled}>
							{option.label}
						</option>
					))}
				</select>
				{disabledReason !== undefined ? <span className='detail disabled-reason'>{disabledReason}</span> : undefined}
			</label>
			<a className='protocol-guide-link' href={appCopy.protocolGuideHref} target='_blank' rel='noreferrer'>
				{appCopy.protocolGuide}
			</a>
		</nav>
	)
}
