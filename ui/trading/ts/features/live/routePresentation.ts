import * as appCopy from '../../copy/app.js'
import { isTradingLookupRoute, tradingWorkflowRoute, type TradingLookupRoute, type TradingRoute } from '../../lib/routing.js'

/** Route name and one-line description for the workflow landings; the header badge already names the network. */
export function liveWorkflowRoutePresentation(route: TradingRoute) {
	if (route === 'create-market') return { description: appCopy.createMarketRouteDescription, title: appCopy.createMarket }
	if (route === 'liquidity') return { description: appCopy.liquidityRouteDescription, title: appCopy.liquidity }
	return { description: appCopy.marketRouteDescription, title: appCopy.market }
}

/** The list routes: the market list is named after the Markets tab, while an addressed market keeps the singular workflow name. */
export function liveLookupRoutePresentation(route: TradingLookupRoute) {
	if (route === 'market') return { description: appCopy.marketRouteDescription, title: appCopy.markets }
	return liveWorkflowRoutePresentation(route)
}

/** The header every live route shows before its contracts resolve, so the title does not change once they do. */
export function liveRouteLoadingPresentation(route: TradingRoute): { description?: string; title: string } {
	if (route === 'portfolio') return { title: appCopy.portfolio }
	if (route === 'universe') return { title: appCopy.universe }
	if (route.startsWith('security-pool/')) return { description: appCopy.securityPoolRouteDescription, title: appCopy.securityPool }
	if (isTradingLookupRoute(route)) return liveLookupRoutePresentation(route)
	return liveWorkflowRoutePresentation(tradingWorkflowRoute(route))
}
