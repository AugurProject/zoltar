import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { navigateToUrl, subscribeToLocationChanges } from '../../navigation/historyEntries.js'
import { type AppRoute, ensureRouteHash, getCurrentRoute, getRouteHref } from '../../navigation/routing.js'

/**
 * The current route, re-read after every URL change. It follows the same location changes as the URL search state, so a
 * Back/Forward step or a link that changes both renders once with the new route and search instead of a mixed page.
 */
export function useRouteSignal<TRoute extends string>(readRoute: () => TRoute, acceptChange?: (next: TRoute, previous: TRoute) => boolean) {
	const route = useSignal(readRoute())
	const options = useRef({ readRoute, acceptChange })
	options.current = { readRoute, acceptChange }
	useEffect(
		() =>
			subscribeToLocationChanges(() => {
				const next = options.current.readRoute()
				const previous = route.peek()
				if (next === previous) return
				if (options.current.acceptChange?.(next, previous) === false) return
				route.value = next
			}),
		[],
	)
	return route
}

export function useHashRoute() {
	const route = useRouteSignal(getCurrentRoute)
	const navigate = (nextRoute: AppRoute, preservedParameters: ReadonlySet<string> = new Set()) => {
		navigateToUrl(getRouteHref(nextRoute, preservedParameters))
	}
	useEffect(() => {
		ensureRouteHash()
		route.value = getCurrentRoute()
	}, [])
	return { navigate, route: route.value }
}
