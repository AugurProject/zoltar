import { useEffect, useState } from 'preact/hooks'
import { getCurrentRoute } from '../lib/routing.js'
import type { Route } from '../types/app.js'

export function useHashRoute() {
	const [route, setRoute] = useState<Route>(() => getCurrentRoute())

	useEffect(() => {
		const onHashChange = () => {
			setRoute(getCurrentRoute())
		}

		window.addEventListener('hashchange', onHashChange)

		return () => {
			window.removeEventListener('hashchange', onHashChange)
		}
	}, [])

	return {
		route,
		setRoute,
	}
}
