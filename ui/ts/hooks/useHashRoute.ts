import { useEffect, useState } from 'preact/hooks'
import { DEPLOY_ROUTE, ensureRouteHash, getCurrentRoute, MARKET_ROUTE, OPEN_ORACLE_ROUTE, REPORTING_ROUTE, SECURITY_POOLS_OVERVIEW_ROUTE, SECURITY_POOL_ROUTE, SECURITY_VAULT_ROUTE, TRADING_ROUTE } from '../lib/routing.js'
import { assertNever } from '../lib/assert.js'
import type { Route } from '../types/app.js'

export function useHashRoute() {
	const [route, setRoute] = useState<Route>(() => getCurrentRoute())

	const navigate = (nextRoute: Route) => {
		switch (nextRoute) {
			case 'deploy':
				window.location.hash = DEPLOY_ROUTE
				return
			case 'markets':
				window.location.hash = MARKET_ROUTE
				return
			case 'security-pools':
				window.location.hash = SECURITY_POOL_ROUTE
				return
			case 'security-pools-overview':
				window.location.hash = SECURITY_POOLS_OVERVIEW_ROUTE
				return
			case 'security-vaults':
				window.location.hash = SECURITY_VAULT_ROUTE
				return
			case 'open-oracle':
				window.location.hash = OPEN_ORACLE_ROUTE
				return
			case 'reporting':
				window.location.hash = REPORTING_ROUTE
				return
			case 'trading':
				window.location.hash = TRADING_ROUTE
				return
			default:
				assertNever(nextRoute)
		}
	}

	useEffect(() => {
		ensureRouteHash()
		setRoute(getCurrentRoute())

		const onHashChange = () => {
			setRoute(getCurrentRoute())
		}

		window.addEventListener('hashchange', onHashChange)

		return () => {
			window.removeEventListener('hashchange', onHashChange)
		}
	}, [])

	return {
		navigate,
		route,
	}
}
