import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { buildRouteHref, ensureRouteHash, getCurrentRoute, getRouteHash, getTopLevelRouteSearch } from '../../lib/routing.js'
import type { Route } from '../../types/app.js'

export function useHashRoute() {
	const route = useSignal<Route>(getCurrentRoute())

	const navigate = (nextRoute: Exclude<Route, 'not-found'>, preservedParameters: ReadonlySet<string> = new Set()) => {
		window.location.hash = buildRouteHref(getRouteHash(nextRoute), getTopLevelRouteSearch(nextRoute, undefined, preservedParameters))
	}

	useEffect(() => {
		ensureRouteHash()
		route.value = getCurrentRoute()

		const onHashChange = () => {
			route.value = getCurrentRoute()
		}

		window.addEventListener('hashchange', onHashChange)

		return () => {
			window.removeEventListener('hashchange', onHashChange)
		}
	}, [])

	return {
		navigate,
		route: route.value,
	}
}
