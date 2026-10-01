import type { LiveEventPayload } from '../../browser/browser-types.ts'
import type { DemoContext } from '../../browser/demo-runtime.ts'
import { fetchApi } from '../../browser/fetch-api.ts'
import { demoAddressIdentityRoute, demoAddressInteractionsRoute, demoAddressPortfolioRoute, demoAddressTransactionsRoute, demoRichListRoute } from './demo-api/account-routes.ts'
import { demoBlockRoute, demoContractsRoute, demoLogDetailRoute, demoLogsRoute, demoNetworksRoute, demoSearchRoute, demoTransactionRoute } from './demo-api/activity-routes.ts'
import { demoCatalogRoute } from './demo-api/catalog-route.ts'
import { createDemoEnvironment, type DemoApi } from './demo-api/environment.ts'
import { demoStateHistoryRoute } from './demo-api/history.ts'
import { applyDemoBlock } from './demo-api/live.ts'
import { demoOperationsCatalogRoute, demoOperationsDetailRoute, demoOperationsRoute, demoRiskCatalogRoute } from './demo-api/operations-routes.ts'

export function createDemoApi(context: DemoContext) {
	const env = createDemoEnvironment(context)
	const { counters } = env

	Object.defineProperty(window, '__augurScanCatalogRequests', { get: () => counters.catalogRequests })
	Object.defineProperty(window, '__augurScanLiveSequence', { get: () => counters.liveSequence })

	// Route order matters: specific prefixes and patterns must be matched before broader ones.
	const api: DemoApi = async (path, { signal } = {}) => {
		if (path.startsWith('/api/v1/search?')) return await demoSearchRoute(env, path)
		if (path.startsWith('/api/v1/transactions/')) return await demoTransactionRoute(env, path)
		if (path.startsWith('/api/v1/blocks/')) return await demoBlockRoute(env, path)
		if (path.startsWith('/api/v1/networks')) return await demoNetworksRoute(env)
		if (path.startsWith('/api/v1/contracts')) return await demoContractsRoute(env, path)
		if (path.startsWith('/api/v1/operations')) return await demoOperationsRoute(env, path)
		if (/^\/api\/v1\/state\/risk(?:\?|$)/.test(path)) return await demoRiskCatalogRoute(env, path)
		if (/^\/api\/v1\/state\/(reports|escalations|auctions|forks|trading|timeline|integrity)(?:\?|$)/.test(path)) return await demoOperationsCatalogRoute(env, path)
		if (/^\/api\/v1\/state\/(reports|escalations|auctions|forks|trading|risk\/(?:pools|vaults))\//.test(path)) return await demoOperationsDetailRoute(env, path)
		if (path.startsWith('/api/v1/state/catalog')) return await demoCatalogRoute(env, path)
		if (path.startsWith('/api/v1/state/address-portfolio')) return await demoAddressPortfolioRoute(env, path)
		if (path.startsWith('/api/v1/state/')) return await demoStateHistoryRoute(env, path)
		if (path.startsWith('/api/v1/address-transactions')) return await demoAddressTransactionsRoute(env, path)
		if (path.startsWith('/api/v1/address-interactions')) return await demoAddressInteractionsRoute(path, api)
		if (path.startsWith('/api/v1/address-identity')) return await demoAddressIdentityRoute(env, path)
		if (path.startsWith('/api/v1/richlist')) return await demoRichListRoute(env, path)
		if (path.startsWith('/api/v1/logs/') && path.split('/').length > 7) return await demoLogDetailRoute(env, path)
		if (path.startsWith('/api/v1/logs')) return await demoLogsRoute(env, path)
		return await fetchApi(path, { signal })
	}

	return {
		api,
		applyBlock: (payload: LiveEventPayload) => applyDemoBlock(env, payload),
		observeReorg(address: string | undefined) {
			counters.reorgObserved = true
			counters.evictedAddress = address
		},
	}
}
