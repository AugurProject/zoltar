import { withDeploymentTab } from '@zoltar/ui-core-shared/navigation/appNavigation.js'
import type { RouteTabDefinition } from '@zoltar/ui-core-shared/types/components.js'
import * as appCopy from '../copy/app.js'
import { transactionInProgressReason } from '../copy/availability.js'

type TradingNavigationState = {
	/** The security pool the current route addresses; market and liquidity links keep it. */
	addressedPool: string | undefined
	displayedRoute: string
	liveDeploymentStatus: 'loading' | 'verified' | 'missing' | 'unreachable'
	workflowLocked: boolean
}

/**
 * Trading's navigation: the trader's three jobs in the tab bar and everything else under "More". The deployment
 * tab leads the bar only while the contracts are confirmed missing or the user is on the deployment route.
 */
export function tradingNavigationTabs({ addressedPool, displayedRoute, liveDeploymentStatus, workflowLocked }: TradingNavigationState): { moreTabs: RouteTabDefinition[]; tabs: RouteTabDefinition[] } {
	const deploymentTab: RouteTabDefinition = { route: 'deploy', hash: '#/deploy', label: appCopy.deploy }
	const primaryTabs: RouteTabDefinition[] = [
		{ route: 'market', hash: addressedPool === undefined ? '#/market' : `#/market/${addressedPool}`, label: appCopy.markets },
		{ route: 'portfolio', hash: '#/portfolio', label: appCopy.portfolio },
		{ route: 'create-market', hash: '#/create-market', label: appCopy.create },
	]
	const secondaryTabs: RouteTabDefinition[] = [
		{ route: 'liquidity', hash: addressedPool === undefined ? '#/liquidity' : `#/liquidity/${addressedPool}`, label: appCopy.liquidity },
		{ route: 'universe', hash: '#/universe', label: appCopy.universe },
		{ route: 'help', hash: '#/help', label: appCopy.help },
	]
	const lock = (tab: RouteTabDefinition): RouteTabDefinition => (workflowLocked ? { ...tab, disabled: true, disabledReason: transactionInProgressReason } : tab)
	return {
		moreTabs: secondaryTabs.map(lock),
		tabs: withDeploymentTab({ deploymentTab, deploymentIncomplete: liveDeploymentStatus === 'missing', route: displayedRoute, tabs: primaryTabs }).map(lock),
	}
}
