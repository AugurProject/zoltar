import { liveCopy } from '../copy/live.js'
import { getTradingRouteHref, tradingBrowseRouteFor, type TradingLookupRoute } from '../lib/routing.js'
import { OpenPoolForm } from './OpenPoolForm.js'

/** Address-first entry for a workflow: open an exact SecurityPool, or leave for the separate browse route. */
export function LiveMarketLookup({ route, disabled }: { route: TradingLookupRoute; disabled: boolean }) {
	const browseRoute = tradingBrowseRouteFor(route)
	return (
		<section class='section market-lookup'>
			<OpenPoolForm disabled={disabled} target={route} />
			<a class='secondary-action' href={getTradingRouteHref(`#/${browseRoute}`)} aria-disabled={disabled} onClick={disabled ? event => event.preventDefault() : undefined}>
				{browseRoute === 'security-pools' ? liveCopy.browseSecurityPools : liveCopy.browseMarkets}
			</a>
		</section>
	)
}
