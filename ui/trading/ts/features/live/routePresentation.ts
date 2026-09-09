import * as appCopy from '../../copy/app.js'
import * as liquidityCopy from '../../copy/liquidity.js'
import type { TradingRoute } from '../../lib/routing.js'

function marketRouteSubtitle(chainName: string, simulationActive: boolean) {
	return simulationActive ? undefined : chainName
}

export function liveWorkflowRoutePresentation(route: TradingRoute, chainName: string, simulationActive: boolean) {
	if (route === 'create-market') return { description: undefined, title: appCopy.createMarket }
	if (route === 'liquidity') return { description: liquidityCopy.routeDescription, title: appCopy.liquidity }
	return { description: marketRouteSubtitle(chainName, simulationActive), title: route === 'market' ? appCopy.market : appCopy.markets }
}

export function portfolioRouteSubtitle(chainName: string, simulationActive: boolean) {
	return simulationActive ? undefined : chainName
}
