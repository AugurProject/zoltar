import { useEffect, useRef } from 'preact/hooks'
import type { createLatestRequestGuard } from '@zoltar/ui-core-shared/lib/requestGuard.js'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import type { DeploymentConfiguration } from '../../protocol/config.js'
import { marketAcceptsNewRisk, publicErrorMessage, type LiveMarket } from '../../protocol/live.js'
import { discoveryCommitAllowed, marketSelectionAfterDiscovery, walletSummaryDiscoveryRetryStart, type WorkflowOwner } from '../liveTradingControllerHelpers.js'
import { parsedUniverseId } from './useLiveTradingState.js'
import type { useMarketDiscovery } from './useMarketDiscovery.js'
import type { usePortfolioQueries } from './usePortfolioQueries.js'
import type { useTransactionWorkflow } from './useTransactionWorkflow.js'
import type { useWalletSession } from './useWalletSession.js'
import type { LiveTradingControllerServices } from './liveTradingTypes.js'

type RequestGuard = ReturnType<typeof createLatestRequestGuard>

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
}) {
	const previousRoute = useRef(route)
	const previousWalletSummaryRetryNonce = useRef(walletSummaryRetryNonce)

	async function refresh(nextConfiguration = configuration, requestedStart = market.marketPage.start, owner: WorkflowOwner | undefined = undefined) {
		if (nextConfiguration === undefined) return
		const request = discoveryRequests.begin()
		simulationRequests.invalidate()
		transaction.setQuote(undefined)
		if (!transaction.positionWorkflowLockedRef.current && owner !== 'position') transaction.dispatchWorkflow({ type: 'reset' })
		if (wallet.accountRef.current !== undefined) {
			portfolio.setBalanceState('loading')
			portfolio.setBalanceError(undefined)
			portfolio.setBalances(undefined)
		}
		if (route === 'portfolio') {
			portfolioBalanceRequests.invalidate()
			portfolio.setPortfolioEntries([])
			portfolio.setPortfolioBalanceState(wallet.accountRef.current === undefined ? 'disconnected' : 'loading')
			portfolio.setPortfolioBalanceError(undefined)
		}
		market.setDiscoveryState('loading')
		market.setDiscoveryError(undefined)
		try {
			const client = services.createTradingPublicClient(nextConfiguration)
			await services.validateLiveDeployment(client, nextConfiguration)
			if (!discoveryRequests.isCurrent(request)) return
			const requestedUniverseId = parsedUniverseId(selectedUniverseId)
			const discovered =
				route === 'portfolio' || routePool !== undefined
					? await services.discoverAllLiveMarketsInUniverse(client, nextConfiguration, requestedUniverseId, 25n, market.deploymentIndex)
					: await services.discoverLiveUniverseMarketPage(client, nextConfiguration, requestedUniverseId, requestedStart, 25n, market.deploymentIndex)
			if (!discoveryRequests.isCurrent(request)) return
			if (!discoveryCommitAllowed(owner, transaction.positionWorkflowLockedRef.current, transaction.liquidityWorkflowLockedRef.current)) {
				market.setDiscoveryState('ready')
				return
			}
			market.setMarkets(discovered.markets)
			onUniversesChange(discovered.universeIds, discovered.selectedUniverseId)
			market.setMarketPage({ start: discovered.start, total: discovered.total, previousStart: discovered.previousStart, nextStart: discovered.nextStart })
			market.setSelectedPool(currentPool => marketSelectionAfterDiscovery(discovered.markets, currentPool, requestedStart === market.marketPage.start))
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
			if (route === 'portfolio') {
				portfolio.setPortfolioBalanceState('error')
				portfolio.setPortfolioBalanceError(`SecurityPool discovery failed: ${detail}`)
			}
			if (wallet.accountRef.current !== undefined) {
				portfolio.setBalanceState('error')
				portfolio.setBalanceError('Market refresh failed before wallet balances could be revalidated')
			}
		}
	}

	useEffect(() => {
		if (configuration === undefined) {
			discoveryRequests.invalidate()
			balanceRequests.invalidate()
			simulationRequests.invalidate()
			transaction.dispatchWorkflow(configurationError === undefined ? { type: 'reset' } : { type: 'failed', message: configurationError })
			return
		}
		void refresh(configuration, 0n)
	}, [configuration, configurationError, selectedUniverseId])

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
		if (previousRoute.current !== route) void refresh(configuration, 0n)
		previousRoute.current = route
	}, [route])

	useEffect(() => {
		if (selected === undefined || marketAcceptsNewRisk(selected, nowSeconds)) return
		simulationRequests.invalidate()
		transaction.setQuote(undefined)
		if (!transaction.positionWorkflowLockedRef.current && !transaction.liquidityWorkflowLockedRef.current) transaction.dispatchWorkflow({ type: 'reset' })
	}, [nowSeconds, selected])

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
