import * as appCopy from '../../copy/app.js'
import { SimulationBanner } from '../../components/SimulationBanner.js'
import { TabNavigation } from '../../components/TabNavigation.js'
import type { SimulationController } from '../../simulation/controller.js'
import type { RouteTabDefinition } from '../../types/components.js'
import type { ComponentChildren } from 'preact'

type AppHeaderShellProps = {
	overview: ComponentChildren
	simulationController: SimulationController | undefined
	subNavigation?: ComponentChildren
	tabNavigation: {
		route: string
		tabs: readonly RouteTabDefinition[]
		onRouteChange: (route: string) => void
	}
	onEnvironmentChanged?: () => Promise<void>
	onRefresh: () => Promise<void>
}

export function AppHeaderShell({ overview, simulationController, subNavigation, tabNavigation, onEnvironmentChanged = async () => undefined, onRefresh }: AppHeaderShellProps) {
	const focusAppContent = () => {
		const appContent = document.getElementById('app-content')
		if (appContent instanceof HTMLElement) appContent.focus()
	}

	return (
		<>
			<button className='skip-link' type='button' onClick={focusAppContent}>
				{appCopy.skipToMainContent}
			</button>
			{simulationController === undefined ? undefined : <SimulationBanner controller={simulationController} onEnvironmentChanged={onEnvironmentChanged} onRefresh={onRefresh} />}
			<div className='top-shell'>
				<div className='top-shell-content'>{overview}</div>
				<div className='app-nav-stack'>
					<TabNavigation {...tabNavigation} />
					{subNavigation}
				</div>
			</div>
		</>
	)
}
