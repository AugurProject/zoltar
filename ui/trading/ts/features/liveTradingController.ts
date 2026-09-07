import type { Address } from '@zoltar/shared/ethereum'
import { useCallback, useEffect, useMemo, useRef } from 'preact/hooks'
import { parseUnits } from '../lib/format.js'
import type { WalletSummaryState } from '../lib/walletSummaryState.js'
import { createLatestRequestGuard } from '@zoltar/ui-core-shared/lib/requestGuard.js'
import { getInjectedEthereum, subscribeToWalletContextChanges, type InjectedEthereum, type WalletContextChangeEvent } from '../protocol/injected.js'
import { liveBalancesForMarket, publicErrorMessage, type LiveMarket } from '../protocol/live.js'
import type { DeploymentConfiguration } from '../protocol/config.js'
import type { LiveTradingControllerServices } from './live/liveTradingTypes.js'
import { useQuestionClock } from './live/useLiveTradingState.js'
import { useMarketDiscovery } from './live/useMarketDiscovery.js'
import { usePortfolioQueries, usePortfolioRefreshEffects } from './live/usePortfolioQueries.js'
import { useTransactionWorkflow } from './live/useTransactionWorkflow.js'
import { useWalletSession, useWalletSummaryEffects } from './live/useWalletSession.js'
import { createPositionTransactionController } from './live/positionTransactionController.js'
import { useMarketDiscoveryController } from './live/useMarketDiscoveryController.js'
import { filterMarketsByUniverse, livePairInitialized, liveTradingControllerServices, securityPoolAddressFromRoute, walletSummaryRefreshState, type GuardedWalletWrite } from './liveTradingControllerHelpers.js'

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
	const {
		account,
		setAccount,
		accountRef,
		walletClient,
		setWalletClient,
		walletProvider,
		setWalletProvider,
		walletContextInvalidated,
		setWalletContextInvalidated,
		setWalletSummaryStatus,
		setWalletEthAttoEth,
		setWalletRepAttoRep,
		setWalletSummaryError,
		setWalletSummaryErrorLabel,
		setWalletSummaryUniverseId,
		setWalletSummaryReceiptNonce,
		walletConnectionFeedback,
		setWalletConnectionFeedback,
	} = walletSession
	const portfolioQueries = usePortfolioQueries()
	const { balances, setBalances, balanceState, setBalanceState, balanceError, setBalanceError, portfolioEntries, portfolioBalanceState, portfolioBalanceError, setPortfolioBalanceError, setPortfolioRefreshNonce } = portfolioQueries
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
	const walletContextRevision = useRef(0)
	const transactionRequestRevision = useRef(0)
	const walletSubscriptionCleanup = useRef<(() => void) | undefined>()
	const walletContextChangeHandler = useRef<(provider: InjectedEthereum, eventName: WalletContextChangeEvent, allowDisconnectedRefresh: boolean) => void>(() => undefined)
	const walletConnectHandler = useRef<() => void>(() => undefined)
	const walletComponentMounted = useRef(true)
	const walletRenderContextKey = `${route}\u0000${selectedUniverseId ?? ''}\u0000${configuration?.chainId.toString() ?? ''}\u0000${configuration?.router ?? ''}`
	const walletRenderContextKeyRef = useRef(walletRenderContextKey)
	walletRenderContextKeyRef.current = walletRenderContextKey
	const nextTransactionContext = useCallback((expectedAccount: Address, market: LiveMarket, chainId: number) => ({ account: expectedAccount, market: market.pool, chainId, requestRevision: ++transactionRequestRevision.current }), [])

	const invalidateWalletIdentity = useCallback(
		(detail: string) => {
			walletContextRevision.current++
			walletSubscriptionCleanup.current?.()
			walletSubscriptionCleanup.current = undefined
			connectionRequests.invalidate()
			balanceRequests.invalidate()
			portfolioBalanceRequests.invalidate()
			walletSummaryRequests.invalidate()
			simulationRequests.invalidate()
			accountRef.current = undefined
			setWalletEthAttoEth(undefined)
			setWalletRepAttoRep(undefined)
			setWalletSummaryError(undefined)
			setWalletSummaryErrorLabel(undefined)
			setWalletSummaryUniverseId(selectedUniverseId)
			setWalletSummaryStatus('disconnected')
			onWalletSummaryChange(walletSummaryRefreshState(undefined, selectedUniverseId))
			setWalletClient(undefined)
			setWalletProvider(undefined)
			setAccount(undefined)
			setBalances(undefined)
			setBalanceState('error')
			setBalanceError('Wallet context changed; reconnect to refresh balances and approvals')
			setPortfolioBalanceError('Wallet context changed; reconnect before loading portfolio positions')
			setWalletContextInvalidated(true)
			setQuote(undefined)
			setWalletConnectionFeedback({ route, detail })
			dispatchWorkflow(positionWorkflowLockedRef.current ? { type: 'context-invalidated', message: detail } : { type: 'failed', message: detail })
		},
		[balanceRequests, connectionRequests, dispatchWorkflow, onWalletSummaryChange, portfolioBalanceRequests, route, selectedUniverseId, simulationRequests, walletSummaryRequests],
	)

	const executeWithCurrentWalletContext = useCallback(
		async <T>(expectedAccount: Address, networkFailure: string, accountFailure: string, action: () => Promise<T>): Promise<T> => {
			const expectedRevision = walletContextRevision.current
			const provider = getInjectedEthereum()
			if (provider === undefined) {
				const detail = 'No injected wallet was found; reconnect before continuing'
				invalidateWalletIdentity(detail)
				throw new Error(detail)
			}
			if (provider !== walletProvider) {
				const detail = 'Wallet provider changed; reconnect before continuing'
				invalidateWalletIdentity(detail)
				throw new Error(detail)
			}
			const requireUnchangedProvider = () => {
				if (walletContextRevision.current !== expectedRevision || getInjectedEthereum() !== provider || accountRef.current !== expectedAccount) {
					const detail = 'Wallet context changed; reconnect before continuing'
					invalidateWalletIdentity(detail)
					throw new Error(detail)
				}
			}
			let chainId: number
			try {
				chainId = await services.walletChainId(provider)
			} catch (error) {
				invalidateWalletIdentity(networkFailure)
				throw new Error(networkFailure, { cause: error })
			}
			requireUnchangedProvider()
			if (configuration === undefined || chainId !== configuration.chainId) {
				invalidateWalletIdentity(networkFailure)
				throw new Error(networkFailure)
			}
			let connectedAccount: Address
			try {
				connectedAccount = await services.connectWallet(provider)
			} catch (error) {
				invalidateWalletIdentity(accountFailure)
				throw new Error(accountFailure, { cause: error })
			}
			requireUnchangedProvider()
			if (connectedAccount !== expectedAccount) {
				invalidateWalletIdentity(accountFailure)
				throw new Error(accountFailure)
			}
			requireUnchangedProvider()
			return action()
		},
		[configuration, invalidateWalletIdentity, walletProvider],
	)

	const createGuardedWalletWrite = useCallback(
		(expectedAccount: Address, networkFailure: string, accountFailure: string) => {
			const expectedRevision = walletContextRevision.current
			const guardedWrite: GuardedWalletWrite = async write => {
				if (walletContextRevision.current !== expectedRevision) throw new Error('Wallet context changed during transaction revalidation; reconnect and simulate again')
				return await executeWithCurrentWalletContext(expectedAccount, networkFailure, accountFailure, async () => {
					if (walletContextRevision.current !== expectedRevision) throw new Error('Wallet context changed during transaction revalidation; reconnect and simulate again')
					return await write()
				})
			}
			return guardedWrite
		},
		[executeWithCurrentWalletContext],
	)

	const refreshWalletSummaryAfterReceipt = useCallback(() => {
		walletSummaryRequests.invalidate()
		const currentAccount = accountRef.current
		const nextSummary = walletSummaryRefreshState(currentAccount, selectedUniverseId)
		setWalletEthAttoEth(undefined)
		setWalletRepAttoRep(undefined)
		setWalletSummaryError(undefined)
		setWalletSummaryErrorLabel(undefined)
		setWalletSummaryUniverseId(selectedUniverseId)
		setWalletSummaryStatus(currentAccount === undefined ? 'disconnected' : 'loading')
		onWalletSummaryChange(nextSummary)
		setWalletSummaryReceiptNonce(current => current + 1)
	}, [onWalletSummaryChange, selectedUniverseId, walletSummaryRequests])

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

	useEffect(
		() => () => {
			walletComponentMounted.current = false
			connectionRequests.invalidate()
			walletContextRevision.current++
			walletSubscriptionCleanup.current?.()
			walletSubscriptionCleanup.current = undefined
		},
		[],
	)

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
			const loaded = await services.loadLiveBalances(services.createTradingPublicClient(configuration), selected, account, configuration.router)
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

	async function connect() {
		if (positionWorkflowLockedRef.current || liquidityWorkflowLockedRef.current) return
		if (accountRef.current !== undefined || walletClient !== undefined) invalidateWalletIdentity('Reconnecting wallet…')
		const request = connectionRequests.begin()
		const expectedRenderContextKey = walletRenderContextKey
		try {
			const provider = getInjectedEthereum()
			if (provider === undefined) throw new Error('No injected wallet was found')
			const requireCurrentConnection = () => {
				if (!walletComponentMounted.current || !connectionRequests.isCurrent(request)) return false
				if (getInjectedEthereum() !== provider) throw new Error('Wallet provider changed; reconnect before continuing')
				if (walletRenderContextKeyRef.current !== expectedRenderContextKey) {
					walletConnectHandler.current()
					return false
				}
				return true
			}
			if (configuration === undefined) throw new Error('Deployment configuration is unavailable')
			let chainId = await services.walletChainId(provider)
			if (!requireCurrentConnection()) return
			if (chainId !== configuration.chainId) {
				await services.switchWalletChain(provider, configuration.chainId)
				if (!requireCurrentConnection()) return
				chainId = await services.walletChainId(provider)
				if (!requireCurrentConnection()) return
			}
			if (chainId !== configuration.chainId) throw new Error(`Wallet must use ${configuration.chainName}`)
			const connected = await services.connectWallet(provider)
			if (!requireCurrentConnection()) return
			walletSubscriptionCleanup.current?.()
			walletSubscriptionCleanup.current = subscribeToWalletContextChanges(provider, (eventName: WalletContextChangeEvent) => {
				walletContextChangeHandler.current(provider, eventName, false)
			})
			const confirmedChainId = await services.walletChainId(provider)
			if (!requireCurrentConnection()) return
			if (confirmedChainId !== configuration.chainId) throw new Error(`Wallet must use ${configuration.chainName}`)
			const confirmedAccount = await services.connectWallet(provider)
			if (!requireCurrentConnection()) return
			if (confirmedAccount !== connected) throw new Error('Wallet account changed while connecting; reconnect to continue')
			balanceRequests.invalidate()
			walletSummaryRequests.invalidate()
			simulationRequests.invalidate()
			accountRef.current = connected
			setWalletEthAttoEth(undefined)
			setWalletRepAttoRep(undefined)
			setWalletSummaryError(undefined)
			setWalletSummaryErrorLabel(undefined)
			setWalletSummaryUniverseId(selectedUniverseId)
			setWalletSummaryStatus('loading')
			onWalletSummaryChange(walletSummaryRefreshState(connected, selectedUniverseId))
			setBalances(undefined)
			setBalanceState('loading')
			setBalanceError(undefined)
			setWalletContextInvalidated(false)
			walletContextRevision.current++
			setAccount(connected)
			setWalletClient(services.createTradingWalletClient(provider, connected))
			setWalletProvider(provider)
			setWalletConnectionFeedback(undefined)
			dispatchWorkflow({ type: 'reset' })
			await refresh(configuration)
		} catch (error) {
			if (!connectionRequests.isCurrent(request) || walletRenderContextKeyRef.current !== expectedRenderContextKey) return
			invalidateWalletIdentity(publicErrorMessage(error, 'Wallet connection failed'))
		}
	}
	walletConnectHandler.current = () => void connect()

	async function refreshWalletContextAfterEvent(provider: InjectedEthereum, eventName: WalletContextChangeEvent, allowDisconnectedRefresh: boolean) {
		const contextLabel = eventName === 'accountsChanged' ? 'Wallet account changed' : 'Wallet network changed'
		if ((!allowDisconnectedRefresh && accountRef.current === undefined) || positionWorkflowLockedRef.current || liquidityWorkflowLockedRef.current) {
			invalidateWalletIdentity(`${contextLabel}. Reconnect before simulating or submitting.`)
			if (!positionWorkflowLockedRef.current && !liquidityWorkflowLockedRef.current) dispatchWorkflow({ type: 'failed', message: `${contextLabel}. Reconnect before simulating or submitting.` })
			return
		}
		invalidateWalletIdentity(`${contextLabel}. Refreshing wallet context…`)
		const request = connectionRequests.begin()
		const expectedRenderContextKey = walletRenderContextKey
		try {
			const requireCurrentConnection = () => {
				if (!walletComponentMounted.current || !connectionRequests.isCurrent(request)) return false
				if (getInjectedEthereum() !== provider) throw new Error('Wallet provider changed; reconnect before continuing')
				if (walletRenderContextKeyRef.current !== expectedRenderContextKey) {
					walletContextChangeHandler.current(provider, eventName, true)
					return false
				}
				return true
			}
			if (configuration === undefined) throw new Error('Deployment configuration is unavailable')
			const chainId = await services.walletChainId(provider)
			if (!requireCurrentConnection()) return
			if (chainId !== configuration.chainId) throw new Error(`Wallet must use ${configuration.chainName}`)
			const connected = await services.connectWallet(provider)
			if (!requireCurrentConnection()) return
			walletSubscriptionCleanup.current?.()
			walletSubscriptionCleanup.current = subscribeToWalletContextChanges(provider, changedEventName => {
				walletContextChangeHandler.current(provider, changedEventName, false)
			})
			const confirmedChainId = await services.walletChainId(provider)
			if (!requireCurrentConnection()) return
			if (confirmedChainId !== configuration.chainId) throw new Error(`Wallet must use ${configuration.chainName}`)
			const confirmedAccount = await services.connectWallet(provider)
			if (!requireCurrentConnection()) return
			if (confirmedAccount !== connected) throw new Error('Wallet account changed while refreshing; reconnect to continue')
			balanceRequests.invalidate()
			walletSummaryRequests.invalidate()
			simulationRequests.invalidate()
			accountRef.current = connected
			setWalletEthAttoEth(undefined)
			setWalletRepAttoRep(undefined)
			setWalletSummaryError(undefined)
			setWalletSummaryErrorLabel(undefined)
			setWalletSummaryUniverseId(selectedUniverseId)
			setWalletSummaryStatus('loading')
			onWalletSummaryChange(walletSummaryRefreshState(connected, selectedUniverseId))
			setBalances(undefined)
			setBalanceState('loading')
			setBalanceError(undefined)
			setWalletContextInvalidated(false)
			walletContextRevision.current++
			setAccount(connected)
			setWalletClient(services.createTradingWalletClient(provider, connected))
			setWalletProvider(provider)
			setWalletConnectionFeedback(undefined)
			dispatchWorkflow({ type: 'reset' })
			await refresh(configuration)
		} catch (error) {
			if (!connectionRequests.isCurrent(request) || walletRenderContextKeyRef.current !== expectedRenderContextKey) return
			invalidateWalletIdentity(`${contextLabel}: ${publicErrorMessage(error, 'wallet refresh failed')}`)
			dispatchWorkflow({ type: 'failed', message: `${contextLabel}: wallet refresh failed` })
		}
	}
	walletContextChangeHandler.current = (provider, eventName, allowDisconnectedRefresh) => void refreshWalletContextAfterEvent(provider, eventName, allowDisconnectedRefresh)

	async function refreshBalancesAfterApproval(label: string, expectedMarket: LiveMarket, expectedAccount: Address, request = balanceRequests.begin()): Promise<'ready' | 'refresh-error' | 'context-changed'> {
		if (configuration === undefined || accountRef.current !== expectedAccount || !balanceRequests.isCurrent(request)) return 'context-changed'
		setBalances(undefined)
		setBalanceState('loading')
		setBalanceError(undefined)
		try {
			const loaded = await services.loadLiveBalances(services.createTradingPublicClient(configuration), expectedMarket, expectedAccount, configuration.router)
			if (accountRef.current !== expectedAccount || !balanceRequests.isCurrent(request)) return 'context-changed'
			setBalances(loaded)
			setBalanceState('ready')
			setBalanceError(undefined)
			return 'ready'
		} catch (error) {
			if (accountRef.current !== expectedAccount || !balanceRequests.isCurrent(request)) return 'context-changed'
			const detail = publicErrorMessage(error, 'Balance refresh failed')
			setBalanceState('error')
			setBalanceError(`${label} confirmed, but balances could not be refreshed: ${detail}`)
			return 'refresh-error'
		}
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
		balanceRequests,
		nextTransactionContext,
		createGuardedWalletWrite,
		executeWithCurrentWalletContext,
		refreshWalletSummaryAfterReceipt,
		refreshBalancesAfterApproval,
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
			walletContextIsCurrent: (expectedAccount: Address) => accountRef.current === expectedAccount,
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
			refreshBalancesAfterApproval,
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
