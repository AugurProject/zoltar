import { hasInvalidUniverseQueryParam } from '@zoltar/ui-core-shared/navigation/urlParams.js'
import { isSupportedSelectedPoolView } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/securityPoolWorkflow.js'
import type { StatoblastRoute } from '@zoltar/ui-statoblast-shared/types/app.js'

type StatoblastRouteValidationInput = {
	/** The page query (`window.location.search`), which can also carry the universe. */
	pageSearch: string
	resolvedRoute: StatoblastRoute
	/** The hash query. */
	search: string
	selectedPoolView: string
}

/** Pool locations come from the hash path, which the router already rejects when malformed, so only an unknown pool tab, a removed OpenOracle view parameter, or a malformed universe can make an otherwise resolved route invalid. */
export function getInvalidStatoblastRouteState({ pageSearch, resolvedRoute, search, selectedPoolView }: StatoblastRouteValidationInput) {
	return {
		hasInvalidOpenOracleView: new URLSearchParams(search).has('openOracleView'),
		hasInvalidSelectedPoolView: resolvedRoute === 'pools' && !isSupportedSelectedPoolView(selectedPoolView),
		// A malformed universe would otherwise open Genesis as if the link had named it.
		hasInvalidUniverse: hasInvalidUniverseQueryParam(search) || hasInvalidUniverseQueryParam(pageSearch),
	}
}

/** True when any part of the route state is invalid, so the app shows the not-found page. */
export function isInvalidStatoblastRouteState(invalidRouteState: ReturnType<typeof getInvalidStatoblastRouteState>) {
	return Object.values(invalidRouteState).some(invalid => invalid)
}
