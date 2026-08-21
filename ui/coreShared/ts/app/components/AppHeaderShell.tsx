import * as appCopy from '../../copy/app.js'
import { SimulationBanner } from '../../components/SimulationBanner.js'
import { TabNavigation } from '../../components/TabNavigation.js'
import type { SimulationController } from '../../simulation/controller.js'
import type { RouteTabDefinition } from '../../types/components.js'
import type { ComponentChildren } from 'preact'

type AppHeaderShellProps = {
	mainElementId?: string
	header?: ComponentChildren
	renderHeader?: (simulationBanner: ComponentChildren) => ComponentChildren
	overview?: ComponentChildren
	simulationController: SimulationController | undefined
	subNavigation?: ComponentChildren
	tabNavigation?: {
		route: string
		tabs: readonly RouteTabDefinition[]
		onRouteChange: (route: string) => void
	}
	onEnvironmentChanged?: () => Promise<void>
	onRefresh: () => Promise<void>
}

export function AppHeaderShell({ mainElementId = 'app-content', header, renderHeader, overview, simulationController, subNavigation, tabNavigation, onEnvironmentChanged = async () => undefined, onRefresh }: AppHeaderShellProps) {
	const focusAppContent = () => {
		const appContent = document.getElementById(mainElementId)
		if (!(appContent instanceof HTMLElement)) return
		appContent.tabIndex = -1
		appContent.focus()
	}

	const simulationBanner = simulationController === undefined ? undefined : <SimulationBanner controller={simulationController} onEnvironmentChanged={onEnvironmentChanged} onRefresh={onRefresh} />
	const shellHeader = header ?? (
		<div className='top-shell'>
			<div className='top-shell-content'>{overview}</div>
			<div className='app-nav-stack'>
				{tabNavigation === undefined ? undefined : <TabNavigation {...tabNavigation} />}
				{subNavigation}
			</div>
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
				renderHeader(simulationBanner)
			)}
		</>
	)
}
