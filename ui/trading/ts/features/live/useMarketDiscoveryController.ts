import { useEffect, useRef } from 'preact/hooks'
import type { createLatestRequestGuard, RequestIdentity } from '@zoltar/ui-core-shared/lib/requestGuard.js'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import type { DeploymentConfiguration } from '../../protocol/config.js'
import { marketAcceptsNewRisk, publicErrorMessage, type LiveMarket } from '../../protocol/live.js'
import { discoveryCommitAllowed, quoteBasisChanged, securityPoolAddressFromRoute, walletSummaryDiscoveryRetryStart, type WorkflowOwner } from '../liveTradingControllerHelpers.js'
import { parsedUniverseId } from './useLiveTradingState.js'
import type { useMarketDiscovery } from './useMarketDiscovery.js'
import type { usePortfolioQueries } from './usePortfolioQueries.js'
import type { useTransactionWorkflow } from './useTransactionWorkflow.js'
import type { useWalletSession } from './useWalletSession.js'
import type { LiveTradingControllerServices } from './liveTradingTypes.js'

type RequestGuard = ReturnType<typeof createLatestRequestGuard>

/** Cadence of the automatic background refresh that replaces manual refresh controls. */
const LIVE_REFRESH_INTERVAL_MILLISECONDS = 15_000

function discoveryScope(route: string) {
	return securityPoolAddressFromRoute(route) ?? route
}

export function useMarketDiscoveryController({
	route,
	configuration,
	configurationError,
	selectedUniverseId,
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
	simulationRequests,
	refreshIntervalMilliseconds = LIVE_REFRESH_INTERVAL_MILLISECONDS,
}: {
	route: string
	configuration: DeploymentConfiguration | undefined
	configurationError: string | undefined
	selectedUniverseId: string | undefined
	onUniversesChange(universeIds: readonly bigint[], selectedUniverseId: bigint | undefined): void
	walletSummaryRetryNonce: number
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
	simulationRequests: RequestGuard
	refreshIntervalMilliseconds?: number | undefined
}) {
	const previousRoute = useRef(route)
	const previousWalletSummaryRetryNonce = useRef(walletSummaryRetryNonce)
	// A background discovery slower than the refresh interval is left to finish instead of being restarted each tick.
	const backgroundDiscovery = useRef<RequestIdentity>()

	async function discover(nextConfiguration: DeploymentConfiguration, requestedStart: bigint, isCurrent: () => boolean) {
		const client = services.createTradingPublicClient(nextConfiguration)
		await services.validateLiveDeployment(client, nextConfiguration)
		if (!isCurrent()) return undefined
		const requestedUniverseId = parsedUniverseId(selectedUniverseId)
		if (routePool !== undefined) return await services.discoverAddressedMarket(client, nextConfiguration, routePool)
		if (route === 'portfolio') return await services.discoverAllLiveMarketsInUniverse(client, nextConfiguration, requestedUniverseId, 25n, market.deploymentIndex)
		if (route === 'security-pools') return await services.discoverLiveUniverseMarketPage(client, nextConfiguration, requestedUniverseId, requestedStart, 25n, market.deploymentIndex)
		if (route === 'markets') return await services.discoverTradingMarketPage(client, nextConfiguration, requestedUniverseId, requestedStart, 25n, market.pairIndex, isCurrent)
		// Lookup routes wait for an explicit SecurityPool address and only need the universe list for the selector.
		return await services.discoverUniverses(client, nextConfiguration, requestedUniverseId, isCurrent)
	}

	/**
	 * Explicit refreshes reset transient workflow state and show the discovery loading state. Background refreshes
	 * keep the last successful result visible and only retire a quote whose market basis changed. Neither touches
	 * loaded balances directly: the balance effects revalidate them from the refreshed market objects and keep the
	 * previous values visible until the new reads resolve.
	 */
	async function refresh(nextConfiguration = configuration, requestedStart = market.marketPage.start, owner: WorkflowOwner | undefined = undefined, options: Readonly<{ background?: boolean }> = {}) {
		if (nextConfiguration === undefined) return
		const background = options.background === true
		if (background && (market.discoveryState === 'loading' || (backgroundDiscovery.current !== undefined && discoveryRequests.isCurrent(backgroundDiscovery.current)))) return
		const request = discoveryRequests.begin()
		backgroundDiscovery.current = background ? request : undefined
		if (!background) {
			simulationRequests.invalidate()
			// Retire any in-flight balance read so the effects re-read after this refresh commits, without hiding current values.
			balanceRequests.invalidate()
			transaction.setQuote(undefined)
			if (!transaction.positionWorkflowLockedRef.current && owner !== 'position') transaction.dispatchWorkflow({ type: 'reset' })
			if (route === 'portfolio') {
				portfolioBalanceRequests.invalidate()
				portfolio.setPortfolioEntries([])
				portfolio.setPortfolioBalanceState(wallet.accountRef.current === undefined ? 'disconnected' : 'loading')
				portfolio.setPortfolioBalanceError(undefined)
			}
			market.setDiscoveryState('loading')
			market.setDiscoveryError(undefined)
		}
		try {
			const discovered = await discover(nextConfiguration, requestedStart, () => discoveryRequests.isCurrent(request))
			if (discovered === undefined || !discoveryRequests.isCurrent(request)) return
			if (!discoveryCommitAllowed(owner, transaction.positionWorkflowLockedRef.current, transaction.liquidityWorkflowLockedRef.current)) {
				market.setDiscoveryState('ready')
				return
			}
			const quote = transaction.quote
			if (background && quote !== undefined && !transaction.positionWorkflowLockedRef.current) {
				const refreshed = discovered.markets.find(candidate => candidate.pool === quote.value.market.pool)
				if (refreshed !== undefined && quoteBasisChanged(quote.value.market, refreshed)) {
					simulationRequests.invalidate()
					transaction.setQuote(undefined)
					transaction.dispatchWorkflow({ type: 'reset' })
				}
			}
			market.setMarkets(discovered.markets)
			onUniversesChange(discovered.universeIds, discovered.selectedUniverseId)
			market.setMarketPage({ start: discovered.start, total: discovered.total, previousStart: discovered.previousStart, nextStart: discovered.nextStart })
			market.setDiscoveryError(undefined)
			market.setDiscoveryState('ready')
		} catch (error) {
			if (!discoveryRequests.isCurrent(request)) return
			if (!discoveryCommitAllowed(owner, transaction.positionWorkflowLockedRef.current, transaction.liquidityWorkflowLockedRef.current)) {
				market.setDiscoveryState('ready')
				return
			}
			const detail = publicErrorMessage(error, 'SecurityPool discovery failed')
			market.setDiscoveryError(detail)
			market.setDiscoveryState('error')
			if (background) return
			if (route === 'portfolio') {
				portfolio.setPortfolioBalanceState('error')
				portfolio.setPortfolioBalanceError(`SecurityPool discovery failed: ${detail}`)
			}
			if (wallet.accountRef.current !== undefined) {
				portfolio.setBalanceState('error')
				portfolio.setBalanceError('Market refresh failed before wallet balances could be revalidated')
			}
		} finally {
			if (backgroundDiscovery.current === request) backgroundDiscovery.current = undefined
		}
	}
	const refreshRef = useRef(refresh)
	refreshRef.current = refresh

	useEffect(() => {
		if (configuration === undefined) {
			discoveryRequests.invalidate()
			balanceRequests.invalidate()
			simulationRequests.invalidate()
			transaction.dispatchWorkflow(configurationError === undefined ? { type: 'reset' } : { type: 'failed', message: configurationError })
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
		if (transaction.positionWorkflowLockedRef.current) return
		simulationRequests.invalidate()
		transaction.setQuote(undefined)
		transaction.dispatchWorkflow({ type: 'reset' })
		wallet.setWalletConnectionFeedback(current => (current?.route === route ? current : undefined))
		if (previousRoute.current !== route) {
			// Results only carry over between routes that discover the same thing, such as the trade and liquidity views of one pool.
			if (discoveryScope(previousRoute.current) !== discoveryScope(route)) market.setMarkets([])
			void refresh(configuration, 0n)
		}
		previousRoute.current = route
	}, [route])

	useEffect(() => {
		if (selected === undefined || marketAcceptsNewRisk(selected, nowSeconds)) return
		simulationRequests.invalidate()
		transaction.setQuote(undefined)
		if (!transaction.positionWorkflowLockedRef.current && !transaction.liquidityWorkflowLockedRef.current) transaction.dispatchWorkflow({ type: 'reset' })
	}, [nowSeconds, selected])

	// Lookup routes only show static guidance until an address is opened, so they have nothing to refresh.
	const periodicRefreshActive = configuration !== undefined && (routePool !== undefined || route === 'portfolio' || route === 'markets' || route === 'security-pools')
	useEffect(() => {
		if (!periodicRefreshActive) return
		const timer = setInterval(() => {
			if (transaction.positionWorkflowLockedRef.current || transaction.liquidityWorkflowLockedRef.current) return
			void refreshRef.current(undefined, undefined, undefined, { background: true })
		}, refreshIntervalMilliseconds)
		return () => clearInterval(timer)
	}, [periodicRefreshActive, refreshIntervalMilliseconds, route, routePool])

	return {
		refresh,
		refreshFromControl: () => {
			if (!transaction.positionWorkflowLockedRef.current && !transaction.liquidityWorkflowLockedRef.current) void refresh()
		},
		loadMarketPage: (start: bigint | undefined) => {
			if (start !== undefined && !transaction.workflowLocked) void refresh(configuration, start)
		},
	}
}
