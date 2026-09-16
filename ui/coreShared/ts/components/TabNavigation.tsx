import * as appCopy from '../copy/app.js'
import { ViewTabs } from './ViewTabs.js'
import { buildRouteHref, getTopLevelRouteSearch } from '../navigation/routing.js'
import type { RouteTabDefinition } from '../types/components.js'

type TabNavigationProps = {
	route: string
	tabs: readonly RouteTabDefinition[]
	onRouteChange: (route: string) => void
	showProtocolGuide?: boolean
}

export function TabNavigation({ route, tabs, onRouteChange, showProtocolGuide = true }: TabNavigationProps) {
	const options = tabs.map(tab => ({
		value: tab.route,
		label: tab.label,
		href: buildRouteHref(tab.hash, getTopLevelRouteSearch(tab.route)),
		...(tab.disabled ? { disabled: true } : {}),
		...(tab.disabled && tab.disabledReason !== undefined ? { reason: tab.disabledReason } : {}),
	}))
	// One line per distinct reason: a workflow lock disables every tab for the same cause and should say so once.
	const unavailableReasons = [...new Map(tabs.filter(tab => tab.disabled === true && tab.disabledReason !== undefined).map(tab => [tab.disabledReason, tab])).values()]
	const fallbackRoute = tabs[0]?.route ?? route
	const effectiveRoute = route === 'not-found' ? fallbackRoute : route
	const showRouteChooser = tabs.length > 1
	if (!showRouteChooser && !showProtocolGuide) return null

	return (
		<nav className='tab-nav' aria-label={appCopy.applicationSections} role='navigation'>
			{showRouteChooser ? <ViewTabs ariaLabel={appCopy.applicationSections} semantics='navigation' value={effectiveRoute} variant='route' onChange={value => onRouteChange(value)} options={options} /> : undefined}
			{unavailableReasons.length === 0 ? undefined : (
				<div className='tab-nav-unavailable'>
					{unavailableReasons.map(tab => (
						<p className='detail disabled-reason' key={tab.route}>
							{unavailableReasons.length === 1 && tabs.every(candidate => candidate.disabled === true) ? (
								tab.disabledReason
							) : (
								<>
									<strong>{tab.label}:</strong> {tab.disabledReason}
								</>
							)}
						</p>
					))}
				</div>
			)}
			{showProtocolGuide ? (
				<a className='protocol-guide-link' href={appCopy.protocolGuideHref} target='_blank' rel='noreferrer'>
					{appCopy.protocolGuide}
				</a>
			) : undefined}
		</nav>
	)
}
