import { OverviewPanels } from './OverviewPanels.js'
import { SimulationBanner } from './SimulationBanner.js'
import { TabNavigation } from './TabNavigation.js'
import type { OverviewPanelsProps, TabNavigationProps } from '../types/components.js'
import type { SimulationController } from '../simulation/controller.js'
import type { ComponentChildren } from 'preact'

type AppHeaderShellProps = {
	overview: OverviewPanelsProps
	simulationController: SimulationController | undefined
	subNavigation?: ComponentChildren
	tabNavigation: TabNavigationProps
	onRefresh: () => Promise<void>
}

export function AppHeaderShell({ overview, simulationController, subNavigation, tabNavigation, onRefresh }: AppHeaderShellProps) {
	return (
		<>
			{simulationController === undefined ? undefined : <SimulationBanner controller={simulationController} onRefresh={onRefresh} />}
			<div className='top-shell'>
				<div className='top-shell-content'>
					<OverviewPanels {...overview} />
				</div>
				<TabNavigation {...tabNavigation} />
				{subNavigation}
			</div>
		</>
	)
}
