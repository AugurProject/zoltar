import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { useCallback, useMemo, useRef } from 'preact/hooks'
import { parseUnits } from '../lib/format.js'
import type { WalletSummaryState } from '../lib/walletSummaryState.js'
import { createLatestRequestGuard } from '@zoltar/ui-core-shared/lib/requestGuard.js'
import { liveBalancesForMarket, publicErrorMessage, type LiveMarket } from '../protocol/live.js'
import type { DeploymentConfiguration } from '../protocol/config.js'
import type { LiveTradingControllerServices } from './live/liveTradingTypes.js'
import { useQuestionClock } from './live/useLiveTradingState.js'
import { useMarketDiscovery } from './live/useMarketDiscovery.js'
import { usePortfolioQueries, usePortfolioRefreshEffects } from './live/usePortfolioQueries.js'
import { useTransactionWorkflow } from './live/useTransactionWorkflow.js'
import { useWalletSession, useWalletSessionController, useWalletSummaryEffects } from './live/useWalletSession.js'
import { createPositionTransactionController } from './live/positionTransactionController.js'
import { useMarketDiscoveryController } from './live/useMarketDiscoveryController.js'
import { filterMarketsByUniverse, livePairInitialized, liveTradingControllerServices, securityPoolAddressFromRoute } from './liveTradingControllerHelpers.js'

export function useLiveTradingController({
	route,
	configuration,
	configurationError,
	selectedUniverseId,
	onUniversesChange,
	onWorkflowLockChange,
	onWalletSummaryChange,
	walletSummaryRetryNonce,
	defaultSlippage,
	defaultValidityMinutes,
	services = liveTradingControllerServices,
}: {
	route: string
	configuration: DeploymentConfiguration | undefined
	configurationError: string | undefined
	selectedUniverseId: string | undefined
	onUniversesChange(universeIds: readonly bigint[], selectedUniverseId: bigint | undefined): void
	onWorkflowLockChange(locked: boolean): void
	onWalletSummaryChange(summary: WalletSummaryState): void
	walletSummaryRetryNonce: number
	defaultSlippage: string
	defaultValidityMinutes: string
	services?: LiveTradingControllerServices
}) {
	const marketDiscovery = useMarketDiscovery()
	const { markets, selectedPool, setSelectedPool, discoveryState, discoveryError, marketPage } = marketDiscovery
	const walletSession = useWalletSession()
	const { account, accountRef, walletClient, walletContextInvalidated, walletConnectionFeedback } = walletSession
	const portfolioQueries = usePortfolioQueries()
	const { balances, setBalances, balanceState, setBalanceState, balanceError, setBalanceError, portfolioEntries, portfolioBalanceState, portfolioBalanceError, setPortfolioRefreshNonce } = portfolioQueries
	const transactionWorkflow = useTransactionWorkflow(onWorkflowLockChange, defaultSlippage, defaultValidityMinutes)
	const { mode, side, amount, slippage, transactionValidityMinutes, quote, setQuote, dispatchWorkflow, state, positionHash, message, positionReceiptWarning, positionWorkflowLockedRef, liquidityWorkflowLockedRef, workflowLocked, updateLiquidityWorkflowLock } = transactionWorkflow
	const marketListRef = useRef<HTMLElement>(null)
	const marketDetailRef = useRef<HTMLElement>(null)
	const portfolioBalanceRequests = useRef(createLatestRequestGuard()).current
	const discoveryRequests = useRef(createLatestRequestGuard()).current
	const balanceRequests = useRef(createLatestRequestGuard()).current
	const walletSummaryRequests = useRef(createLatestRequestGuard()).current
	const connectionRequests = useRef(createLatestRequestGuard()).current
	const simulationRequests = useRef(createLatestRequestGuard()).current
	const transactionRequestRevision = useRef(0)
	const nextTransactionContext = useCallback((expectedAccount: Address, market: LiveMarket, chainId: number) => ({ account: expectedAccount, market: market.pool, chainId, requestRevision: ++transactionRequestRevision.current }), [])

	const visibleMarkets = filterMarketsByUniverse(markets, selectedUniverseId)
	const visiblePortfolioEntries = portfolioEntries.filter(entry => entry.market.universeId.toString() === selectedUniverseId)
	const routePool = securityPoolAddressFromRoute(route)
	const routeSelected = routePool === undefined ? undefined : visibleMarkets.find(market => market.pool.toLowerCase() === routePool)
	const selected = routePool === undefined ? (visibleMarkets.find(market => market.pool.toLowerCase() === selectedPool?.toLowerCase()) ?? visibleMarkets[0]) : routeSelected
	const selectedBalances = balanceState === 'ready' ? liveBalancesForMarket(balances, selected) : undefined
	let selectedBalanceState = balanceState
	if (balanceState !== 'error' && balances !== undefined && selectedBalances === undefined) selectedBalanceState = account === undefined ? 'disconnected' : 'loading'
	const selectedPairInitialized = selected === undefined ? false : livePairInitialized(selected)
	const nowSeconds = useQuestionClock(selected?.endTime, configuration, services)
	const { refresh, refreshFromControl, loadMarketPage } = useMarketDiscoveryController({
		route,
		configuration,
		configurationError,
		selectedUniverseId,
		onUniversesChange,
		walletSummaryRetryNonce,
		selected,
		routePool,
		nowSeconds,
		market: marketDiscovery,
		portfolio: portfolioQueries,
		wallet: walletSession,
		transaction: transactionWorkflow,
		services,
		discoveryRequests,
		balanceRequests,
		portfolioBalanceRequests,
		simulationRequests,
	})
	const { connect, executeWithCurrentWalletContext, createGuardedWalletWrite, refreshWalletSummaryAfterReceipt, walletContextIsCurrent } = useWalletSessionController({
		route,
		configuration,
		selectedUniverseId,
		onWalletSummaryChange,
		services,
		session: walletSession,
		portfolio: portfolioQueries,
		transaction: transactionWorkflow,
		connectionRequests,
		balanceRequests,
		portfolioBalanceRequests,
		walletSummaryRequests,
		simulationRequests,
		refresh,
	})
	usePortfolioRefreshEffects({ route, configuration, account, selected, visibleMarkets, marketRevision: markets, selectedUniverseId, walletContextInvalidated, accountRef, queries: portfolioQueries, services, portfolioBalanceRequests, balanceRequests })
	useWalletSummaryEffects({ configuration, configurationError, selectedUniverseId, discoveryState, discoveryError, selected, retryNonce: walletSummaryRetryNonce, onWalletSummaryChange, session: walletSession, services, requests: walletSummaryRequests })
	const parsedAmount = useMemo(() => {
		try {
			return { value: parseUnits(amount), error: undefined }
		} catch (error) {
			return { value: undefined, error: error instanceof Error ? error.message : 'Invalid amount' }
		}
	}, [amount])

	function focusSection(section: Readonly<{ current: HTMLElement | null }>) {
		requestAnimationFrame(() => {
			section.current?.focus({ preventScroll: true })
			section.current?.scrollIntoView({ block: 'start' })
		})
	}

	async function retryBalances() {
		if (configuration === undefined || selected === undefined) return
		if (account === undefined) {
			await connect()
			return
		}
		const request = balanceRequests.begin()
		simulationRequests.invalidate()
		setQuote(undefined)
		if (!positionWorkflowLockedRef.current) dispatchWorkflow({ type: 'reset' })
		setBalanceState('loading')
		setBalanceError(undefined)
		setBalances(undefined)
		try {
			const loaded = await services.loadLiveBalances(services.createTradingPublicClient(configuration), selected, account)
			if (!balanceRequests.isCurrent(request)) return
			setBalances(loaded)
			setBalanceState('ready')
			dispatchWorkflow({ type: 'reset' })
		} catch (error) {
			if (!balanceRequests.isCurrent(request)) return
			setBalanceState('error')
			setBalanceError(publicErrorMessage(error, 'Balance refresh failed'))
		}
	}

	async function retryPortfolioBalances() {
		if (account === undefined) {
			await connect()
			return
		}
		if (discoveryState === 'error') {
			await refresh(configuration, 0n)
			return
		}
		setPortfolioRefreshNonce(value => value + 1)
	}

	const positionActions = createPositionTransactionController({
		configuration,
		selected,
		account,
		walletClient,
		parsedAmount,
		workflow: transactionWorkflow,
		services,
		simulationRequests,
		nextTransactionContext,
		createGuardedWalletWrite,
		executeWithCurrentWalletContext,
		refreshWalletSummaryAfterReceipt,
		refresh,
		marketPageStart: marketPage.start,
	})

	function selectMarket(market: LiveMarket) {
		if (positionWorkflowLockedRef.current || liquidityWorkflowLockedRef.current) return
		balanceRequests.invalidate()
		simulationRequests.invalidate()
		setBalances(undefined)
		setBalanceState(account === undefined ? 'disconnected' : 'loading')
		setBalanceError(undefined)
		setSelectedPool(market.pool)
		setQuote(undefined)
		dispatchWorkflow({ type: 'reset' })
		focusSection(marketDetailRef)
	}

	return {
		wallet: {
			account,
			walletClient,
			connect,
			connectionMessage: walletConnectionFeedback?.route === route ? walletConnectionFeedback.detail : undefined,
			refreshWalletSummaryAfterReceipt,
			walletContextIsCurrent,
			executeWithCurrentWalletContext,
			createGuardedWalletWrite,
		},
		balances: {
			balanceError,
			portfolioBalanceState,
			portfolioBalanceError,
			visiblePortfolioEntries,
			selectedBalances,
			selectedBalanceState,
			retryBalances,
			retryPortfolioBalances,
		},
		discovery: {
			visibleMarkets,
			selected,
			selectedPairInitialized,
			routePool,
			discoveryState,
			discoveryError,
			marketPage,
			marketListRef,
			marketDetailRef,
			nowSeconds,
			refresh,
			refreshFromControl,
			loadMarketPage,
			focusSection,
			selectMarket,
		},
		position: {
			parsedAmount,
			mode,
			side,
			amount,
			slippage,
			transactionValidityMinutes,
			quote,
			state,
			positionHash,
			message,
			positionReceiptWarning,
			...positionActions,
		},
		workflow: {
			workflowLocked,
			updateLiquidityWorkflowLock,
		},
	}
}
