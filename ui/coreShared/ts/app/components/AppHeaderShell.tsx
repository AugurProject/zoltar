import * as appCopy from '../../copy/app.js'
import { SimulationBanner } from '../../components/SimulationBanner.js'
import { NavigationBar, TabNavigation, TabNavigationUnavailableReasons } from '../../components/TabNavigation.js'
import type { SimulationController } from '../../simulation/controller.js'
import type { RouteTabDefinition } from '../../types/components.js'
import type { SecondaryNavigation } from '../../navigation/appNavigation.js'
import type { ComponentChildren } from 'preact'
import { AppSettingsMenu } from './AppSettingsMenu.js'
import { RouteSubNavigation } from './RouteSubNavigation.js'

/** The shared pieces an application places in its top bar. */
type AppChromeSlots = {
	/** Primary navigation: top-bar tabs on wide screens, a fixed bottom tab bar on narrow screens. */
	navigation: ComponentChildren
	settingsMenu: ComponentChildren
}

type AppHeaderShellProps = {
	mainElementId?: string
	header?: ComponentChildren
	renderHeader?: (simulationBanner: ComponentChildren, settingsMenu: ComponentChildren) => ComponentChildren
	overview?: ComponentChildren
	renderOverview?: (chrome: AppChromeSlots) => ComponentChildren
	simulationController: SimulationController | undefined
	/** Secondary views of the current primary route. Rendered only while the current route is one of the primary tabs. */
	secondaryNavigation?: SecondaryNavigation | undefined
	tabNavigation?: {
		route: string
		tabs: readonly RouteTabDefinition[]
		/** Sections listed under "More" so the tab bar keeps at most a handful of items. */
		moreTabs?: readonly RouteTabDefinition[]
		onRouteChange: (route: string) => void
		showProtocolGuide?: boolean
	}
	onEnvironmentChanged?: () => Promise<void>
	onRefresh: () => Promise<void>
	settingsContent?: ComponentChildren
}

export function AppHeaderShell({ mainElementId = 'app-content', header, renderHeader, overview, renderOverview, simulationController, secondaryNavigation, tabNavigation, onEnvironmentChanged = async () => undefined, onRefresh, settingsContent }: AppHeaderShellProps) {
	const focusAppContent = () => {
		const appContent = document.getElementById(mainElementId)
		if (!(appContent instanceof HTMLElement)) return
		appContent.tabIndex = -1
		appContent.focus()
	}

	const simulationBanner = simulationController === undefined ? undefined : <SimulationBanner controller={simulationController} onEnvironmentChanged={onEnvironmentChanged} onRefresh={onRefresh} />
	const showProtocolGuide = tabNavigation !== undefined && tabNavigation.showProtocolGuide !== false
	const settingsMenu = (
		<AppSettingsMenu
			onEnvironmentChanged={onEnvironmentChanged}
			settingsContent={
				<>
					{settingsContent}
					{showProtocolGuide ? (
						<a className='protocol-guide-link' href={appCopy.protocolGuideHref} target='_blank' rel='noreferrer'>
							{appCopy.protocolGuide}
						</a>
					) : undefined}
				</>
			}
		/>
	)
	const allTabs = tabNavigation === undefined ? [] : [...tabNavigation.tabs, ...(tabNavigation.moreTabs ?? [])]
	const currentRouteIsPrimaryTab = tabNavigation !== undefined && allTabs.some(tab => tab.route === tabNavigation.route)
	const activeSecondaryNavigation = secondaryNavigation !== undefined && currentRouteIsPrimaryTab ? secondaryNavigation : undefined
	const showPrimaryTabs = allTabs.length > 1
	// A single-section application promotes that section's views into the tab bar instead of stacking a second row.
	const promoteSecondaryNavigation = !showPrimaryTabs && activeSecondaryNavigation !== undefined
	const navigation = (() => {
		if (promoteSecondaryNavigation) return <NavigationBar ariaLabel={activeSecondaryNavigation.ariaLabel} options={activeSecondaryNavigation.options} value={activeSecondaryNavigation.value} onChange={activeSecondaryNavigation.onChange} />
		if (tabNavigation === undefined || !showPrimaryTabs) return undefined
		return <TabNavigation route={tabNavigation.route} tabs={tabNavigation.tabs} onRouteChange={tabNavigation.onRouteChange} {...(tabNavigation.moreTabs === undefined ? {} : { moreTabs: tabNavigation.moreTabs })} />
	})()
	const routeViews = activeSecondaryNavigation === undefined || promoteSecondaryNavigation ? undefined : <RouteSubNavigation ariaLabel={activeSecondaryNavigation.ariaLabel} value={activeSecondaryNavigation.value} onChange={activeSecondaryNavigation.onChange} options={activeSecondaryNavigation.options} />
	const shellHeader = header ?? (
		<>
			<div className='app-chrome'>
				{renderOverview === undefined ? (
					<div className='header-toolbar'>
						{overview}
						{navigation === undefined ? undefined : <div className='header-toolbar-navigation'>{navigation}</div>}
						<div className='header-toolbar-settings'>{settingsMenu}</div>
					</div>
				) : (
					renderOverview({ navigation, settingsMenu })
				)}
				<TabNavigationUnavailableReasons tabs={allTabs} />
			</div>
			{routeViews}
		</>
	)

	return (
		<>
			<button className='skip-link' type='button' onClick={focusAppContent}>
				{appCopy.skipToMainContent}
			</button>
			{renderHeader === undefined ? (
				<>
					{simulationBanner}
					{shellHeader}
				</>
			) : (
				renderHeader(simulationBanner, settingsMenu)
			)}
		</>
	)
}
