import { useEffect, useState } from 'preact/hooks'
import { DEPLOY_ROUTE, ensureRouteHash, getCurrentRoute, MARKET_ROUTE, OPEN_ORACLE_ROUTE, SECURITY_POOLS_OVERVIEW_ROUTE, SECURITY_POOL_ROUTE, SECURITY_VAULT_ROUTE, TRADING_ROUTE } from '../lib/routing.js'
import type { Route } from '../types/app.js'

export function useHashRoute() {
	const [route, setRoute] = useState<Route>(() => getCurrentRoute())

	const navigate = (nextRoute: Route) => {
		window.location.hash = nextRoute === 'markets' ? MARKET_ROUTE : nextRoute === 'security-pools' ? SECURITY_POOL_ROUTE : nextRoute === 'security-pools-overview' ? SECURITY_POOLS_OVERVIEW_ROUTE : nextRoute === 'security-vaults' ? SECURITY_VAULT_ROUTE : nextRoute === 'open-oracle' ? OPEN_ORACLE_ROUTE : nextRoute === 'trading' ? TRADING_ROUTE : DEPLOY_ROUTE
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
