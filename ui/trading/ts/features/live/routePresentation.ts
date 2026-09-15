import * as appCopy from '../../copy/app.js'
import type { TradingRoute } from '../../lib/routing.js'

/** Route name and one-line description for the workflow landings; the header badge already names the network. */
export function liveWorkflowRoutePresentation(route: TradingRoute) {
	if (route === 'create-market') return { description: appCopy.createMarketRouteDescription, title: appCopy.createMarket }
	if (route === 'liquidity') return { description: appCopy.liquidityRouteDescription, title: appCopy.liquidity }
	return { description: appCopy.marketRouteDescription, title: appCopy.market }
}
