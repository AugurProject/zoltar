import * as appCopy from '../../copy/app.js'
import { SimulationBanner } from '../../components/SimulationBanner.js'
import { TabNavigation } from '../../components/TabNavigation.js'
import type { SimulationController } from '../../simulation/controller.js'
import type { RouteTabDefinition } from '../../types/components.js'
import type { SecondaryNavigation } from '../../navigation/appNavigation.js'
import type { ComponentChildren } from 'preact'
import { AppSettingsMenu } from './AppSettingsMenu.js'
import { RouteSubNavigation } from './RouteSubNavigation.js'

type AppHeaderShellProps = {
	mainElementId?: string
	header?: ComponentChildren
	renderHeader?: (simulationBanner: ComponentChildren, settingsMenu: ComponentChildren) => ComponentChildren
	overview?: ComponentChildren
	renderOverview?: (settingsMenu: ComponentChildren) => ComponentChildren
	simulationController: SimulationController | undefined
	/** Secondary views of the current primary route. Rendered only while the current route is one of the primary tabs. */
	secondaryNavigation?: SecondaryNavigation | undefined
	tabNavigation?: {
		route: string
		tabs: readonly RouteTabDefinition[]
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
	const settingsMenu = <AppSettingsMenu onEnvironmentChanged={onEnvironmentChanged} settingsContent={settingsContent} />
	const currentRouteIsPrimaryTab = tabNavigation !== undefined && tabNavigation.tabs.some(tab => tab.route === tabNavigation.route)
	const secondaryTabs = secondaryNavigation !== undefined && currentRouteIsPrimaryTab ? <RouteSubNavigation ariaLabel={secondaryNavigation.ariaLabel} value={secondaryNavigation.value} onChange={secondaryNavigation.onChange} options={secondaryNavigation.options} /> : undefined
	const showProtocolGuide = tabNavigation !== undefined && tabNavigation.showProtocolGuide !== false
	const showPrimaryTabs = tabNavigation !== undefined && tabNavigation.tabs.length > 1
	const navigationStack =
		!showPrimaryTabs && secondaryTabs === undefined && !showProtocolGuide ? undefined : (
			<div className='app-nav-stack'>
				{tabNavigation === undefined ? undefined : <TabNavigation {...tabNavigation} showProtocolGuide={false} />}
				{secondaryTabs}
				{showProtocolGuide ? (
					<a className='protocol-guide-link' href={appCopy.protocolGuideHref} target='_blank' rel='noreferrer'>
						{appCopy.protocolGuide}
					</a>
				) : undefined}
			</div>
		)
	const shellHeader = header ?? (
		<div className='top-shell'>
			{renderOverview === undefined ? <div className='top-shell-settings-row'>{settingsMenu}</div> : undefined}
			<div className='top-shell-content'>{renderOverview === undefined ? overview : renderOverview(settingsMenu)}</div>
			{navigationStack}
		</div>
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
