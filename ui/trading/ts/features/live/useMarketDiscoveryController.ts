import { readOperationClient, runReadOperation, type ReadOperation } from '@zoltar/ui-core-shared/lib/readOperation.js'
import type { MarketDiscoveryProgress } from '../../protocol/live.js'
import { useEffect, useRef } from 'preact/hooks'
import { useBlockRefresh } from '@zoltar/ui-core-shared/hooks/useDataRefresh.js'
import type { createLatestRequestGuard, RequestIdentity } from '@zoltar/ui-core-shared/lib/requestGuard.js'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import type { DeploymentConfiguration } from '../../protocol/config.js'
import { marketAcceptsNewRisk, publicErrorMessage, type LiveMarket } from '../../protocol/live.js'
import { discoveryCommitAllowed, securityPoolAddressFromRoute, walletSummaryDiscoveryRetryStart, type WorkflowOwner } from '../liveTradingControllerHelpers.js'
import { transactionMarketKey } from './transactionWorkflow.js'
import { liveCopy } from '../../copy/live.js'
import { parsedUniverseId } from './useLiveTradingState.js'
import { tradingListKindFor } from '../../lib/routing.js'
import type { useMarketDiscovery } from './useMarketDiscovery.js'
import type { usePortfolioQueries } from './usePortfolioQueries.js'
import type { useTransactionWorkflow } from './useTransactionWorkflow.js'
import type { useWalletSession } from './useWalletSession.js'
import type { UniverseDiscoveryScope } from '../../lib/universeSelection.js'
import type { LiveTradingControllerServices, LiveTradingRouteContext } from './liveTradingTypes.js'

type RefreshOptions = Readonly<{ background?: boolean; navigation?: boolean; ownerMarket?: Address; explicit?: boolean }>

type RequestGuard = ReturnType<typeof createLatestRequestGuard>

function discoveryScope(route: string) {
	return securityPoolAddressFromRoute(route) ?? tradingListKindFor(route) ?? route
}

export function useMarketDiscoveryController({
	route,
	configuration,
	configurationError,
	selectedUniverseId,
	urlUniverseId,
	onUniversesChange,
	walletSummaryRetryNonce,
	selected,
	routePool,
	nowSeconds,
	market,
	portfolio,
	wallet,
	transaction,
	services,
	discoveryRequests,
	balanceRequests,
	portfolioBalanceRequests,
}: LiveTradingRouteContext & {
	selected: LiveMarket | undefined
	routePool: Address | undefined
	nowSeconds: bigint
	market: ReturnType<typeof useMarketDiscovery>
	portfolio: ReturnType<typeof usePortfolioQueries>
	wallet: ReturnType<typeof useWalletSession>
	transaction: ReturnType<typeof useTransactionWorkflow>
	services: LiveTradingControllerServices
	discoveryRequests: RequestGuard
	balanceRequests: RequestGuard
	portfolioBalanceRequests: RequestGuard
}) {
	const previousRoute = useRef(route)
	const previousWalletSummaryRetryNonce = useRef(walletSummaryRetryNonce)
	// A background discovery slower than the block interval is left to finish instead of being restarted on each block.
	const backgroundDiscovery = useRef<RequestIdentity>()
	const foregroundDiscovery = useRef<{ request: RequestIdentity; args: [DeploymentConfiguration, bigint, WorkflowOwner | undefined, RefreshOptions] }>()
	const partialSnapshot = useRef<{ markets: typeof market.markets; page: typeof market.marketPage; rows: typeof market.discoveryRows }>()

	async function discover(nextConfiguration: DeploymentConfiguration, requestedStart: bigint, isCurrent: () => boolean, operation: ReadOperation, onProgress: MarketDiscoveryProgress) {
		const client = readOperationClient(services.createTradingPublicClient(nextConfiguration), operation)
		await services.validateLiveDeployment(client, nextConfiguration)
		if (!isCurrent()) return undefined
		const requestedUniverseId = parsedUniverseId(selectedUniverseId)
		if (routePool !== undefined) return await services.discoverAddressedMarket(client, nextConfiguration, routePool)
		if (route === 'portfolio') return await services.discoverAllLiveMarketsInUniverse(client, nextConfiguration, requestedUniverseId, 25n, market.deploymentIndex, onProgress)
		// Lookup routes are list-first, so they page through the candidates of their workflow.
		const listRoute = tradingListKindFor(route)
		if (listRoute === 'security-pools') return await services.discoverLiveUniverseMarketPage(client, nextConfiguration, requestedUniverseId, requestedStart, 25n, market.deploymentIndex, onProgress)
		if (listRoute === 'markets') return await services.discoverTradingMarketPage(client, nextConfiguration, requestedUniverseId, requestedStart, 25n, market.pairIndex, isCurrent, onProgress)
		return await services.discoverUniverses(client, nextConfiguration, requestedUniverseId, isCurrent)
	}

	/**
	 * Explicit refreshes reset transient workflow state and show the discovery loading state. Background refreshes
	 * keep the last successful result visible; trade estimates recompute from the refreshed reserves. Neither touches
	 * loaded balances directly: the balance effects revalidate them from the refreshed market objects and keep the
	 * previous values visible until the new reads resolve.
	 */
	// Trades keep running after navigation, one per market; only the route showing a market with its own running trade
	// waits for it. Other routes (lists, portfolio, other markets) keep refreshing. A liquidity or settlement lock only
	// exists on its own market.
	const routePoolRef = useRef(routePool)
	routePoolRef.current = routePool
	const positionLockOnScreen = () => routePoolRef.current !== undefined && transaction.isPositionLocked(routePoolRef.current)
	const refreshHeldByWorkflow = () => transaction.liquidityWorkflowLockedRef.current || positionLockOnScreen()

	async function refresh(nextConfiguration = configuration, requestedStart = market.marketPage.start, owner: WorkflowOwner | undefined = undefined, options: RefreshOptions = {}) {
		if (nextConfiguration === undefined) return
		const background = options.background === true
		// A trade's own refresh passes its market's lock; landing on another market's route, it waits like any other refresh.
		const ownerMarketOnScreen = () => options.ownerMarket === undefined || transactionMarketKey(options.ownerMarket) === transactionMarketKey(routePoolRef.current)
		// A route change always shows its own data; a pending transaction keeps its captured context and stays in the activity list.
		const commitAllowed = () => options.navigation === true || discoveryCommitAllowed(owner, positionLockOnScreen(), transaction.liquidityWorkflowLockedRef.current, ownerMarketOnScreen())
		// Such a refresh would only supersede that market's own reads; its trade refreshes the route when it finishes.
		if (owner === 'position' && !ownerMarketOnScreen() && refreshHeldByWorkflow()) return
		if (background && options.explicit !== true && (market.discoveryState === 'loading' || (backgroundDiscovery.current !== undefined && discoveryRequests.isCurrent(backgroundDiscovery.current)))) return
		const request = discoveryRequests.begin()
		if (!background) foregroundDiscovery.current = { request, args: [nextConfiguration, requestedStart, owner, options] }
		// The scope is fixed when the request begins; a request that lands after the URL or route moved on still answers only its own question.
		// It records the application's request (the `universe` parameter), not the resolved universe discovery is asked for.
		const scope: UniverseDiscoveryScope = { requestedUniverseId: urlUniverseId, addressedPool: routePool?.toLowerCase() }
		backgroundDiscovery.current = background ? request : undefined
		if (background) market.setFreshness(current => ({ ...current, refreshing: true }))
		if (!background) {
			// Retire any in-flight balance read so the effects re-read after this refresh commits, without hiding current values.
			balanceRequests.invalidate()
			if (owner !== 'position') transaction.resetUnlocked()
			if (route === 'portfolio') {
				portfolioBalanceRequests.invalidate()
				portfolio.setPortfolioEntries([])
				portfolio.setPortfolioBalanceState(wallet.accountRef.current === undefined ? 'disconnected' : 'loading')
				portfolio.setPortfolioBalanceError(undefined)
			}
			market.setDiscoveryState('loading')
			market.setDiscoveryError(undefined)
		}
		const previousMarkets = market.markets
		const previousPage = market.marketPage
		const restorePartialProgress = () => {
			// Preserve rollback ownership across explicit refreshes that supersede a partial first load.
			const snapshot = partialSnapshot.current
			if (snapshot === undefined) return
			market.setMarkets(snapshot.markets)
			market.setMarketPage(snapshot.page)
			market.setDiscoveryRows(snapshot.rows)
			partialSnapshot.current = undefined
		}
		try {
			let acceptingProgress = true
			// Partial first loads can fill an empty view; refreshes keep every prior row until the full result arrives.
			const publishProgress = market.markets.length === 0 || partialSnapshot.current !== undefined
			const onProgress: MarketDiscoveryProgress = discovered => {
				if (!publishProgress || !acceptingProgress || background || !discoveryRequests.isCurrent(request) || !commitAllowed()) return
				partialSnapshot.current ??= { markets: previousMarkets, page: previousPage, rows: market.discoveryRows }
				const rows = discovered.markets.map((row, index) => row ?? (discovered.start === market.marketPage.start ? market.discoveryRows?.[index] : undefined))
				market.setMarkets(rows.filter(item => item !== undefined))
				market.setDiscoveryRows(rows)
				onUniversesChange(discovered.universeIds, discovered.selectedUniverseId, scope)
				market.setMarketPage({ start: discovered.start, total: discovered.total, previousStart: discovered.previousStart, nextStart: discovered.nextStart })
			}
			const discovered = await runReadOperation(async operation => await discover(nextConfiguration, requestedStart, () => discoveryRequests.isCurrent(request), operation, onProgress), { isCurrent: () => discoveryRequests.isCurrent(request) }).finally(() => {
				acceptingProgress = false
			})
			if (discovered === undefined || !discoveryRequests.isCurrent(request)) return
			if (!commitAllowed()) {
				restorePartialProgress()
				market.setDiscoveryState('ready')
				return
			}
			market.setDiscoveryRows(partialSnapshot.current !== undefined || (market.discoveryRows !== undefined && requestedStart === market.marketPage.start) ? discovered.markets : undefined)
			partialSnapshot.current = undefined
			market.setMarkets(discovered.markets)
			onUniversesChange(discovered.universeIds, discovered.selectedUniverseId, scope)
			market.setMarketPage({ start: discovered.start, total: discovered.total, previousStart: discovered.previousStart, nextStart: discovered.nextStart })
			market.setDiscoveryError(undefined)
			market.setDiscoveryState('ready')
			market.setFreshness({ refreshing: false, updatedAt: Date.now() })
		} catch (error) {
			if (!discoveryRequests.isCurrent(request)) return
			if (!commitAllowed()) {
				restorePartialProgress()
				market.setDiscoveryState('ready')
				return
			}
			const detail = publicErrorMessage(error, liveCopy.discoveryFailureLead(route))
			market.setDiscoveryError(detail)
			market.setDiscoveryState('error')
			if (background) return
			if (route === 'portfolio') {
				portfolio.setPortfolioBalanceState('error')
				portfolio.setPortfolioBalanceError(liveCopy.describeDiscoveryFailure(liveCopy.discoveryFailureLead(route), detail))
			}
			if (wallet.accountRef.current !== undefined) {
				portfolio.setBalanceState('error')
				portfolio.setBalanceError('Market refresh failed before wallet balances could be revalidated')
			}
		} finally {
			if (foregroundDiscovery.current?.request === request) foregroundDiscovery.current = undefined
			if (backgroundDiscovery.current === request) {
				backgroundDiscovery.current = undefined
				market.setFreshness(current => (current.refreshing ? { ...current, refreshing: false } : current))
			}
		}
	}
	const refreshRef = useRef(refresh)
	refreshRef.current = refresh

	useEffect(() => {
		if (configuration === undefined) {
			discoveryRequests.invalidate()
			balanceRequests.invalidate()
			if (configurationError === undefined) transaction.resetUnlocked()
			else transaction.dispatchWorkflow({ type: 'failed', message: configurationError })
			return
		}
		void refresh(configuration, 0n)
	}, [configuration, configurationError, routePool === undefined ? selectedUniverseId : undefined])

	useEffect(() => {
		if (previousWalletSummaryRetryNonce.current === walletSummaryRetryNonce) return
		previousWalletSummaryRetryNonce.current = walletSummaryRetryNonce
		const retryStart = walletSummaryDiscoveryRetryStart(market.discoveryState, selected !== undefined, selected?.loadError, market.marketPage.start)
		if (configuration !== undefined && retryStart !== undefined) void refresh(configuration, retryStart)
	}, [configuration, market.discoveryState, market.marketPage.start, selected, walletSummaryRetryNonce])

	useEffect(() => {
		// Navigation is never blocked; running trades keep their workflow state while the new route loads its own data.
		transaction.resetUnlocked()
		wallet.setWalletConnectionFeedback(current => (current?.route === route ? current : undefined))
		if (previousRoute.current !== route) {
			// Results only carry over between routes that discover the same thing, such as the trade and liquidity views of one pool.
			if (discoveryScope(previousRoute.current) !== discoveryScope(route)) {
				partialSnapshot.current = undefined
				market.setDiscoveryRows(undefined)
				market.setMarkets([])
			}
			void refresh(configuration, 0n, undefined, { navigation: true })
		}
		previousRoute.current = route
	}, [route])

	useEffect(() => {
		if (selected === undefined || marketAcceptsNewRisk(selected, nowSeconds)) return
		if (!transaction.liquidityWorkflowLockedRef.current) transaction.resetUnlocked()
	}, [nowSeconds, selected])

	// Each new block, and each explicit invalidation such as a simulation control, re-reads the visible markets in place.
	const blockRefreshActive = configuration !== undefined && (routePool !== undefined || route === 'portfolio' || tradingListKindFor(route) !== undefined)
	useBlockRefresh(event => {
		const foreground = foregroundDiscovery.current
		if (event.reason === 'invalidate' && foreground !== undefined && discoveryRequests.isCurrent(foreground.request)) {
			void refreshRef.current(...foreground.args)
			return
		}
		if (refreshHeldByWorkflow()) return
		void refreshRef.current(undefined, undefined, undefined, { background: true, explicit: event.reason === 'invalidate' })
	}, blockRefreshActive)

	return {
		refresh,
		/** Refreshes whatever route is on screen when it runs, for work that finishes after the user navigated away. */
		refreshCurrentRoute: async (...args: Parameters<typeof refresh>) => await refreshRef.current(...args),
		/** True while the route on screen shows a market whose own transaction is still running. */
		refreshLocked: transaction.liquidityWorkflowLockedRef.current || positionLockOnScreen(),
		refreshFromControl: () => {
			if (!refreshHeldByWorkflow()) void refresh()
		},
		loadMarketPage: (start: bigint | undefined) => {
			if (start !== undefined && !refreshHeldByWorkflow()) void refresh(configuration, start)
		},
	}
}
