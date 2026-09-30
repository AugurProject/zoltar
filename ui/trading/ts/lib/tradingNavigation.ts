import { withDeploymentTab } from '@zoltar/ui-core-shared/navigation/appNavigation.js'
import type { RouteTabDefinition } from '@zoltar/ui-core-shared/types/components.js'
import * as appCopy from '../copy/app.js'

type TradingNavigationState = {
	/** The security pool the current route addresses; the market link keeps it. */
	addressedPool: string | undefined
	displayedRoute: string
	liveDeploymentStatus: 'loading' | 'verified' | 'missing' | 'unreachable'
}

/** The navigation entry a workflow route belongs to: a market's liquidity view sits under Markets. */
export function tradingNavigationRoute(workflowRoute: string) {
	return workflowRoute === 'liquidity' ? 'market' : workflowRoute
}

/**
 * Trading's navigation: the trader's three jobs in the tab bar and everything else under "More". The deployment
 * tab leads the bar only while the contracts are confirmed missing or the user is on the deployment route.
 */
export function tradingNavigationTabs({ addressedPool, displayedRoute, liveDeploymentStatus }: TradingNavigationState): { moreTabs: RouteTabDefinition[]; tabs: RouteTabDefinition[] } {
	const deploymentTab: RouteTabDefinition = { route: 'deploy', hash: '#/deploy', label: appCopy.deploy }
	const primaryTabs: RouteTabDefinition[] = [
		{ route: 'market', hash: addressedPool === undefined ? '#/market' : `#/market/${addressedPool}`, label: appCopy.markets },
		{ route: 'portfolio', hash: '#/portfolio', label: appCopy.portfolio },
		{ route: 'create-market', hash: '#/create-market', label: appCopy.create },
	]
	// Liquidity is a view of a market, reached from its ticket tab or its card, so it has no navigation entry of its own.
	const secondaryTabs: RouteTabDefinition[] = [
		{ route: 'universe', hash: '#/universe', label: appCopy.universe },
		{ route: 'help', hash: '#/help', label: appCopy.help },
	]
	// Navigation never waits for a transaction; a pending one stays in the activity list and keeps its market locked.
	return {
		moreTabs: secondaryTabs,
		tabs: withDeploymentTab({ deploymentTab, deploymentIncomplete: liveDeploymentStatus === 'missing', route: displayedRoute, tabs: primaryTabs }),
	}
}
