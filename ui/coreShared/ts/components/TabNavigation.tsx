import * as appCopy from '../copy/app.js'
import { ViewTabs } from './ViewTabs.js'
import { getRouteHref } from '../navigation/routing.js'
import { useDisclosurePopover } from '../hooks/useDisclosurePopover.js'
import type { RouteTabDefinition, ViewTabOption } from '../types/components.js'

type TabNavigationProps = {
	ariaLabel?: string
	route: string
	tabs: readonly RouteTabDefinition[]
	/** Secondary sections listed under a "More" menu instead of taking a slot in the tab bar. */
	moreTabs?: readonly RouteTabDefinition[]
	onRouteChange: (route: string) => void
}

function toTabOption(tab: RouteTabDefinition): ViewTabOption<string> {
	return {
		value: tab.route,
		label: tab.label,
		href: getRouteHref(tab.route, undefined, tab.hash),
		...(tab.disabled ? { disabled: true } : {}),
		...(tab.disabled && tab.disabledReason !== undefined ? { reason: tab.disabledReason } : {}),
	}
}

function MoreSectionsMenu({ onChange, options, value }: { onChange: (value: string) => void; options: readonly ViewTabOption<string>[]; value: string }) {
	const popover = useDisclosurePopover()
	const activeOption = options.find(option => option.value === value)
	return (
		<div className='tab-nav-more' ref={popover.containerRef}>
			{/* While a section under More is open, the trigger names it and carries the current marker, since its link is hidden in the closed menu. */}
			<button {...popover.triggerProps} aria-current={activeOption === undefined ? undefined : 'true'} className={`view-tab tab-nav-more-trigger${activeOption === undefined ? '' : ' active'}`} onClick={popover.toggle}>
				{activeOption === undefined ? (
					appCopy.moreSections
				) : (
					<>
						{appCopy.moreSectionsCurrentPrefix} {activeOption.label}
					</>
				)}
				<span className='tab-nav-more-caret' aria-hidden='true' />
			</button>
			{popover.open ? (
				<ul className='tab-nav-more-menu' id={popover.panelId}>
					{options.map(option => (
						<li key={option.value}>
							<a
								className={option.value === value ? 'active' : undefined}
								aria-current={option.value === value ? 'page' : undefined}
								aria-disabled={option.disabled === true ? 'true' : undefined}
								aria-description={option.reason}
								href={option.disabled === true ? undefined : option.href}
								role={option.disabled === true ? 'link' : undefined}
								tabIndex={option.disabled === true ? 0 : undefined}
								onClick={event => {
									if (option.disabled === true) {
										event.preventDefault()
										return
									}
									popover.close()
									if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
									onChange(option.value)
								}}
							>
								{option.label}
							</a>
						</li>
					))}
				</ul>
			) : undefined}
		</div>
	)
}

/**
 * The application's primary navigation. It sits in the top bar on wide screens and becomes a fixed bottom tab
 * bar on narrow screens, so it must stay short: secondary sections go in `moreTabs`.
 */
export function TabNavigation({ ariaLabel = appCopy.applicationSections, route, tabs, moreTabs = [], onRouteChange }: TabNavigationProps) {
	if (tabs.length + moreTabs.length <= 1) return undefined
	// An unknown page belongs to no section, so no tab claims to be the current page.
	return <NavigationBar ariaLabel={ariaLabel} moreOptions={moreTabs.map(toTabOption)} options={tabs.map(toTabOption)} value={route === 'not-found' ? '' : route} onChange={onRouteChange} />
}

/** The tab bar itself, for callers that already hold view options, such as a single-route application's views. */
export function NavigationBar({ ariaLabel, moreOptions = [], onChange, options, value }: { ariaLabel: string; moreOptions?: readonly ViewTabOption<string>[]; onChange: (value: string) => void; options: ViewTabOption<string>[]; value: string }) {
	return (
		<nav className='tab-nav' aria-label={ariaLabel} role='navigation'>
			<ViewTabs ariaLabel={ariaLabel} semantics='navigation' value={value} variant='route' onChange={onChange} options={options} />
			{moreOptions.length === 0 ? undefined : <MoreSectionsMenu onChange={onChange} options={moreOptions} value={value} />}
		</nav>
	)
}

/** Explains disabled sections once per distinct reason, outside the tab bar so the bar keeps one row. */
export function TabNavigationUnavailableReasons({ tabs }: { tabs: readonly RouteTabDefinition[] }) {
	// One line per distinct reason, naming every section it disables: a workflow lock disables every tab for the same cause and should say so once.
	const labelsByReason = new Map<string, string[]>()
	for (const tab of tabs) {
		if (tab.disabled !== true || tab.disabledReason === undefined) continue
		labelsByReason.set(tab.disabledReason, [...(labelsByReason.get(tab.disabledReason) ?? []), tab.label])
	}
	if (labelsByReason.size === 0) return undefined
	const everyTabDisabled = tabs.every(candidate => candidate.disabled === true)
	return (
		<div className='tab-nav-unavailable'>
			{[...labelsByReason].map(([reason, labels]) => (
				<p className='detail disabled-reason' key={reason}>
					{labelsByReason.size === 1 && everyTabDisabled ? (
						reason
					) : (
						<>
							<strong>{appCopy.formatSectionList(labels)}:</strong> {reason}
						</>
					)}
				</p>
			))}
		</div>
	)
}
