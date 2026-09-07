import * as appCopy from '../../copy/app.js'
import * as commonCopy from '../../copy/common.js'
import * as liquidityCopy from '../../copy/liquidity.js'
import type { TradingRoute } from '../../lib/routing.js'

function marketRouteSubtitle(chainName: string, simulationActive: boolean) {
	return simulationActive ? commonCopy.conditionalPricesOnly : commonCopy.formatNetworkConditionalPrices(chainName)
}

export function liveWorkflowRoutePresentation(route: TradingRoute, chainName: string, simulationActive: boolean) {
	if (route === 'liquidity') return { description: liquidityCopy.routeDescription, title: appCopy.liquidity }
	return { description: marketRouteSubtitle(chainName, simulationActive), title: appCopy.markets }
}

export function portfolioRouteSubtitle(chainName: string, simulationActive: boolean) {
	return simulationActive ? undefined : chainName
}
