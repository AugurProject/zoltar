import { buildRouteHref, getRouteHashSearch, parseRouteHash } from '@zoltar/ui-core-shared/navigation/routing.js'
import { updateSearchParams } from '@zoltar/ui-core-shared/navigation/urlParams.js'

export type TicketSide = 'YES' | 'NO'

const TICKET_SIDE_QUERY_PARAM = 'side'

/** The outcome a market-card button asked the ticket to open on, read from the route hash's query. */
export function readTicketSideParam(search: string): TicketSide | undefined {
	const value = new URLSearchParams(search).get(TICKET_SIDE_QUERY_PARAM)?.trim().toLowerCase()
	if (value === 'yes') return 'YES'
	if (value === 'no') return 'NO'
	return undefined
}

export function withoutTicketSideParam(search: string) {
	return updateSearchParams(search, params => params.delete(TICKET_SIDE_QUERY_PARAM))
}

/** Market link that opens the trade ticket with `side` preselected, keeping the environment parameters of the current hash. */
export function marketTicketHref(pool: string, side: TicketSide, currentSearch = getRouteHashSearch()) {
	return buildRouteHref(
		`#/market/${pool}`,
		updateSearchParams(currentSearch, params => params.set(TICKET_SIDE_QUERY_PARAM, side.toLowerCase())),
	)
}

/** Hash to restore after the ticket consumed its side, so later navigation does not carry the one-shot preselection. */
export function hashWithoutTicketSide(hash: string) {
	const { routeHash, search } = parseRouteHash(hash)
	return buildRouteHref(routeHash, withoutTicketSideParam(search))
}
