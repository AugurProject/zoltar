import type { Address, Hash, WalletClient } from '@zoltar/shared/ethereum'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { bigintToSafeNumber, parseUnits, parseUnitsOrUndefined } from '../app/format.ts'
import { createExclusiveWorkflowGuard, createLatestRequestGuard } from '../app/latestRequest.ts'
import { getInjectedEthereum, subscribeToWalletContextChanges, type InjectedEthereum, type WalletContextChangeEvent } from '../protocol/injected.ts'
import {
	approveRouter,
	connectWallet,
	createSecurityPoolDeploymentIndex,
	createTradingPublicClient,
	createTradingWalletClient,
	discoverAllLiveMarketsInUniverse,
	discoverLiveUniverseMarketPage,
	loadLiveBalances,
	loadWalletHeaderBalances,
	liveBalancesForMarket,
	mapWithConcurrency,
	marketAcceptsNewRisk,
	publicErrorMessage,
	simulateEntry,
	simulateExit,
	submitFreshEntry,
	submitFreshExit,
	switchWalletChain,
	validateLiveDeployment,
	walletChainId,
	type LiveBalances,
	type LiveMarket,
	type SecurityPoolDeployment,
} from '../protocol/live.ts'
import type { DeploymentConfiguration } from '../protocol/config.ts'

type EntryQuote = Awaited<ReturnType<typeof simulateEntry>>
type ExitQuote = Awaited<ReturnType<typeof simulateExit>>
export type QuoteContext = Readonly<{ account: Address; configuration: DeploymentConfiguration; walletClient: WalletClient }>

export type Quote = (Readonly<{ kind: 'entry'; value: EntryQuote }> | Readonly<{ kind: 'exit'; value: ExitQuote }>) & QuoteContext
export type TransactionState = 'idle' | 'simulating' | 'ready' | 'preparing' | 'approval' | 'approval-pending' | 'approval-confirmed' | 'submitting' | 'pending' | 'confirmed' | 'error'
export type BalanceState = 'disconnected' | 'loading' | 'ready' | 'error'
export type PortfolioBalanceEntry = Readonly<{ market: LiveMarket; balances: LiveBalances | undefined; error: string | undefined }>
export type WalletSummaryState = Readonly<{
	account: Address | undefined
	ethAttoEth: bigint | undefined
	repAttoRep: bigint | undefined
	status: 'disconnected' | 'loading' | 'ready' | 'error'
	error: string | undefined
	errorLabel: string | undefined
	universeId: string | undefined
}>

export type GuardedWalletWrite = <T>(write: () => Promise<T>) => Promise<T>
type WorkflowOwner = 'position' | 'liquidity'

export function walletSummaryRefreshState(account: Address | undefined, universeId: string | undefined): WalletSummaryState {
	return { account, ethAttoEth: undefined, repAttoRep: undefined, status: account === undefined ? 'disconnected' : 'loading', error: undefined, errorLabel: undefined, universeId }
}

export async function observeKnownReceipt<T>(receipt: Promise<T>, onKnownReceipt: () => void): Promise<T> {
	const knownReceipt = await receipt
	onKnownReceipt()
	return knownReceipt
}

export function walletSummaryDiscoveryRetryStart(discoveryState: 'loading' | 'ready' | 'error', selectedPoolAvailable: boolean, selectedPoolLoadError: string | undefined, currentPageStart: bigint) {
	return discoveryState === 'error' || !selectedPoolAvailable || selectedPoolLoadError !== undefined ? currentPageStart : undefined
}

export function walletSummaryAvailability(configurationAvailable: boolean, configurationError: string | undefined, discoveryState: 'loading' | 'ready' | 'error', discoveryError: string | undefined, selectedPoolAvailable: boolean) {
	if (!configurationAvailable) return configurationError === undefined ? { status: 'loading' as const, error: undefined, errorLabel: undefined } : { status: 'error' as const, error: configurationError, errorLabel: 'Deployment unavailable' }
	if (discoveryState === 'loading') return { status: 'loading' as const, error: undefined, errorLabel: undefined }
	if (discoveryState === 'error') return { status: 'error' as const, error: `SecurityPool discovery failed: ${discoveryError ?? 'unknown discovery error'}`, errorLabel: 'SecurityPool discovery failed' }
	if (selectedPoolAvailable) return undefined
	return { status: 'error' as const, error: 'No SecurityPool is available in the selected universe', errorLabel: 'No SecurityPool in this universe' }
}

export function parseSlippageBps(value: string) {
	const parsed = parseUnitsOrUndefined(value, 2)
	return parsed !== undefined && parsed >= 0n && parsed <= 500n ? parsed : undefined
}

export function parseTransactionValidityMinutes(value: string) {
	if (!/^\d+$/.test(value)) return undefined
	const parsed = BigInt(value)
	return parsed >= 1n && parsed <= 1_440n ? parsed : undefined
}

export function failedSubmissionTransition(caught: unknown, fallback: string) {
	return { quote: undefined, state: 'error' as const, message: publicErrorMessage(caught, fallback) }
}

export function broadcastUncertainMessage(label: string, hash: Hash) {
	return `${label} ${hash} was broadcast, but its receipt could not be confirmed. Do not resubmit. Check this hash in your wallet or configured block explorer, then reload only after its final status is known.`
}

export function approvalFailureTransition(label: string, broadcastHash: Hash | undefined, receiptKnown: boolean, caught: unknown, fallback: string) {
	if (broadcastHash !== undefined && !receiptKnown) return { keepLocked: true, state: 'pending' as const, message: undefined, warning: broadcastUncertainMessage(label, broadcastHash) }
	return { keepLocked: false, state: 'error' as const, message: publicErrorMessage(caught, fallback), warning: undefined }
}

export function positionControlsWorkflowLocked(state: TransactionState, receiptWarning: string | undefined) {
	return state === 'preparing' || state === 'approval' || state === 'approval-pending' || state === 'submitting' || state === 'pending' || receiptWarning !== undefined
}

export function discoveryCommitAllowed(owner: WorkflowOwner | undefined, positionLocked: boolean, liquidityLocked: boolean) {
	if (owner === 'position') return !liquidityLocked
	if (owner === 'liquidity') return !positionLocked
	return !positionLocked && !liquidityLocked
}

export function securityPoolAddressFromRoute(route: string) {
	const match = /^security-pool\/(0x[0-9a-fA-F]{40})$/.exec(route)
	return match?.[1]?.toLowerCase()
}

export function livePairInitialized(market: Pick<LiveMarket, 'pair' | 'lpTotalSupply' | 'yesReserve' | 'noReserve' | 'tradingStatus'>) {
	return market.pair !== undefined && market.lpTotalSupply > 0n && market.yesReserve > 0n && market.noReserve > 0n && market.tradingStatus !== 6
}

export function marketSelectionAfterDiscovery(markets: readonly Pick<LiveMarket, 'pool'>[], currentPool: Address | undefined, preserveCurrentPage: boolean) {
	if (preserveCurrentPage && markets.some(market => market.pool === currentPool)) return currentPool
	return markets[0]?.pool
}

export function filterMarketsByUniverse(markets: readonly LiveMarket[], selectedUniverseId: string | undefined) {
	if (selectedUniverseId === undefined) return []
	return markets.filter(market => market.universeId.toString() === selectedUniverseId)
}

function parsedUniverseId(selectedUniverseId: string | undefined) {
	if (selectedUniverseId === undefined) return undefined
	try {
		return BigInt(selectedUniverseId)
	} catch (error) {
		if (error instanceof SyntaxError) return undefined
		throw error
	}
}

function useWalletState() {
	const [account, setAccount] = useState<Address>()
	const accountRef = useRef(account)
	accountRef.current = account
	const [walletClient, setWalletClient] = useState<WalletClient>()
	const [walletProvider, setWalletProvider] = useState<InjectedEthereum>()
	const [walletContextInvalidated, setWalletContextInvalidated] = useState(false)
	const [walletSummaryStatus, setWalletSummaryStatus] = useState<WalletSummaryState['status']>('disconnected')
	const [walletEthAttoEth, setWalletEthAttoEth] = useState<bigint>()
	const [walletRepAttoRep, setWalletRepAttoRep] = useState<bigint>()
	const [walletSummaryError, setWalletSummaryError] = useState<string>()
	const [walletSummaryErrorLabel, setWalletSummaryErrorLabel] = useState<string>()
	const [walletSummaryUniverseId, setWalletSummaryUniverseId] = useState<string>()
	const [walletSummaryReceiptNonce, setWalletSummaryReceiptNonce] = useState(0)
	const [walletConnectionFeedback, setWalletConnectionFeedback] = useState<{ route: string; detail: string }>()

	return {
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
	}
}

function useBalanceState() {
	const [balances, setBalances] = useState<LiveBalances>()
	const [balanceState, setBalanceState] = useState<BalanceState>('disconnected')
	const [balanceError, setBalanceError] = useState<string>()
	const [portfolioEntries, setPortfolioEntries] = useState<readonly PortfolioBalanceEntry[]>([])
	const [portfolioBalanceState, setPortfolioBalanceState] = useState<BalanceState>('disconnected')
	const [portfolioBalanceError, setPortfolioBalanceError] = useState<string>()
	const [portfolioRefreshNonce, setPortfolioRefreshNonce] = useState(0)

	return { balances, setBalances, balanceState, setBalanceState, balanceError, setBalanceError, portfolioEntries, setPortfolioEntries, portfolioBalanceState, setPortfolioBalanceState, portfolioBalanceError, setPortfolioBalanceError, portfolioRefreshNonce, setPortfolioRefreshNonce }
}

function useDiscoveryState() {
	const [markets, setMarkets] = useState<LiveMarket[]>([])
	const [selectedPool, setSelectedPool] = useState<Address>()
	const [discoveryState, setDiscoveryState] = useState<'loading' | 'ready' | 'error'>('loading')
	const [discoveryError, setDiscoveryError] = useState<string>()
	const [marketPage, setMarketPage] = useState({ start: 0n, total: 0n, previousStart: undefined as bigint | undefined, nextStart: undefined as bigint | undefined })
	const deploymentIndex = useRef(createSecurityPoolDeploymentIndex<SecurityPoolDeployment, { blockNumber: bigint; blockHash: Hash }>()).current

	return { markets, setMarkets, selectedPool, setSelectedPool, discoveryState, setDiscoveryState, discoveryError, setDiscoveryError, marketPage, setMarketPage, deploymentIndex }
}

function usePositionWorkflowState(onWorkflowLockChange: (locked: boolean) => void, defaultSlippage: string, defaultValidityMinutes: string) {
	const [mode, setMode] = useState<'entry' | 'exit'>('entry')
	const [side, setSide] = useState<'YES' | 'NO'>('YES')
	const [amount, setAmount] = useState('0.01')
	const [slippage, setSlippage] = useState(defaultSlippage)
	const [transactionValidityMinutes, setTransactionValidityMinutes] = useState(defaultValidityMinutes)
	const [quote, setQuote] = useState<Quote>()
	const [state, setState] = useState<TransactionState>('idle')
	const [positionHash, setPositionHash] = useState<Hash>()
	const [message, setMessage] = useState<string>()
	const [positionReceiptWarning, setPositionReceiptWarning] = useState<string>()
	const positionWorkflow = useRef(createExclusiveWorkflowGuard()).current
	const positionWorkflowLockedRef = useRef(false)
	const liquidityWorkflowLockedRef = useRef(false)
	const [positionWorkflowLocked, setPositionWorkflowLocked] = useState(false)
	const [liquidityWorkflowLocked, setLiquidityWorkflowLocked] = useState(false)
	const workflowLocked = positionWorkflowLocked || liquidityWorkflowLocked
	const updatePositionWorkflowLock = useCallback(
		(locked: boolean) => {
			positionWorkflowLockedRef.current = locked
			setPositionWorkflowLocked(locked)
			onWorkflowLockChange(positionWorkflowLockedRef.current || liquidityWorkflowLockedRef.current)
		},
		[onWorkflowLockChange],
	)
	const updateLiquidityWorkflowLock = useCallback(
		(locked: boolean) => {
			liquidityWorkflowLockedRef.current = locked
			setLiquidityWorkflowLocked(locked)
			onWorkflowLockChange(positionWorkflowLockedRef.current || liquidityWorkflowLockedRef.current)
		},
		[onWorkflowLockChange],
	)

	useEffect(
		() => () => {
			if (positionWorkflow.isActive()) positionWorkflow.finish()
			onWorkflowLockChange(false)
		},
		[onWorkflowLockChange, positionWorkflow],
	)

	return {
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
	}
}

export function useQuestionClock(endTime: bigint | undefined) {
	const [nowSeconds, setNowSeconds] = useState(() => BigInt(Math.floor(Date.now() / 1_000)))

	useEffect(() => {
		let timeout: number | undefined
		let active = true
		const updateAtBoundary = () => {
			if (!active) return
			const current = BigInt(Math.floor(Date.now() / 1_000))
			setNowSeconds(current)
			if (endTime === undefined || current >= endTime) return
			const remainingSeconds = endTime - current
			const maximumDelay = 2_147_000_000
			const delay = remainingSeconds > BigInt(Math.floor(maximumDelay / 1_000)) ? maximumDelay : bigintToSafeNumber(remainingSeconds, 'Question-end delay') * 1_000 + 50
			timeout = window.setTimeout(updateAtBoundary, delay)
		}
		updateAtBoundary()
		return () => {
			active = false
			if (timeout !== undefined) window.clearTimeout(timeout)
		}
	}, [endTime])

	return nowSeconds
}

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
				chainId = await walletChainId(provider)
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
				connectedAccount = await connectWallet(provider)
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
	const nowSeconds = useQuestionClock(selected?.endTime)
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
		void loadWalletHeaderBalances(createTradingPublicClient(configuration), selected, account).then(
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
			const client = createTradingPublicClient(nextConfiguration)
			await validateLiveDeployment(client, nextConfiguration)
			if (!discoveryRequests.isCurrent(request)) return
			const requestedUniverseId = parsedUniverseId(selectedUniverseId)
			const discovered = route === 'portfolio' || routePool !== undefined ? await discoverAllLiveMarketsInUniverse(client, nextConfiguration, requestedUniverseId, 25n, deploymentIndex) : await discoverLiveUniverseMarketPage(client, nextConfiguration, requestedUniverseId, requestedStart, 25n, deploymentIndex)
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
		const client = createTradingPublicClient(configuration)
		void mapWithConcurrency(visibleMarkets, 6, async (market, index) => {
			if (market.loadError !== undefined) return { market, balances: undefined, error: market.loadError }
			let entry: PortfolioBalanceEntry
			try {
				const loaded = await loadLiveBalances(client, market, account, configuration.router)
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
		void loadLiveBalances(createTradingPublicClient(configuration), selected, account, configuration.router).then(
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
			const loaded = await loadLiveBalances(createTradingPublicClient(configuration), selected, account, configuration.router)
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
			let chainId = await walletChainId(provider)
			if (!requireCurrentConnection()) return
			if (chainId !== configuration.chainId) {
				await switchWalletChain(provider, configuration.chainId)
				if (!requireCurrentConnection()) return
				chainId = await walletChainId(provider)
				if (!requireCurrentConnection()) return
			}
			if (chainId !== configuration.chainId) throw new Error(`Wallet must use ${configuration.chainName}`)
			const connected = await connectWallet(provider)
			if (!requireCurrentConnection()) return
			walletSubscriptionCleanup.current?.()
			walletSubscriptionCleanup.current = subscribeToWalletContextChanges(provider, (eventName: WalletContextChangeEvent) => {
				walletContextChangeHandler.current(provider, eventName, false)
			})
			const confirmedChainId = await walletChainId(provider)
			if (!requireCurrentConnection()) return
			if (confirmedChainId !== configuration.chainId) throw new Error(`Wallet must use ${configuration.chainName}`)
			const confirmedAccount = await connectWallet(provider)
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
			setWalletClient(createTradingWalletClient(provider, connected))
			setWalletProvider(provider)
			setWalletConnectionFeedback(undefined)
			setMessage(undefined)
			await refresh(configuration)
		} catch (error) {
			if (!connectionRequests.isCurrent(request)) return
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
			const chainId = await walletChainId(provider)
			if (!requireCurrentConnection()) return
			if (chainId !== configuration.chainId) throw new Error(`Wallet must use ${configuration.chainName}`)
			const connected = await connectWallet(provider)
			if (!requireCurrentConnection()) return
			walletSubscriptionCleanup.current?.()
			walletSubscriptionCleanup.current = subscribeToWalletContextChanges(provider, changedEventName => {
				walletContextChangeHandler.current(provider, changedEventName, false)
			})
			const confirmedChainId = await walletChainId(provider)
			if (!requireCurrentConnection()) return
			if (confirmedChainId !== configuration.chainId) throw new Error(`Wallet must use ${configuration.chainName}`)
			const confirmedAccount = await connectWallet(provider)
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
			setWalletClient(createTradingWalletClient(provider, connected))
			setWalletProvider(provider)
			setWalletConnectionFeedback(undefined)
			setMessage(undefined)
			setState('idle')
			await refresh(configuration)
		} catch (error) {
			if (!connectionRequests.isCurrent(request)) return
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
			const loaded = await loadLiveBalances(createTradingPublicClient(configuration), expectedMarket, expectedAccount, configuration.router)
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
					? { ...context, kind: 'entry', value: await simulateEntry(walletClient, configuration, selected, account, side, parsedAmount.value, validityMinutes, slippageBps) }
					: { ...context, kind: 'exit', value: await simulateExit(walletClient, configuration, selected, account, side, parsedAmount.value, validityMinutes, slippageBps) }
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
				return await approveRouter(walletClient, selected, configuration, account)
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
			broadcastHash = quote.kind === 'entry' ? await submitFreshEntry(walletClient, configuration, account, quote.value, guardedWrite) : await submitFreshExit(walletClient, configuration, account, quote.value, guardedWrite)
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
