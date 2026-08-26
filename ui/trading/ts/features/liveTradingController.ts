import type { Address, Hash } from '@zoltar/shared/ethereum'
import { useCallback, useEffect, useMemo, useRef } from 'preact/hooks'
import { parseUnits } from '../lib/format.js'
import type { WalletSummaryState } from '../lib/walletSummaryState.js'
import { createLatestRequestGuard } from '@zoltar/ui-core-shared/lib/requestGuard.js'
import { getInjectedEthereum, subscribeToWalletContextChanges, type InjectedEthereum, type WalletContextChangeEvent } from '../protocol/injected.js'
import { liveBalancesForMarket, mapWithConcurrency, marketAcceptsNewRisk, publicErrorMessage, type LiveMarket } from '../protocol/live.js'
import type { DeploymentConfiguration } from '../protocol/config.js'
import type { LiveTradingControllerServices, PortfolioBalanceEntry, Quote } from './live/liveTradingTypes.js'
import { parsedUniverseId, useBalanceState, useDiscoveryState, usePositionWorkflowState, useQuestionClock, useWalletState } from './live/useLiveTradingState.js'
import {
	approvalFailureTransition,
	broadcastUncertainMessage,
	discoveryCommitAllowed,
	failedSubmissionTransition,
	filterMarketsByUniverse,
	livePairInitialized,
	liveTradingControllerServices,
	marketSelectionAfterDiscovery,
	observeKnownReceipt,
	parseSlippageBps,
	parseTransactionValidityMinutes,
	securityPoolAddressFromRoute,
	walletSummaryAvailability,
	walletSummaryDiscoveryRetryStart,
	walletSummaryRefreshState,
	type GuardedWalletWrite,
	type WorkflowOwner,
} from './liveTradingControllerHelpers.js'

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
	const { markets, setMarkets, selectedPool, setSelectedPool, discoveryState, setDiscoveryState, discoveryError, setDiscoveryError, marketPage, setMarketPage, deploymentIndex } = useDiscoveryState()
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
		walletSummaryStatus,
		setWalletSummaryStatus,
		walletEthAttoEth,
		setWalletEthAttoEth,
		walletRepAttoRep,
		setWalletRepAttoRep,
		walletSummaryError,
		setWalletSummaryError,
		walletSummaryErrorLabel,
		setWalletSummaryErrorLabel,
		walletSummaryUniverseId,
		setWalletSummaryUniverseId,
		walletSummaryReceiptNonce,
		setWalletSummaryReceiptNonce,
		walletConnectionFeedback,
		setWalletConnectionFeedback,
	} = useWalletState()
	const { balances, setBalances, balanceState, setBalanceState, balanceError, setBalanceError, portfolioEntries, setPortfolioEntries, portfolioBalanceState, setPortfolioBalanceState, portfolioBalanceError, setPortfolioBalanceError, portfolioRefreshNonce, setPortfolioRefreshNonce } = useBalanceState()
	const {
		mode,
		setMode,
		side,
		setSide,
		amount,
		setAmount,
		slippage,
		setSlippage,
		transactionValidityMinutes,
		setTransactionValidityMinutes,
		quote,
		setQuote,
		state,
		setState,
		positionHash,
		setPositionHash,
		message,
		setMessage,
		positionReceiptWarning,
		setPositionReceiptWarning,
		positionWorkflow,
		positionWorkflowLockedRef,
		liquidityWorkflowLockedRef,
		workflowLocked,
		updatePositionWorkflowLock,
		updateLiquidityWorkflowLock,
	} = usePositionWorkflowState(onWorkflowLockChange, defaultSlippage, defaultValidityMinutes)
	const marketListRef = useRef<HTMLElement>(null)
	const marketDetailRef = useRef<HTMLElement>(null)
	const portfolioBalanceRequests = useRef(createLatestRequestGuard()).current
	const previousRoute = useRef(route)
	const discoveryRequests = useRef(createLatestRequestGuard()).current
	const balanceRequests = useRef(createLatestRequestGuard()).current
	const walletSummaryRequests = useRef(createLatestRequestGuard()).current
	const connectionRequests = useRef(createLatestRequestGuard()).current
	const simulationRequests = useRef(createLatestRequestGuard()).current
	const walletContextRevision = useRef(0)
	const walletSubscriptionCleanup = useRef<(() => void) | undefined>()
	const walletContextChangeHandler = useRef<(provider: InjectedEthereum, eventName: WalletContextChangeEvent, allowDisconnectedRefresh: boolean) => void>(() => undefined)
	const walletConnectHandler = useRef<() => void>(() => undefined)
	const walletComponentMounted = useRef(true)
	const walletRenderContextKey = `${route}\u0000${selectedUniverseId ?? ''}\u0000${configuration?.chainId.toString() ?? ''}\u0000${configuration?.router ?? ''}`
	const walletRenderContextKeyRef = useRef(walletRenderContextKey)
	walletRenderContextKeyRef.current = walletRenderContextKey
	const previousWalletSummaryRetryNonce = useRef(walletSummaryRetryNonce)

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
			if (!positionWorkflowLockedRef.current) {
				setPositionHash(undefined)
				setPositionReceiptWarning(undefined)
			}
			setMessage(detail)
		},
		[balanceRequests, connectionRequests, onWalletSummaryChange, portfolioBalanceRequests, route, selectedUniverseId, simulationRequests, walletSummaryRequests],
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
	const parsedAmount = useMemo(() => {
		try {
			return { value: parseUnits(amount), error: undefined }
		} catch (error) {
			return { value: undefined, error: error instanceof Error ? error.message : 'Invalid amount' }
		}
	}, [amount])

	useEffect(() => {
		onWalletSummaryChange({ account, ethAttoEth: walletEthAttoEth, repAttoRep: walletRepAttoRep, status: walletSummaryStatus, error: walletSummaryError, errorLabel: walletSummaryErrorLabel, universeId: walletSummaryUniverseId })
	}, [account, onWalletSummaryChange, walletEthAttoEth, walletRepAttoRep, walletSummaryError, walletSummaryErrorLabel, walletSummaryStatus, walletSummaryUniverseId])

	useEffect(() => {
		const request = walletSummaryRequests.begin()
		setWalletEthAttoEth(undefined)
		setWalletRepAttoRep(undefined)
		setWalletSummaryError(undefined)
		setWalletSummaryErrorLabel(undefined)
		setWalletSummaryUniverseId(selectedUniverseId)
		if (account === undefined) {
			setWalletSummaryStatus('disconnected')
			return
		}
		const availability = walletSummaryAvailability(configuration !== undefined, configurationError, discoveryState, discoveryError, selected !== undefined)
		if (availability !== undefined) {
			setWalletSummaryStatus(availability.status)
			setWalletSummaryError(availability.error)
			setWalletSummaryErrorLabel(availability.errorLabel)
			return
		}
		if (configuration === undefined || selected === undefined) throw new Error('Wallet summary availability was resolved without a SecurityPool configuration')
		if (selected.loadError !== undefined) {
			setWalletSummaryStatus('error')
			setWalletSummaryError(`Wallet balances could not be loaded because the selected SecurityPool is unavailable: ${selected.loadError}`)
			setWalletSummaryErrorLabel('SecurityPool unavailable')
			return
		}
		setWalletSummaryStatus('loading')
		void services.loadWalletHeaderBalances(services.createTradingPublicClient(configuration), selected, account).then(
			loaded => {
				if (!walletSummaryRequests.isCurrent(request) || accountRef.current !== account) return
				setWalletEthAttoEth(loaded.ethAttoEth)
				setWalletRepAttoRep(loaded.repAttoRep)
				setWalletSummaryStatus('ready')
			},
			error => {
				if (!walletSummaryRequests.isCurrent(request) || accountRef.current !== account) return
				setWalletSummaryStatus('error')
				setWalletSummaryError(publicErrorMessage(error, 'Wallet ETH and REP balances could not be loaded'))
				setWalletSummaryErrorLabel('Wallet balance read failed')
			},
		)
		return () => walletSummaryRequests.invalidate()
	}, [account, configuration, configurationError, discoveryError, discoveryState, selected, walletSummaryReceiptNonce, walletSummaryRequests, walletSummaryRetryNonce])

	async function refresh(nextConfiguration = configuration, requestedStart = marketPage.start, owner: WorkflowOwner | undefined = undefined) {
		if (nextConfiguration === undefined) return
		const request = discoveryRequests.begin()
		simulationRequests.invalidate()
		setQuote(undefined)
		if (!positionWorkflowLockedRef.current) {
			setState('idle')
			if (owner !== 'position') {
				setPositionHash(undefined)
				setPositionReceiptWarning(undefined)
			}
		}
		if (accountRef.current !== undefined) {
			setBalanceState('loading')
			setBalanceError(undefined)
			setBalances(undefined)
		}
		if (route === 'portfolio') {
			portfolioBalanceRequests.invalidate()
			setPortfolioEntries([])
			setPortfolioBalanceState(accountRef.current === undefined ? 'disconnected' : 'loading')
			setPortfolioBalanceError(undefined)
		}
		setDiscoveryState('loading')
		setDiscoveryError(undefined)
		try {
			const client = services.createTradingPublicClient(nextConfiguration)
			await services.validateLiveDeployment(client, nextConfiguration)
			if (!discoveryRequests.isCurrent(request)) return
			const requestedUniverseId = parsedUniverseId(selectedUniverseId)
			const discovered =
				route === 'portfolio' || routePool !== undefined ? await services.discoverAllLiveMarketsInUniverse(client, nextConfiguration, requestedUniverseId, 25n, deploymentIndex) : await services.discoverLiveUniverseMarketPage(client, nextConfiguration, requestedUniverseId, requestedStart, 25n, deploymentIndex)
			if (!discoveryRequests.isCurrent(request)) return
			if (!discoveryCommitAllowed(owner, positionWorkflowLockedRef.current, liquidityWorkflowLockedRef.current)) {
				setDiscoveryState('ready')
				return
			}
			setMarkets(discovered.markets)
			onUniversesChange(discovered.universeIds, discovered.selectedUniverseId)
			setMarketPage({ start: discovered.start, total: discovered.total, previousStart: discovered.previousStart, nextStart: discovered.nextStart })
			setSelectedPool(currentPool => marketSelectionAfterDiscovery(discovered.markets, currentPool, requestedStart === marketPage.start))
			setDiscoveryState('ready')
		} catch (error) {
			if (!discoveryRequests.isCurrent(request)) return
			if (!discoveryCommitAllowed(owner, positionWorkflowLockedRef.current, liquidityWorkflowLockedRef.current)) {
				setDiscoveryState('ready')
				return
			}
			const detail = publicErrorMessage(error, 'SecurityPool discovery failed')
			setDiscoveryError(detail)
			setDiscoveryState('error')
			if (route === 'portfolio') {
				setPortfolioBalanceState('error')
				setPortfolioBalanceError(`SecurityPool discovery failed: ${detail}`)
			}
			if (accountRef.current !== undefined) {
				setBalanceState('error')
				setBalanceError('Market refresh failed before wallet balances could be revalidated')
			}
		}
	}

	function refreshFromControl() {
		if (!positionWorkflowLockedRef.current && !liquidityWorkflowLockedRef.current) void refresh()
	}

	function loadMarketPage(start: bigint | undefined) {
		if (start !== undefined && !workflowLocked) void refresh(configuration, start)
	}

	function focusSection(section: Readonly<{ current: HTMLElement | null }>) {
		requestAnimationFrame(() => {
			section.current?.focus({ preventScroll: true })
			section.current?.scrollIntoView({ block: 'start' })
		})
	}

	useEffect(() => {
		if (configuration === undefined) {
			discoveryRequests.invalidate()
			balanceRequests.invalidate()
			simulationRequests.invalidate()
			setMessage(configurationError)
			return
		}
		void refresh(configuration, 0n)
	}, [configuration, configurationError, selectedUniverseId])

	useEffect(() => {
		if (previousWalletSummaryRetryNonce.current === walletSummaryRetryNonce) return
		previousWalletSummaryRetryNonce.current = walletSummaryRetryNonce
		const retryStart = walletSummaryDiscoveryRetryStart(discoveryState, selected !== undefined, selected?.loadError, marketPage.start)
		if (configuration !== undefined && retryStart !== undefined) void refresh(configuration, retryStart)
	}, [configuration, discoveryState, marketPage.start, selected, walletSummaryRetryNonce])

	useEffect(() => {
		if (positionWorkflowLockedRef.current) return
		simulationRequests.invalidate()
		setQuote(undefined)
		setPositionHash(undefined)
		setPositionReceiptWarning(undefined)
		setState('idle')
		setWalletConnectionFeedback(current => (current?.route === route ? current : undefined))
		if (previousRoute.current !== route) {
			setMessage(undefined)
			void refresh(configuration, 0n)
		}
		previousRoute.current = route
	}, [route])

	useEffect(() => {
		if (selected === undefined || marketAcceptsNewRisk(selected, nowSeconds)) return
		simulationRequests.invalidate()
		setQuote(undefined)
		if (!positionWorkflowLockedRef.current && !liquidityWorkflowLockedRef.current) setState('idle')
	}, [nowSeconds, selected])

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

	useEffect(() => {
		const request = portfolioBalanceRequests.begin()
		if (route !== 'portfolio') {
			setPortfolioEntries([])
			setPortfolioBalanceState('disconnected')
			setPortfolioBalanceError(undefined)
			return
		}
		const emptyEntries = visibleMarkets.map(market => ({ market, balances: undefined, error: market.loadError }))
		setPortfolioEntries(emptyEntries)
		if (configuration === undefined || account === undefined) {
			setPortfolioBalanceState(walletContextInvalidated ? 'error' : 'disconnected')
			setPortfolioBalanceError(walletContextInvalidated ? 'Wallet context changed; reconnect before loading portfolio positions' : undefined)
			return
		}
		setPortfolioBalanceState('loading')
		setPortfolioBalanceError(undefined)
		const client = services.createTradingPublicClient(configuration)
		void mapWithConcurrency(visibleMarkets, 6, async (market, index) => {
			if (market.loadError !== undefined) return { market, balances: undefined, error: market.loadError }
			let entry: PortfolioBalanceEntry
			try {
				const loaded = await services.loadLiveBalances(client, market, account, configuration.router)
				entry = { market, balances: liveBalancesForMarket(loaded, market), error: undefined }
			} catch (error) {
				entry = { market, balances: undefined, error: publicErrorMessage(error, 'Balance refresh failed') }
			}
			if (portfolioBalanceRequests.isCurrent(request) && accountRef.current === account) setPortfolioEntries(current => current.map((currentEntry, currentIndex) => (currentIndex === index ? entry : currentEntry)))
			return entry
		})
			.then(entries => {
				if (!portfolioBalanceRequests.isCurrent(request) || accountRef.current !== account) return
				setPortfolioEntries(entries)
				setPortfolioBalanceState('ready')
				setPortfolioBalanceError(undefined)
			})
			.catch(error => {
				if (!portfolioBalanceRequests.isCurrent(request) || accountRef.current !== account) return
				setPortfolioBalanceState('error')
				setPortfolioBalanceError(publicErrorMessage(error, 'Portfolio balance refresh failed'))
			})
		return () => portfolioBalanceRequests.invalidate()
	}, [account, configuration, markets, portfolioBalanceRequests, portfolioRefreshNonce, route, selectedUniverseId, walletContextInvalidated])

	useEffect(() => {
		const request = balanceRequests.begin()
		if (route === 'portfolio') {
			setBalances(undefined)
			setBalanceState('disconnected')
			setBalanceError(undefined)
			return
		}
		if (configuration === undefined || account === undefined || selected === undefined || selected.loadError !== undefined) {
			setBalances(undefined)
			setBalanceState(walletContextInvalidated || selected?.loadError !== undefined ? 'error' : 'disconnected')
			setBalanceError(selected?.loadError)
			return
		}
		setBalanceState('loading')
		setBalanceError(undefined)
		setBalances(undefined)
		void services.loadLiveBalances(services.createTradingPublicClient(configuration), selected, account, configuration.router).then(
			loaded => {
				if (balanceRequests.isCurrent(request)) {
					setBalances(loaded)
					setBalanceState('ready')
					setBalanceError(undefined)
				}
			},
			error => {
				if (balanceRequests.isCurrent(request)) {
					setBalanceState('error')
					setBalanceError(publicErrorMessage(error, 'Balance refresh failed'))
				}
			},
		)
		return () => balanceRequests.invalidate()
	}, [account, configuration, route, selected, walletContextInvalidated])

	async function retryBalances() {
		if (configuration === undefined || selected === undefined) return
		if (account === undefined) {
			await connect()
			return
		}
		const request = balanceRequests.begin()
		simulationRequests.invalidate()
		setQuote(undefined)
		if (!positionWorkflowLockedRef.current) setState('idle')
		setBalanceState('loading')
		setBalanceError(undefined)
		setBalances(undefined)
		try {
			const loaded = await services.loadLiveBalances(services.createTradingPublicClient(configuration), selected, account, configuration.router)
			if (!balanceRequests.isCurrent(request)) return
			setBalances(loaded)
			setBalanceState('ready')
			setMessage(undefined)
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
			setMessage(undefined)
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
			if (!positionWorkflowLockedRef.current && !liquidityWorkflowLockedRef.current) setState('error')
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
			setMessage(undefined)
			setState('idle')
			await refresh(configuration)
		} catch (error) {
			if (!connectionRequests.isCurrent(request) || walletRenderContextKeyRef.current !== expectedRenderContextKey) return
			invalidateWalletIdentity(`${contextLabel}: ${publicErrorMessage(error, 'wallet refresh failed')}`)
			setState('error')
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

	async function simulate() {
		const slippageBps = parseSlippageBps(slippage)
		const validityMinutes = parseTransactionValidityMinutes(transactionValidityMinutes)
		if (configuration === undefined || selected === undefined || account === undefined || walletClient === undefined || parsedAmount.value === undefined || parsedAmount.value === 0n || slippageBps === undefined || validityMinutes === undefined) return
		const request = simulationRequests.begin()
		try {
			setState('simulating')
			setPositionHash(undefined)
			setMessage(undefined)
			const context = { account, configuration, walletClient }
			const nextQuote: Quote =
				mode === 'entry'
					? { ...context, kind: 'entry', value: await services.simulateEntry(walletClient, configuration, selected, account, side, parsedAmount.value, validityMinutes, slippageBps) }
					: { ...context, kind: 'exit', value: await services.simulateExit(walletClient, configuration, selected, account, side, parsedAmount.value, validityMinutes, slippageBps) }
			if (!simulationRequests.isCurrent(request)) return
			setQuote(nextQuote)
			setState('ready')
		} catch (error) {
			if (!simulationRequests.isCurrent(request)) return
			setQuote(undefined)
			setState('error')
			setMessage(publicErrorMessage(error, 'Router simulation failed'))
		}
	}

	async function approve() {
		if (configuration === undefined || selected === undefined || account === undefined || walletClient === undefined) return
		if (positionWorkflowLockedRef.current || liquidityWorkflowLockedRef.current || !positionWorkflow.begin()) return
		updatePositionWorkflowLock(true)
		setState('preparing')
		setMessage(undefined)
		setPositionReceiptWarning(undefined)
		setPositionHash(undefined)
		const balanceRequest = balanceRequests.begin()
		let broadcastHash: Hash | undefined
		let receiptKnown = false
		let keepLocked = false
		try {
			broadcastHash = await createGuardedWalletWrite(
				account,
				'Wallet network changed; switch back before approving',
				'Wallet account changed; reconnect before approving',
			)(async () => {
				setState('approval')
				return await services.approveRouter(walletClient, selected, configuration, account)
			})
			setPositionHash(broadcastHash)
			setState('approval-pending')
			const receipt = await observeKnownReceipt(walletClient.waitForTransactionReceipt({ hash: broadcastHash }), refreshWalletSummaryAfterReceipt)
			receiptKnown = true
			if (receipt.status === 'reverted') {
				if (!balanceRequests.isCurrent(balanceRequest)) {
					setState('error')
					setMessage(current => `${current ?? 'Wallet context changed.'} Approval transaction reverted.`)
					return
				}
				throw new Error('Approval transaction reverted')
			}
			setState('approval-confirmed')
			if (!balanceRequests.isCurrent(balanceRequest)) return
			const refreshResult = await refreshBalancesAfterApproval('Share-token approval', selected, account, balanceRequest)
			if (refreshResult !== 'ready') return
			setPositionReceiptWarning(undefined)
			setMessage(undefined)
		} catch (error) {
			if (!balanceRequests.isCurrent(balanceRequest)) {
				if (broadcastHash !== undefined && !receiptKnown) {
					keepLocked = true
					setState('approval-pending')
					setPositionReceiptWarning(broadcastUncertainMessage('Share-token approval', broadcastHash))
				} else setState('error')
				return
			}
			const failure = approvalFailureTransition('Share-token approval', broadcastHash, receiptKnown, error, 'Approval failed')
			keepLocked = failure.keepLocked
			setState(failure.state === 'pending' ? 'approval-pending' : failure.state)
			setMessage(failure.message)
			setPositionReceiptWarning(failure.warning)
		} finally {
			positionWorkflow.finish()
			if (!keepLocked) updatePositionWorkflowLock(false)
		}
	}

	async function submit() {
		if (configuration === undefined || account === undefined || walletClient === undefined || quote === undefined) return
		if (positionWorkflowLockedRef.current || liquidityWorkflowLockedRef.current || !positionWorkflow.begin()) return
		updatePositionWorkflowLock(true)
		setState('preparing')
		setPositionReceiptWarning(undefined)
		let broadcastHash: Hash | undefined
		let receiptKnown = false
		let keepLocked = false
		try {
			const quotedAmount = quote.kind === 'entry' ? quote.value.amount : quote.value.completeSets
			if (
				selected === undefined ||
				quote.account !== account ||
				quote.walletClient !== walletClient ||
				quote.configuration.chainId !== configuration.chainId ||
				quote.configuration.router !== configuration.router ||
				quote.value.market.pool !== selected.pool ||
				quote.value.side !== side ||
				quote.kind !== mode ||
				parsedAmount.value !== quotedAmount
			) {
				throw new Error('Trade inputs changed; simulate the current selection again')
			}
			simulationRequests.invalidate()
			await executeWithCurrentWalletContext(account, 'Wallet network changed; switch back before submitting', 'Wallet account changed; reconnect and simulate again', async () => undefined)
			const guardedPositionWrite = createGuardedWalletWrite(account, 'Wallet network changed during transaction revalidation; reconnect and simulate again', 'Wallet account changed during transaction revalidation; reconnect and simulate again')
			const guardedWrite: GuardedWalletWrite = async write =>
				await guardedPositionWrite(async () => {
					setState('submitting')
					return await write()
				})
			broadcastHash = quote.kind === 'entry' ? await services.submitFreshEntry(walletClient, configuration, account, quote.value, guardedWrite) : await services.submitFreshExit(walletClient, configuration, account, quote.value, guardedWrite)
			setPositionHash(broadcastHash)
			setState('pending')
			const receipt = await observeKnownReceipt(walletClient.waitForTransactionReceipt({ hash: broadcastHash }), refreshWalletSummaryAfterReceipt)
			receiptKnown = true
			if (receipt.status === 'reverted') throw new Error('Transaction reverted')
			setQuote(undefined)
			setPositionReceiptWarning(undefined)
			setState('confirmed')
			await refresh(configuration, marketPage.start, 'position')
		} catch (error) {
			if (broadcastHash !== undefined && !receiptKnown) {
				keepLocked = true
				setState('pending')
				setMessage(undefined)
				setPositionReceiptWarning(broadcastUncertainMessage('Transaction', broadcastHash))
			} else {
				const failure = failedSubmissionTransition(error, 'Transaction failed')
				setQuote(failure.quote)
				setState(failure.state)
				setMessage(failure.message)
				setPositionReceiptWarning(undefined)
			}
		} finally {
			positionWorkflow.finish()
			if (!keepLocked) updatePositionWorkflowLock(false)
		}
	}

	function resetPositionInput(update: () => void) {
		if (positionWorkflowLockedRef.current) return
		simulationRequests.invalidate()
		update()
		setQuote(undefined)
		setPositionHash(undefined)
		setState('idle')
	}

	function selectMarket(market: LiveMarket) {
		if (positionWorkflowLockedRef.current || liquidityWorkflowLockedRef.current) return
		balanceRequests.invalidate()
		simulationRequests.invalidate()
		setBalances(undefined)
		setBalanceState(account === undefined ? 'disconnected' : 'loading')
		setBalanceError(undefined)
		setSelectedPool(market.pool)
		setQuote(undefined)
		setState('idle')
		setPositionHash(undefined)
		setPositionReceiptWarning(undefined)
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
			simulate,
			approve,
			submit,
			setMode: (value: 'entry' | 'exit') => resetPositionInput(() => setMode(value)),
			setSide: (value: 'YES' | 'NO') => resetPositionInput(() => setSide(value)),
			setAmount: (value: string) => resetPositionInput(() => setAmount(value)),
			setSlippage: (value: string) => resetPositionInput(() => setSlippage(value)),
			setTransactionValidityMinutes: (value: string) => resetPositionInput(() => setTransactionValidityMinutes(value)),
		},
		workflow: {
			workflowLocked,
			updateLiquidityWorkflowLock,
		},
	}
}
