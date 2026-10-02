import { buildRouteHref, getRouteHashSearch, parseRouteHash } from '@zoltar/ui-core-shared/navigation/routing.js'
import { readStringQueryParam, setOrDeleteSearchParam, updateSearchParams } from '@zoltar/ui-core-shared/navigation/urlParams.js'
import type { MarketFilter, MarketListOptions, MarketSort } from './marketListing.js'

/**
 * Route-scoped view state kept in the route hash's query, so a refresh or Back restores it: the trade ticket's
 * direction and outcome, the closed-market workspace view, and the market list's search, status filter, and sort.
 * These parameters describe one route, so links to another route drop them, and they never select the environment.
 */

export type TicketSide = 'YES' | 'NO'
type TicketMode = 'entry' | 'exit'
export type TicketSelection = Readonly<{ mode: TicketMode; side: TicketSide }>
export type MarketWorkspaceView = 'trade' | 'settlement'

const TICKET_QUERY_PARAM = 'ticket'
const MARKET_VIEW_QUERY_PARAM = 'view'
const LIST_QUERY_PARAM = 'q'
const LIST_FILTER_QUERY_PARAM = 'status'
const LIST_SORT_QUERY_PARAM = 'sort'
const ROUTE_STATE_QUERY_PARAMS = [TICKET_QUERY_PARAM, MARKET_VIEW_QUERY_PARAM, LIST_QUERY_PARAM, LIST_FILTER_QUERY_PARAM, LIST_SORT_QUERY_PARAM] as const

const DEFAULT_TICKET_SELECTION: TicketSelection = { mode: 'entry', side: 'YES' }
export const DEFAULT_MARKET_LIST_OPTIONS: MarketListOptions = { filter: 'all', query: '', sort: 'recent' }

const MARKET_FILTERS: readonly MarketFilter[] = ['all', 'open', 'closing-soon', 'resolved']
const MARKET_SORTS: readonly MarketSort[] = ['closing-soon', 'liquidity', 'recent']

function ticketParamValue({ mode, side }: TicketSelection) {
	return `${mode === 'entry' ? 'buy' : 'sell'}-${side.toLowerCase()}`
}

/** The ticket direction and outcome named by `?ticket=buy-yes|buy-no|sell-yes|sell-no`. */
export function readTicketParam(search: string): TicketSelection | undefined {
	const value = readStringQueryParam(search, TICKET_QUERY_PARAM)?.trim().toLowerCase()
	const match = value === undefined ? null : /^(buy|sell)-(yes|no)$/.exec(value)
	if (match === null) return undefined
	return { mode: match[1] === 'sell' ? 'exit' : 'entry', side: match[2] === 'no' ? 'NO' : 'YES' }
}

/** Records the ticket selection; the default (buy YES) leaves no parameter so untouched market URLs stay short. */
export function writeTicketParam(search: string, selection: TicketSelection) {
	const isDefault = selection.mode === DEFAULT_TICKET_SELECTION.mode && selection.side === DEFAULT_TICKET_SELECTION.side
	return updateSearchParams(search, params => setOrDeleteSearchParam(params, TICKET_QUERY_PARAM, isDefault ? undefined : ticketParamValue(selection)))
}

export function readMarketViewParam(search: string): MarketWorkspaceView | undefined {
	const value = readStringQueryParam(search, MARKET_VIEW_QUERY_PARAM)?.trim().toLowerCase()
	if (value === 'trade' || value === 'settlement') return value
	return undefined
}

export function writeMarketViewParam(search: string, view: MarketWorkspaceView | undefined) {
	return updateSearchParams(search, params => setOrDeleteSearchParam(params, MARKET_VIEW_QUERY_PARAM, view))
}

function isMarketFilter(value: string | undefined): value is MarketFilter {
	return MARKET_FILTERS.some(filter => filter === value)
}

function isMarketSort(value: string | undefined): value is MarketSort {
	return MARKET_SORTS.some(sort => sort === value)
}

function isDefaultMarketListOptions(options: MarketListOptions) {
	return options.filter === DEFAULT_MARKET_LIST_OPTIONS.filter && options.query === DEFAULT_MARKET_LIST_OPTIONS.query && options.sort === DEFAULT_MARKET_LIST_OPTIONS.sort
}

/** The market list's search, status filter, and sort; missing or unknown values fall back to the defaults. */
export function readMarketListParams(search: string): MarketListOptions {
	const filter = readStringQueryParam(search, LIST_FILTER_QUERY_PARAM)
	const sort = readStringQueryParam(search, LIST_SORT_QUERY_PARAM)
	const query = new URLSearchParams(search).get(LIST_QUERY_PARAM) ?? DEFAULT_MARKET_LIST_OPTIONS.query
	const options = { filter: isMarketFilter(filter) ? filter : DEFAULT_MARKET_LIST_OPTIONS.filter, query, sort: isMarketSort(sort) ? sort : DEFAULT_MARKET_LIST_OPTIONS.sort }
	return isDefaultMarketListOptions(options) ? DEFAULT_MARKET_LIST_OPTIONS : options
}

/** Records the non-default list options; the search text is kept as typed so the field restores exactly. */
export function writeMarketListParams(search: string, options: MarketListOptions) {
	return updateSearchParams(search, params => {
		if (options.query === '') params.delete(LIST_QUERY_PARAM)
		else params.set(LIST_QUERY_PARAM, options.query)
		setOrDeleteSearchParam(params, LIST_FILTER_QUERY_PARAM, options.filter === DEFAULT_MARKET_LIST_OPTIONS.filter ? undefined : options.filter)
		setOrDeleteSearchParam(params, LIST_SORT_QUERY_PARAM, options.sort === DEFAULT_MARKET_LIST_OPTIONS.sort ? undefined : options.sort)
	})
}

/** Drops every route-scoped parameter, for links that leave the current route and for the environment key. */
export function withoutRouteStateParams(search: string) {
	return updateSearchParams(search, params => {
		for (const key of ROUTE_STATE_QUERY_PARAMS) params.delete(key)
	})
}

/** Rewrites the current hash's query in place; replacing the history entry keeps Back on the previous page and fires no route change. */
export function replaceRouteHashSearch(update: (search: string) => string) {
	const { routeHash, search } = parseRouteHash(window.location.hash)
	const next = buildRouteHref(routeHash, update(search))
	if (next !== window.location.hash) window.history.replaceState(window.history.state, '', next)
}

/** Market link that opens the trade ticket on `selection`, keeping the environment parameters of the current hash. */
export function marketTicketHref(pool: string, selection: TicketSelection, currentSearch = getRouteHashSearch()) {
	return buildRouteHref(
		`#/market/${pool}`,
		updateSearchParams(withoutRouteStateParams(currentSearch), params => params.set(TICKET_QUERY_PARAM, ticketParamValue(selection))),
	)
}

/** Market link that opens the trade or settlement view, keeping the environment parameters of the current hash. */
export function marketViewHref(pool: string, view: MarketWorkspaceView | undefined, currentSearch = getRouteHashSearch()) {
	return buildRouteHref(`#/market/${pool}`, writeMarketViewParam(withoutRouteStateParams(currentSearch), view))
}
