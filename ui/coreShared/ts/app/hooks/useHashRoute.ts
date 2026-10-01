import { useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'
import { type AppRoute, ensureRouteHash, getCurrentRoute, getRouteHref } from '../../navigation/routing.js'

export function useRouteSignal<TRoute extends string>(readRoute: () => TRoute, acceptChange?: (next: TRoute, previous: TRoute) => boolean) {
	const route = useSignal(readRoute())
	const options = useRef({ readRoute, acceptChange })
	options.current = { readRoute, acceptChange }
	useEffect(() => {
		const onHashChange = () => {
			const next = options.current.readRoute()
			if (options.current.acceptChange?.(next, route.peek()) === false) return
			route.value = next
		}
		window.addEventListener('hashchange', onHashChange)
		return () => window.removeEventListener('hashchange', onHashChange)
	}, [])
	return route
}

export function useHashRoute() {
	const route = useRouteSignal(getCurrentRoute)
	const navigate = (nextRoute: AppRoute, preservedParameters: ReadonlySet<string> = new Set()) => {
		window.location.hash = getRouteHref(nextRoute, preservedParameters)
	}
	useEffect(() => {
		ensureRouteHash()
		route.value = getCurrentRoute()
	}, [])
	return { navigate, route: route.value }
}
