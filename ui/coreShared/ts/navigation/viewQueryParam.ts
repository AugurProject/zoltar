import { hasPresentEmptyQueryParam } from './routing.js'

type ViewQueryParamValidation = {
	/** Routes on which the parameter is meaningful; its presence anywhere else marks the route as not found. */
	allowedRoutes: readonly string[]
	allowedViews: readonly string[]
	key: string
	resolvedRoute: string
	search: string
	/** The already-read parameter value, or the empty string when absent. */
	value: string
}

/** A view parameter is invalid when it is present but empty, appears on a route that does not own it, or names an unknown view. */
export function hasInvalidViewQueryParam({ allowedRoutes, allowedViews, key, resolvedRoute, search, value }: ViewQueryParamValidation) {
	if (hasPresentEmptyQueryParam(search, key)) return true
	if (new URLSearchParams(search).has(key) && !allowedRoutes.includes(resolvedRoute)) return true
	return value !== '' && !allowedViews.includes(value)
}
