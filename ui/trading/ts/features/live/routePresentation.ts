import * as appCopy from '../../copy/app.js'
import { tradingWorkflowRoute, type TradingRoute } from '../../lib/routing.js'

/** Route name and one-line description for the workflow landings; the header badge already names the network. */
export function liveWorkflowRoutePresentation(route: TradingRoute) {
	if (route === 'create-market') return { description: appCopy.createMarketRouteDescription, title: appCopy.createMarket }
	if (route === 'liquidity') return { description: appCopy.liquidityRouteDescription, title: appCopy.liquidity }
	return { description: appCopy.marketRouteDescription, title: appCopy.market }
}

/** The header every live route shows before its contracts resolve, so the title does not change once they do. */
export function liveRouteLoadingPresentation(route: TradingRoute): { description?: string; title: string } {
	if (route === 'portfolio') return { title: appCopy.portfolio }
	if (route === 'universe') return { description: appCopy.universeRouteDescription, title: appCopy.universe }
	if (route.startsWith('security-pool/')) return { description: appCopy.securityPoolRouteDescription, title: appCopy.securityPool }
	return liveWorkflowRoutePresentation(tradingWorkflowRoute(route))
}
