import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { Address, Hash, WalletClient } from '@zoltar/shared/ethereum'
import { bigintToSafeNumber, formatBpsMultiplier, formatCapacityOwnership, formatEthPerShare, formatShareAmount, formatUnits, parseUnits, parseUnitsOrUndefined, shortAddress } from '../app/format.ts'
import { createExclusiveWorkflowGuard, createLatestRequestGuard } from '../app/latestRequest.ts'
import { AddressValue, Status } from '../components/Status.tsx'
import { ProbabilityBar } from '../components/ProbabilityBar.tsx'
import type { DeploymentConfiguration } from '../protocol/config.ts'
import {
	approveLpRouter,
	approveRouter,
	connectWallet,
	createTradingPublicClient,
	createTradingWalletClient,
	discoverAllLiveMarkets,
	discoverLiveMarketPage,
	loadLiveBalances,
	liveBalancesForMarket,
	marketAcceptsNewRisk,
	marketNewRiskBlocker,
	mapWithConcurrency,
	settlementAvailability,
	shareBalanceScope,
	simulateEntry,
	simulateExit,
	simulateLiquidity,
	simulateSettlement,
	submitFreshEntry,
	submitFreshExit,
	submitFreshLiquidity,
	submitFreshSettlement,
	switchWalletChain,
	validateLiveDeployment,
	walletChainId,
	type LiquidityOperation,
	type LiveBalances,
	type LiveMarket,
	type MarketLifecycle,
	type SettlementOperation,
	type ShareOutcome,
} from '../protocol/live.ts'
import { getInjectedEthereum, subscribeToWalletContextChanges, type InjectedEthereum, type WalletContextChangeEvent } from '../protocol/injected.ts'
import { maximumInsuredExit } from '../../../ts/sdk/positions.ts'

type EntryQuote = Awaited<ReturnType<typeof simulateEntry>>
type ExitQuote = Awaited<ReturnType<typeof simulateExit>>
type QuoteContext = Readonly<{ account: Address; configuration: DeploymentConfiguration; walletClient: WalletClient }>
type Quote = (Readonly<{ kind: 'entry'; value: EntryQuote }> | Readonly<{ kind: 'exit'; value: ExitQuote }>) & QuoteContext
type TransactionState = 'idle' | 'simulating' | 'ready' | 'approval' | 'pending' | 'confirmed' | 'error'
type BalanceState = 'disconnected' | 'loading' | 'ready' | 'error'
export type PortfolioBalanceEntry = Readonly<{ market: LiveMarket; balances: LiveBalances | undefined; error: string | undefined }>

function statusLabel(market: LiveMarket, nowSeconds: bigint) {
	if (market.loadError !== undefined) return 'Market data unavailable'
	const blocker = marketNewRiskBlocker(market, nowSeconds)
	if (blocker !== undefined) return blocker
	if (market.pair === undefined) return 'Pair not created'
	return livePairInitialized(market) ? 'Trading open' : 'Pair uninitialized'
}

function systemStateLabel(state: number) {
	if (state === 0) return 'Operational'
	if (state === 1) return 'Pool forked'
	if (state === 2) return 'Fork migration'
	if (state === 3) return 'Fork truth auction'
	return `Unknown state ${state}`
}

function questionOutcomeLabel(outcome: number) {
	if (outcome === 0) return 'INVALID'
	if (outcome === 1) return 'YES'
	if (outcome === 2) return 'NO'
	if (outcome === 3) return 'None (unresolved)'
	return `Unknown outcome ${outcome}`
}

function formatTimestamp(timestamp: bigint) {
	const maximumDateSeconds = 8_640_000_000_000n
	if (timestamp < 0n || timestamp > maximumDateSeconds) return 'Unsupported on-chain timestamp'
	const date = new Date(bigintToSafeNumber(timestamp * 1_000n, 'Timestamp'))
	if (Number.isNaN(date.getTime())) return 'Unsupported on-chain timestamp'
	try {
		return `${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(date)} UTC`
	} catch (error) {
		return error instanceof Error ? `Timestamp formatting failed: ${error.message}` : 'Timestamp formatting failed'
	}
}

function stateLabel(state: TransactionState) {
	if (state === 'simulating') return 'Simulating router call…'
	if (state === 'ready') return 'Fresh authoritative simulation ready'
	if (state === 'approval') return 'Approval transaction pending…'
	if (state === 'pending') return 'Transaction pending…'
	if (state === 'confirmed') return 'Transaction confirmed on-chain'
	if (state === 'error') return 'Transaction workflow needs attention'
	return 'Ready to simulate after wallet balances and inputs are valid'
}

export function failedSubmissionTransition(caught: unknown, fallback: string) {
	return { quote: undefined, state: 'error' as const, message: caught instanceof Error ? caught.message : fallback }
}

export function broadcastUncertainMessage(label: string, hash: Hash) {
	return `${label} ${hash} was broadcast, but its receipt could not be confirmed. Do not resubmit. Check this hash in your wallet or configured block explorer, then reload only after its final status is known.`
}

export function approvalFailureTransition(label: string, broadcastHash: Hash | undefined, receiptKnown: boolean, caught: unknown, fallback: string) {
	if (broadcastHash !== undefined && !receiptKnown) return { keepLocked: true, state: 'pending' as const, message: undefined, warning: broadcastUncertainMessage(label, broadcastHash) }
	return { keepLocked: false, state: 'error' as const, message: caught instanceof Error ? caught.message : fallback, warning: undefined }
}

export function positionControlsWorkflowLocked(state: TransactionState, receiptWarning: string | undefined) {
	return state === 'approval' || state === 'pending' || receiptWarning !== undefined
}

type WorkflowOwner = 'position' | 'liquidity'

export function discoveryCommitAllowed(owner: WorkflowOwner | undefined, positionLocked: boolean, liquidityLocked: boolean) {
	if (owner === 'position') return !liquidityLocked
	if (owner === 'liquidity') return !positionLocked
	return !positionLocked && !liquidityLocked
}

function configuredClient(configuration: DeploymentConfiguration) {
	return createTradingPublicClient(configuration)
}

function BalanceLoadError({ message, retry, disabled = false }: { message: string; retry(): Promise<void>; disabled?: boolean }) {
	return (
		<div class='balance-recovery'>
			<p class='error' role='alert'>
				{message}
			</p>
			<button class='secondary-action' disabled={disabled} onClick={() => void retry()}>
				Retry balances
			</button>
		</div>
	)
}

function MarketShareIdentityRows({ market }: { market: Pick<LiveMarket, 'pool' | 'shareToken' | 'universeId' | 'questionId'> }) {
	const scope = shareBalanceScope(market)
	return (
		<>
			<div>
				<dt>SecurityPool</dt>
				<dd>
					<AddressValue value={scope.pool} />
				</dd>
			</div>
			<div>
				<dt>ShareToken</dt>
				<dd>
					<AddressValue value={scope.shareToken} />
				</dd>
			</div>
			<div>
				<dt>Universe / question</dt>
				<dd>
					{market.universeId.toString()} / {market.questionId.toString()}
				</dd>
			</div>
			<div>
				<dt>Outcome token IDs</dt>
				<dd>
					INVALID {scope.invalidTokenId.toString()} · YES {scope.yesTokenId.toString()} · NO {scope.noTokenId.toString()}
				</dd>
			</div>
		</>
	)
}

export function livePairInitialized(market: Pick<LiveMarket, 'pair' | 'lpTotalSupply' | 'yesReserve' | 'noReserve' | 'tradingStatus'>) {
	return market.pair !== undefined && market.lpTotalSupply > 0n && market.yesReserve > 0n && market.noReserve > 0n && market.tradingStatus !== 6
}

export function marketSelectionAfterDiscovery(markets: readonly Pick<LiveMarket, 'pool'>[], currentPool: Address | undefined, preserveCurrentPage: boolean) {
	if (preserveCurrentPage && markets.some(market => market.pool === currentPool)) return currentPool
	return markets[0]?.pool
}

function PairInitializationAction({ market }: { market: LiveMarket }) {
	const blocker = marketNewRiskBlocker(market, BigInt(Math.floor(Date.now() / 1_000)))
	if (blocker !== undefined)
		return (
			<div class='operation-block'>
				<p>Conditional price unavailable until initialization.</p>
				<button class='primary-action' disabled>
					{blocker} — pair initialization unavailable
				</button>
			</div>
		)
	return (
		<div class='operation-block'>
			<p>Conditional price unavailable until initialization.</p>
			<a class='primary-action' href='#/liquidity'>
				{market.pair === undefined ? 'Create pair and initialize atomically in Liquidity' : 'Initialize this pair in Liquidity'}
			</a>
		</div>
	)
}

export function insuredExitLimitMessage(requested: bigint, maximum: bigint, invalidBalance: bigint) {
	if (maximum === invalidBalance && requested > invalidBalance) return `Your INVALID balance covers only ${formatUnits(invalidBalance)} complete sets. Excess YES/NO profit must remain as shares unless you acquire more INVALID.`
	return `Your current long-share balance and pair liquidity support an insured exit of at most ${formatUnits(maximum)} complete sets. Reduce the exit amount; excess directional shares remain in your wallet.`
}

export function parseForkOutcomeIndex(value: string) {
	if (!/^\d+$/.test(value)) return undefined
	return BigInt(value)
}

export function migrationSimulationSummary(blockNumber: bigint, sourceOutcome: ShareOutcome, targetOutcomeIndex: bigint) {
	return `Fork migration simulation ready at block ${blockNumber.toString()}: the entire selected ${sourceOutcome} balance will be copied to child outcome index ${targetOutcomeIndex.toString()} and locked in the parent universe.`
}

export function settlementInputBlocker(operation: SettlementOperation, operationAvailable: boolean, completeSets: bigint, parsedAmount: bigint | undefined, parsedTargetOutcome: bigint | undefined, sourceOutcome: ShareOutcome, sourceBalance: bigint | undefined) {
	if (!operationAvailable) return 'The selected settlement action is unavailable for the current lifecycle state or wallet balances'
	if (operation === 'redeem-complete-set') {
		if (parsedAmount === undefined || parsedAmount === 0n) return 'Enter a valid positive complete-set share amount'
		if (parsedAmount > completeSets) return `Enter no more than the available complete-set balance of ${formatShareAmount(completeSets)}`
	}
	if (operation === 'migrate-shares') {
		if (parsedTargetOutcome === undefined) return 'Enter the explicit non-negative outcome index for the child universe'
		if (sourceBalance === undefined || sourceBalance === 0n) return `The selected ${sourceOutcome} source-share balance is zero`
	}
	return undefined
}

export function settlementBalanceLabel(balanceState: BalanceState, balance: bigint | undefined) {
	if (balanceState === 'loading') return 'Loading…'
	if (balanceState === 'error') return 'Unavailable'
	if (balanceState !== 'ready' || balance === undefined) return 'Not loaded'
	return formatShareAmount(balance)
}

export function LiveTrading({ route, configuration, configurationError, onWorkflowLockChange }: { route: string; configuration: DeploymentConfiguration | undefined; configurationError: string | undefined; onWorkflowLockChange(locked: boolean): void }) {
	const [markets, setMarkets] = useState<LiveMarket[]>([])
	const [selectedPool, setSelectedPool] = useState<Address>()
	const [account, setAccount] = useState<Address>()
	const accountRef = useRef(account)
	accountRef.current = account
	const [walletClient, setWalletClient] = useState<WalletClient>()
	const [walletProvider, setWalletProvider] = useState<InjectedEthereum>()
	const [walletContextInvalidated, setWalletContextInvalidated] = useState(false)
	const [balances, setBalances] = useState<LiveBalances>()
	const [balanceState, setBalanceState] = useState<BalanceState>('disconnected')
	const [balanceError, setBalanceError] = useState<string>()
	const [portfolioEntries, setPortfolioEntries] = useState<readonly PortfolioBalanceEntry[]>([])
	const [portfolioBalanceState, setPortfolioBalanceState] = useState<BalanceState>('disconnected')
	const [portfolioBalanceError, setPortfolioBalanceError] = useState<string>()
	const [portfolioRefreshNonce, setPortfolioRefreshNonce] = useState(0)
	const [mode, setMode] = useState<'entry' | 'exit'>('entry')
	const [side, setSide] = useState<'YES' | 'NO'>('YES')
	const [amount, setAmount] = useState('0.01')
	const [quote, setQuote] = useState<Quote>()
	const [state, setState] = useState<TransactionState>('idle')
	const [message, setMessage] = useState<string>()
	const [positionReceiptWarning, setPositionReceiptWarning] = useState<string>()
	const [discoveryState, setDiscoveryState] = useState<'loading' | 'ready' | 'error'>('loading')
	const [discoveryError, setDiscoveryError] = useState<string>()
	const [marketPage, setMarketPage] = useState({ start: 0n, total: 0n, previousStart: undefined as bigint | undefined, nextStart: undefined as bigint | undefined })
	const marketListRef = useRef<HTMLElement>(null)
	const portfolioBalanceRequests = useRef(createLatestRequestGuard()).current
	const previousRoute = useRef(route)
	const marketDetailRef = useRef<HTMLElement>(null)
	const discoveryRequests = useRef(createLatestRequestGuard()).current
	const balanceRequests = useRef(createLatestRequestGuard()).current
	const simulationRequests = useRef(createLatestRequestGuard()).current
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
	const selected = markets.find(market => market.pool === selectedPool) ?? markets[0]
	const selectedBalances = balanceState === 'ready' ? liveBalancesForMarket(balances, selected) : undefined
	let selectedBalanceState = balanceState
	if (balanceState !== 'error' && balances !== undefined && selectedBalances === undefined) selectedBalanceState = account === undefined ? 'disconnected' : 'loading'
	const selectedPairInitialized = selected === undefined ? false : livePairInitialized(selected)
	const [nowSeconds, setNowSeconds] = useState(() => BigInt(Math.floor(Date.now() / 1_000)))
	const parsedAmount = useMemo(() => {
		try {
			return { value: parseUnits(amount), error: undefined }
		} catch (error) {
			return { value: undefined, error: error instanceof Error ? error.message : 'Invalid amount' }
		}
	}, [amount])

	async function refresh(nextConfiguration = configuration, requestedStart = marketPage.start, owner: WorkflowOwner | undefined = undefined) {
		if (nextConfiguration === undefined) return
		const request = discoveryRequests.begin()
		simulationRequests.invalidate()
		setQuote(undefined)
		if (!positionWorkflowLockedRef.current) setState('idle')
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
			const client = configuredClient(nextConfiguration)
			await validateLiveDeployment(client, nextConfiguration)
			if (!discoveryRequests.isCurrent(request)) return
			const discovered = route === 'portfolio' ? await discoverAllLiveMarkets(client, nextConfiguration) : await discoverLiveMarketPage(client, nextConfiguration, requestedStart)
			if (!discoveryRequests.isCurrent(request)) return
			if (!discoveryCommitAllowed(owner, positionWorkflowLockedRef.current, liquidityWorkflowLockedRef.current)) {
				setDiscoveryState('ready')
				return
			}
			setMarkets(discovered.markets)
			setMarketPage({ start: discovered.start, total: discovered.total, previousStart: discovered.previousStart, nextStart: discovered.nextStart })
			setSelectedPool(currentPool => marketSelectionAfterDiscovery(discovered.markets, currentPool, requestedStart === marketPage.start))
			setDiscoveryState('ready')
		} catch (error) {
			if (!discoveryRequests.isCurrent(request)) return
			if (!discoveryCommitAllowed(owner, positionWorkflowLockedRef.current, liquidityWorkflowLockedRef.current)) {
				setDiscoveryState('ready')
				return
			}
			const detail = error instanceof Error ? error.message : 'SecurityPool discovery failed'
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

	useEffect(
		() => () => {
			if (positionWorkflow.isActive()) positionWorkflow.finish()
			onWorkflowLockChange(false)
		},
		[onWorkflowLockChange],
	)

	useEffect(() => {
		if (configuration === undefined) {
			discoveryRequests.invalidate()
			balanceRequests.invalidate()
			simulationRequests.invalidate()
			setMessage(configurationError)
			return
		}
		void refresh(configuration, 0n)
	}, [configuration, configurationError])

	useEffect(() => {
		if (positionWorkflowLockedRef.current) return
		simulationRequests.invalidate()
		setQuote(undefined)
		setState('idle')
		if (previousRoute.current !== route) void refresh(configuration, 0n)
		previousRoute.current = route
	}, [route])

	useEffect(() => {
		let timeout: number | undefined
		let active = true
		const updateAtBoundary = () => {
			if (!active) return
			const current = BigInt(Math.floor(Date.now() / 1_000))
			setNowSeconds(current)
			if (selected === undefined || current >= selected.endTime) return
			const remainingSeconds = selected.endTime - current
			const maximumDelay = 2_147_000_000
			const delay = remainingSeconds > BigInt(Math.floor(maximumDelay / 1_000)) ? maximumDelay : bigintToSafeNumber(remainingSeconds, 'Question-end delay') * 1_000 + 50
			timeout = window.setTimeout(updateAtBoundary, delay)
		}
		updateAtBoundary()
		return () => {
			active = false
			if (timeout !== undefined) window.clearTimeout(timeout)
		}
	}, [selected?.endTime])

	useEffect(() => {
		if (selected === undefined || marketAcceptsNewRisk(selected, nowSeconds)) return
		simulationRequests.invalidate()
		setQuote(undefined)
		if (!positionWorkflowLockedRef.current && !liquidityWorkflowLockedRef.current) setState('idle')
	}, [nowSeconds, selected])

	useEffect(() => {
		setWalletProvider(getInjectedEthereum())
	}, [])

	useEffect(() => {
		if (walletProvider === undefined) return
		return subscribeToWalletContextChanges(walletProvider, (eventName: WalletContextChangeEvent) => {
			balanceRequests.invalidate()
			portfolioBalanceRequests.invalidate()
			simulationRequests.invalidate()
			accountRef.current = undefined
			setWalletProvider(undefined)
			setWalletClient(undefined)
			setAccount(undefined)
			setBalances(undefined)
			setBalanceState('error')
			setBalanceError('Wallet context changed; reconnect to refresh balances and approvals')
			setPortfolioBalanceError('Wallet context changed; reconnect before loading portfolio positions')
			setWalletContextInvalidated(true)
			setQuote(undefined)
			if (!positionWorkflowLockedRef.current) setState('error')
			setMessage(eventName === 'accountsChanged' ? 'Wallet account changed. Reconnect before simulating or submitting.' : 'Wallet network changed. Reconnect on the configured network before simulating or submitting.')
		})
	}, [walletProvider])

	useEffect(() => {
		const request = portfolioBalanceRequests.begin()
		if (route !== 'portfolio') {
			setPortfolioEntries([])
			setPortfolioBalanceState('disconnected')
			setPortfolioBalanceError(undefined)
			return
		}
		const emptyEntries = markets.map(market => ({ market, balances: undefined, error: market.loadError }))
		setPortfolioEntries(emptyEntries)
		if (configuration === undefined || account === undefined) {
			setPortfolioBalanceState(walletContextInvalidated ? 'error' : 'disconnected')
			setPortfolioBalanceError(walletContextInvalidated ? 'Wallet context changed; reconnect before loading portfolio positions' : undefined)
			return
		}
		setPortfolioBalanceState('loading')
		setPortfolioBalanceError(undefined)
		const client = configuredClient(configuration)
		void mapWithConcurrency(markets, 6, async (market, index) => {
			if (market.loadError !== undefined) return { market, balances: undefined, error: market.loadError }
			let entry: PortfolioBalanceEntry
			try {
				const loaded = await loadLiveBalances(client, market, account, configuration.router)
				entry = { market, balances: liveBalancesForMarket(loaded, market), error: undefined }
			} catch (error) {
				entry = { market, balances: undefined, error: error instanceof Error ? error.message : 'Balance refresh failed' }
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
				setPortfolioBalanceError(error instanceof Error ? error.message : 'Portfolio balance refresh failed')
			})
		return () => portfolioBalanceRequests.invalidate()
	}, [account, configuration, markets, portfolioBalanceRequests, portfolioRefreshNonce, route, walletContextInvalidated])

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
		void loadLiveBalances(configuredClient(configuration), selected, account, configuration.router).then(
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
					setBalanceError(error instanceof Error ? error.message : 'Balance refresh failed')
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
			const loaded = await loadLiveBalances(configuredClient(configuration), selected, account, configuration.router)
			if (!balanceRequests.isCurrent(request)) return
			setBalances(loaded)
			setBalanceState('ready')
			setMessage(undefined)
		} catch (error) {
			if (!balanceRequests.isCurrent(request)) return
			setBalanceState('error')
			setBalanceError(error instanceof Error ? error.message : 'Balance refresh failed')
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
		try {
			const provider = getInjectedEthereum()
			if (provider === undefined) throw new Error('No injected wallet was found')
			setWalletProvider(provider)
			if (configuration === undefined) throw new Error('Deployment configuration is unavailable')
			let chainId = await walletChainId(provider)
			if (chainId !== configuration.chainId) {
				await switchWalletChain(provider, configuration.chainId)
				chainId = await walletChainId(provider)
			}
			if (chainId !== configuration.chainId) throw new Error(`Wallet must use ${configuration.chainName}`)
			const connected = await connectWallet(provider)
			balanceRequests.invalidate()
			simulationRequests.invalidate()
			setBalances(undefined)
			setBalanceState('loading')
			setBalanceError(undefined)
			setWalletContextInvalidated(false)
			setAccount(connected)
			setWalletClient(createTradingWalletClient(provider, connected))
			setWalletProvider(provider)
			setMessage(undefined)
			await refresh(configuration)
		} catch (error) {
			setMessage(error instanceof Error ? error.message : 'Wallet connection failed')
		}
	}

	async function refreshBalancesAfterApproval(label: string, expectedMarket: LiveMarket, expectedAccount: Address, request = balanceRequests.begin()): Promise<'ready' | 'refresh-error' | 'context-changed'> {
		if (configuration === undefined || accountRef.current !== expectedAccount || !balanceRequests.isCurrent(request)) return 'context-changed'
		setBalances(undefined)
		setBalanceState('loading')
		setBalanceError(undefined)
		try {
			const loaded = await loadLiveBalances(configuredClient(configuration), expectedMarket, expectedAccount, configuration.router)
			if (accountRef.current !== expectedAccount || !balanceRequests.isCurrent(request)) return 'context-changed'
			setBalances(loaded)
			setBalanceState('ready')
			setBalanceError(undefined)
			return 'ready'
		} catch (error) {
			if (accountRef.current !== expectedAccount || !balanceRequests.isCurrent(request)) return 'context-changed'
			const detail = error instanceof Error ? error.message : 'Balance refresh failed'
			setBalanceState('error')
			setBalanceError(`${label} confirmed, but balances could not be refreshed: ${detail}`)
			return 'refresh-error'
		}
	}

	async function simulate() {
		if (configuration === undefined || selected === undefined || account === undefined || walletClient === undefined || parsedAmount.value === undefined || parsedAmount.value === 0n) return
		const request = simulationRequests.begin()
		try {
			setState('simulating')
			setMessage(undefined)
			const context = { account, configuration, walletClient }
			const nextQuote: Quote = mode === 'entry' ? { ...context, kind: 'entry', value: await simulateEntry(walletClient, configuration, selected, account, side, parsedAmount.value) } : { ...context, kind: 'exit', value: await simulateExit(walletClient, configuration, selected, account, side, parsedAmount.value) }
			if (!simulationRequests.isCurrent(request)) return
			setQuote(nextQuote)
			setState('ready')
		} catch (error) {
			if (!simulationRequests.isCurrent(request)) return
			setQuote(undefined)
			setState('error')
			setMessage(error instanceof Error ? error.message : 'Router simulation failed')
		}
	}

	async function approve() {
		if (configuration === undefined || selected === undefined || account === undefined || walletClient === undefined) return
		if (positionWorkflowLockedRef.current || liquidityWorkflowLockedRef.current) return
		if (!positionWorkflow.begin()) return
		updatePositionWorkflowLock(true)
		setState('approval')
		setMessage(undefined)
		setPositionReceiptWarning(undefined)
		const balanceRequest = balanceRequests.begin()
		let broadcastHash: Hash | undefined
		let receiptKnown = false
		let keepLocked = false
		try {
			const provider = getInjectedEthereum()
			if (provider === undefined || (await walletChainId(provider)) !== configuration.chainId) throw new Error('Wallet network changed; switch back before approving')
			if ((await connectWallet(provider)) !== account) throw new Error('Wallet account changed; reconnect before approving')
			broadcastHash = await approveRouter(walletClient, selected, configuration, account)
			const receipt = await walletClient.waitForTransactionReceipt({ hash: broadcastHash })
			receiptKnown = true
			if (!balanceRequests.isCurrent(balanceRequest)) {
				setState('error')
				if (receipt.status === 'reverted') setMessage(current => `${current ?? 'Wallet context changed.'} Approval transaction reverted.`)
				return
			}
			if (receipt.status === 'reverted') throw new Error('Approval transaction reverted')
			const refreshResult = await refreshBalancesAfterApproval('Share-token approval', selected, account, balanceRequest)
			if (refreshResult !== 'ready') {
				setState('error')
				return
			}
			setPositionReceiptWarning(undefined)
			setMessage(undefined)
			setState('idle')
		} catch (error) {
			if (!balanceRequests.isCurrent(balanceRequest)) {
				if (broadcastHash !== undefined && !receiptKnown) {
					keepLocked = true
					setState('pending')
					setPositionReceiptWarning(broadcastUncertainMessage('Share-token approval', broadcastHash))
				} else setState('error')
				return
			}
			const failure = approvalFailureTransition('Share-token approval', broadcastHash, receiptKnown, error, 'Approval failed')
			keepLocked = failure.keepLocked
			setState(failure.state)
			setMessage(failure.message)
			setPositionReceiptWarning(failure.warning)
		} finally {
			positionWorkflow.finish()
			if (!keepLocked) {
				updatePositionWorkflowLock(false)
			}
		}
	}

	async function submit() {
		if (configuration === undefined || account === undefined || walletClient === undefined || quote === undefined) return
		if (positionWorkflowLockedRef.current || liquidityWorkflowLockedRef.current) return
		if (!positionWorkflow.begin()) return
		updatePositionWorkflowLock(true)
		setState('pending')
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
			)
				throw new Error('Trade inputs changed; simulate the current selection again')
			simulationRequests.invalidate()
			const provider = getInjectedEthereum()
			if (provider === undefined || (await walletChainId(provider)) !== configuration.chainId) throw new Error('Wallet network changed; switch back before submitting')
			const currentAccount = await connectWallet(provider)
			if (currentAccount !== account) throw new Error('Wallet account changed; reconnect and simulate again')
			broadcastHash = quote.kind === 'entry' ? await submitFreshEntry(walletClient, configuration, account, quote.value) : await submitFreshExit(walletClient, configuration, account, quote.value)
			const receipt = await walletClient.waitForTransactionReceipt({ hash: broadcastHash })
			receiptKnown = true
			if (receipt.status === 'reverted') throw new Error('Transaction reverted')
			setQuote(undefined)
			setPositionReceiptWarning(undefined)
			await refresh(configuration, marketPage.start, 'position')
			setState('confirmed')
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
			if (!keepLocked) {
				updatePositionWorkflowLock(false)
			}
		}
	}

	if (configuration === undefined)
		return (
			<main class='route' id='main-content'>
				<header class='route-header'>
					<div>
						<span class='eyebrow'>Standalone live client</span>
						<h1>Deployment configuration required</h1>
						<p>{message ?? 'Loading deployment.json…'}</p>
					</div>
				</header>
			</main>
		)
	let discoveryContent
	if (discoveryState === 'loading' && markets.length === 0) discoveryContent = <p role='status'>Discovering SecurityPools from the configured factory…</p>
	else if (discoveryState === 'error' && markets.length === 0)
		discoveryContent = (
			<div>
				<p class='error' role='alert'>
					SecurityPool discovery failed: {discoveryError}
				</p>
				<button class='secondary-action' disabled={workflowLocked} onClick={refreshFromControl}>
					Retry discovery
				</button>
			</div>
		)
	else if (markets.length === 0) discoveryContent = <p>No SecurityPools are deployed on this configured chain.</p>
	else {
		const marketButtons = markets.map(market => (
			<button
				key={market.pool}
				class='live-market-button'
				aria-pressed={selected?.pool === market.pool}
				disabled={workflowLocked}
				onClick={() => {
					if (positionWorkflowLockedRef.current || liquidityWorkflowLockedRef.current) return
					balanceRequests.invalidate()
					simulationRequests.invalidate()
					setBalances(undefined)
					setBalanceState(account === undefined ? 'disconnected' : 'loading')
					setBalanceError(undefined)
					setSelectedPool(market.pool)
					setQuote(undefined)
					setState('idle')
					focusSection(marketDetailRef)
				}}
			>
				<strong>{market.title}</strong>
				<span>
					{statusLabel(market, nowSeconds)} · universe {market.universeId.toString()}
				</span>
				<code>{shortAddress(market.pool)}</code>
			</button>
		))
		discoveryContent =
			discoveryState === 'error' ? (
				<div>
					<p class='error' role='alert'>
						SecurityPool refresh failed; showing the last successful result: {discoveryError}
					</p>
					<button class='secondary-action' disabled={workflowLocked} onClick={refreshFromControl}>
						Retry discovery
					</button>
					{marketButtons}
				</div>
			) : (
				marketButtons
			)
	}
	if (route === 'portfolio')
		return (
			<main class='route' id='main-content'>
				<header class='route-header'>
					<div>
						<span class='eyebrow'>Positions by SecurityPool</span>
						<h1>Portfolio</h1>
						<p>{configuration.chainName}</p>
					</div>
					<button class='wallet-button' disabled={workflowLocked} onClick={connect}>
						{account === undefined ? 'Connect wallet' : shortAddress(account)}
					</button>
				</header>
				{message === undefined ? null : (
					<p class='error' role='alert'>
						{message}
					</p>
				)}
				<section class='section' aria-busy={discoveryState === 'loading'}>
					<div class='section-heading'>
						<h2>Positions</h2>
						<button class='secondary-action' disabled={discoveryState === 'loading' || workflowLocked} onClick={refreshFromControl}>
							Refresh
						</button>
					</div>
					{discoveryState === 'loading' && markets.length === 0 ? <p role='status'>Discovering SecurityPools…</p> : null}
					{discoveryState === 'error' ? (
						<p class='error' role='alert'>
							SecurityPool discovery failed: {discoveryError}
						</p>
					) : null}
					{discoveryState === 'ready' && markets.length === 0 ? <p>No SecurityPools are deployed on this configured chain.</p> : null}
					{discoveryState === 'error' ? null : <LivePortfolio entries={portfolioEntries} balanceState={portfolioBalanceState} balanceError={portfolioBalanceError} retryBalances={retryPortfolioBalances} />}
				</section>
			</main>
		)
	return (
		<main class='route' id='main-content'>
			<header class='route-header'>
				<div>
					<h1>Two-way markets</h1>
					<p>{configuration.chainName} · conditional prices only</p>
				</div>
				<button class='wallet-button' disabled={workflowLocked} onClick={connect}>
					{account === undefined ? 'Connect wallet' : shortAddress(account)}
				</button>
			</header>
			{message === undefined && parsedAmount.error === undefined ? null : (
				<p class='error' role='alert'>
					{message ?? parsedAmount.error}
				</p>
			)}
			<div class={selected === undefined ? 'two-column two-column--single' : 'two-column'}>
				<section class='section live-focus-target' id='security-pool-list' ref={marketListRef} tabIndex={-1} aria-busy={discoveryState === 'loading'}>
					<div class='section-heading'>
						<div>
							<span class='section-kicker'>Factory discovery</span>
							<h2>SecurityPools</h2>
						</div>
						<button class='secondary-action' disabled={discoveryState === 'loading' || workflowLocked} onClick={refreshFromControl}>
							Refresh
						</button>
					</div>
					{discoveryContent}
					{marketPage.total === 0n ? null : (
						<nav class='market-pagination' aria-label='SecurityPool pages'>
							<button class='secondary-action' disabled={marketPage.previousStart === undefined || discoveryState === 'loading' || workflowLocked} onClick={() => loadMarketPage(marketPage.previousStart)}>
								Previous pools
							</button>
							<span>
								{(marketPage.start + 1n).toString()}–{(marketPage.start + BigInt(markets.length)).toString()} of {marketPage.total.toString()}
							</span>
							<button class='secondary-action' disabled={marketPage.nextStart === undefined || discoveryState === 'loading' || workflowLocked} onClick={() => loadMarketPage(marketPage.nextStart)}>
								Next pools
							</button>
						</nav>
					)}
				</section>
				{(() => {
					if (selected === undefined) return null
					if (selected.loadError !== undefined)
						return (
							<section class='section live-focus-target' key={selected.pool} ref={marketDetailRef} tabIndex={-1}>
								<button class='secondary-action mobile-return' onClick={() => focusSection(marketListRef)}>
									Back to SecurityPools
								</button>
								<div class='section-heading'>
									<div>
										<span class='section-kicker'>Exact pool and branch</span>
										<h2>{selected.title}</h2>
									</div>
									<Status tone='warn'>Market data unavailable</Status>
								</div>
								<p class='error' role='alert'>
									This SecurityPool could not be loaded. No trading, liquidity, or settlement action is available until its authoritative reads succeed: {selected.loadError}
								</p>
								<dl class='fact-list'>
									<MarketShareIdentityRows market={selected} />
								</dl>
							</section>
						)
					return (
						<section class='section live-focus-target' key={selected.pool} ref={marketDetailRef} tabIndex={-1}>
							<button class='secondary-action mobile-return' onClick={() => focusSection(marketListRef)}>
								Back to SecurityPools
							</button>
							<div class='section-heading'>
								<div>
									<span class='section-kicker'>Exact pool and branch</span>
									<h2>{selected.title}</h2>
								</div>
								<Status tone={marketAcceptsNewRisk(selected, nowSeconds) ? 'good' : 'warn'}>{statusLabel(selected, nowSeconds)}</Status>
							</div>
							{route !== 'liquidity' && route !== 'portfolio' && !selectedPairInitialized ? <PairInitializationAction market={selected} /> : null}
							<dl class='fact-list'>
								<div>
									<dt>SecurityPool</dt>
									<dd>
										<AddressValue value={selected.pool} />
									</dd>
								</div>
								<div>
									<dt>Pair</dt>
									<dd>{selected.pair === undefined ? 'Not created' : <AddressValue value={selected.pair} />}</dd>
								</div>
								<div>
									<dt>Universe / question</dt>
									<dd>
										{selected.universeId.toString()} / {selected.questionId.toString()}
									</dd>
								</div>
								<div>
									<dt>Question end</dt>
									<dd>{formatTimestamp(selected.endTime)}</dd>
								</div>
								<div>
									<dt>System state</dt>
									<dd>{systemStateLabel(selected.systemState)}</dd>
								</div>
								<div>
									<dt>Fork continuation</dt>
									<dd>{selected.awaitingForkContinuation ? 'Awaiting' : 'Not awaiting'}</dd>
								</div>
								<div>
									<dt>Universe fork</dt>
									<dd>{selected.universeForkTime === 0n ? 'Not forked' : `Forked ${formatTimestamp(selected.universeForkTime)}`}</dd>
								</div>
								<div>
									<dt>Question outcome</dt>
									<dd>{questionOutcomeLabel(selected.questionOutcome)}</dd>
								</div>
								<div>
									<dt>Security multiplier</dt>
									<dd>{formatBpsMultiplier(selected.statoblastSecurityMultiplierBps)}</dd>
								</div>
								<div>
									<dt>Initial report priority fee</dt>
									<dd>{formatUnits(selected.initialReportPriorityFeeAttoEthPerGas, 9)} nETH / gas</dd>
								</div>
								<div>
									<dt>Active vaults</dt>
									<dd>{selected.activeVaultCount.toString()}</dd>
								</div>
								<div>
									<dt>Per-second retention multiplier</dt>
									<dd>{formatUnits(selected.currentRetentionRate, 18, 12)}×</dd>
								</div>
								<div>
									<dt>Total / fee-eligible capacity ownership</dt>
									<dd>{formatCapacityOwnership(selected.totalCapacityOwnershipAttoRep, selected.feeEligibleCapacityOwnershipAttoRep)}</dd>
								</div>
								<div>
									<dt>Complete-set minting capacity ceiling</dt>
									<dd>{formatUnits(selected.mintingCapacityCeilingAttoEth)} ETH</dd>
								</div>
								<div>
									<dt>Available complete-set minting capacity</dt>
									<dd>{formatUnits(selected.availableMintingCapacityAttoEth)} ETH</dd>
								</div>
								<div>
									<dt>Checkpointed collateral / share ratio</dt>
									<dd>{selected.shareTokenSupplyAttoShares === 0n ? 'No complete sets yet' : formatEthPerShare(selected.settlementCollateralAttoEth, selected.shareTokenSupplyAttoShares)}</dd>
								</div>
								<div>
									<dt>AMM fee</dt>
									<dd>{formatUnits(selected.feeBps, 2, 2)}%</dd>
								</div>
							</dl>
							{route === 'liquidity' || marketAcceptsNewRisk(selected, nowSeconds) ? null : (
								<LiveSettlementControls
									configuration={configuration}
									market={selected}
									balances={selectedBalances}
									balanceState={selectedBalanceState}
									balanceError={balanceError}
									account={account}
									walletClient={walletClient}
									externallyLocked={workflowLocked}
									refresh={() => refresh(configuration, marketPage.start, 'liquidity')}
									refreshBalancesAfterApproval={refreshBalancesAfterApproval}
									walletContextIsCurrent={expectedAccount => accountRef.current === expectedAccount}
									retryBalances={retryBalances}
									onWorkflowLockChange={updateLiquidityWorkflowLock}
								/>
							)}
							{route === 'liquidity' ? (
								<LiveLiquidityControls
									configuration={configuration}
									market={selected}
									balances={selectedBalances}
									balanceState={selectedBalanceState}
									balanceError={balanceError}
									account={account}
									walletClient={walletClient}
									externallyLocked={workflowLocked}
									nowSeconds={nowSeconds}
									refresh={() => refresh(configuration, marketPage.start, 'liquidity')}
									refreshBalancesAfterApproval={refreshBalancesAfterApproval}
									walletContextIsCurrent={expectedAccount => accountRef.current === expectedAccount}
									retryBalances={retryBalances}
									onWorkflowLockChange={updateLiquidityWorkflowLock}
								/>
							) : null}
							{route !== 'liquidity' && route !== 'portfolio' && selectedPairInitialized ? (
								<LivePositionControls
									market={selected}
									balances={selectedBalances}
									balanceState={selectedBalanceState}
									balanceError={balanceError}
									mode={mode}
									side={side}
									amount={amount}
									quote={quote}
									state={state}
									receiptWarning={positionReceiptWarning}
									externallyLocked={workflowLocked}
									nowSeconds={nowSeconds}
									setMode={value => {
										if (positionWorkflowLockedRef.current) return
										simulationRequests.invalidate()
										setMode(value)
										setQuote(undefined)
										setState('idle')
									}}
									setSide={value => {
										if (positionWorkflowLockedRef.current) return
										simulationRequests.invalidate()
										setSide(value)
										setQuote(undefined)
										setState('idle')
									}}
									setAmount={value => {
										if (positionWorkflowLockedRef.current) return
										simulationRequests.invalidate()
										setAmount(value)
										setQuote(undefined)
										setState('idle')
									}}
									simulate={simulate}
									approve={approve}
									submit={submit}
									retryBalances={retryBalances}
								/>
							) : null}
						</section>
					)
				})()}
			</div>
		</main>
	)
}

type LiquidityQuote = Awaited<ReturnType<typeof simulateLiquidity>> & QuoteContext

export function liquidityApprovalRequired(balanceState: BalanceState, operation: LiquidityOperation, amount: bigint | undefined, allowance: bigint | undefined) {
	return balanceState === 'ready' && operation === 'remove' && amount !== undefined && amount > 0n && allowance !== undefined && allowance < amount
}

export function liquidityOperationAvailable(operation: LiquidityOperation, market: MarketLifecycle, nowSeconds: bigint) {
	return operation === 'remove' || marketAcceptsNewRisk(market, nowSeconds)
}

function LiveLiquidityControls({
	configuration,
	market,
	balances,
	balanceState,
	balanceError,
	account,
	walletClient,
	externallyLocked,
	nowSeconds,
	refresh,
	refreshBalancesAfterApproval,
	walletContextIsCurrent,
	retryBalances,
	onWorkflowLockChange,
}: {
	configuration: DeploymentConfiguration
	market: LiveMarket
	balances: LiveBalances | undefined
	balanceState: BalanceState
	balanceError: string | undefined
	account: Address | undefined
	walletClient: WalletClient | undefined
	externallyLocked: boolean
	nowSeconds: bigint
	refresh(): Promise<void>
	refreshBalancesAfterApproval(label: string, market: LiveMarket, account: Address): Promise<'ready' | 'refresh-error' | 'context-changed'>
	walletContextIsCurrent(account: Address): boolean
	retryBalances(): Promise<void>
	onWorkflowLockChange(locked: boolean): void
}) {
	const defaultOperation: LiquidityOperation = market.pair === undefined || market.lpTotalSupply === 0n ? 'initialize' : 'add'
	const [operation, setOperation] = useState<LiquidityOperation>(defaultOperation)
	const [amount, setAmount] = useState('0.01')
	const [probability, setProbability] = useState('50')
	const [quote, setQuote] = useState<LiquidityQuote>()
	const [state, setState] = useState<TransactionState>('idle')
	const [error, setError] = useState<string>()
	const [receiptWarning, setReceiptWarning] = useState<string>()
	const simulationRequests = useRef(createLatestRequestGuard()).current
	const workflow = useRef(createExclusiveWorkflowGuard()).current
	const parsed = useMemo(() => parseUnitsOrUndefined(amount), [amount])
	const conditionalBps = useMemo(() => {
		const value = parseUnitsOrUndefined(probability, 2)
		return value !== undefined && value > 0n && value < 10_000n ? value : undefined
	}, [probability])
	const closedForAdding = !marketAcceptsNewRisk(market, nowSeconds)
	const operationAvailable = liquidityOperationAvailable(operation, market, nowSeconds)
	const needsLpApproval = market.lpTotalSupply > 0n && liquidityApprovalRequired(balanceState, operation, parsed, balances?.lpAllowance)
	const workflowLocked = externallyLocked || state === 'approval' || state === 'pending' || receiptWarning !== undefined

	useEffect(() => {
		if (receiptWarning !== undefined) return
		simulationRequests.invalidate()
		setQuote(undefined)
		if (!workflow.isActive()) setState('idle')
		return () => simulationRequests.invalidate()
	}, [account, configuration, market, receiptWarning, walletClient])

	useEffect(() => {
		if (balanceState === 'ready' || receiptWarning !== undefined) return
		simulationRequests.invalidate()
		setQuote(undefined)
		if (!workflow.isActive()) setState('idle')
	}, [balanceState, receiptWarning])

	useEffect(() => {
		if (operationAvailable || receiptWarning !== undefined) return
		simulationRequests.invalidate()
		setQuote(undefined)
		if (!workflow.isActive()) {
			setState('idle')
			setError(undefined)
		}
	}, [operationAvailable, receiptWarning])

	useEffect(
		() => () => {
			if (workflow.isActive()) workflow.finish()
			onWorkflowLockChange(false)
		},
		[onWorkflowLockChange],
	)

	async function simulateCurrent() {
		if (!operationAvailable || walletClient === undefined || account === undefined || parsed === undefined || parsed === 0n || (operation === 'initialize' && conditionalBps === undefined)) return
		const request = simulationRequests.begin()
		try {
			setState('simulating')
			setError(undefined)
			const simulated = await simulateLiquidity(walletClient, configuration, market, account, operation, parsed, conditionalBps ?? 5_000n)
			const nextQuote: LiquidityQuote = { ...simulated, account, configuration, walletClient }
			if (!simulationRequests.isCurrent(request)) return
			setQuote(nextQuote)
			setState('ready')
		} catch (caught) {
			if (!simulationRequests.isCurrent(request)) return
			setState('error')
			setError(caught instanceof Error ? caught.message : 'Liquidity simulation failed')
		}
	}

	async function approveLp() {
		if (walletClient === undefined || account === undefined || parsed === undefined) return
		if (externallyLocked) return
		if (!workflow.begin()) return
		onWorkflowLockChange(true)
		setState('approval')
		setError(undefined)
		setReceiptWarning(undefined)
		let broadcastHash: Hash | undefined
		let receiptKnown = false
		let keepLocked = false
		try {
			const provider = getInjectedEthereum()
			if (provider === undefined || (await walletChainId(provider)) !== configuration.chainId) throw new Error('Wallet network changed; switch back before approving')
			if ((await connectWallet(provider)) !== account) throw new Error('Wallet account changed; reconnect before approving')
			broadcastHash = await approveLpRouter(walletClient, configuration, market, account, parsed)
			const receipt = await walletClient.waitForTransactionReceipt({ hash: broadcastHash })
			receiptKnown = true
			if (!walletContextIsCurrent(account)) {
				setState('error')
				setError(receipt.status === 'reverted' ? 'Wallet context changed while the LP-token approval was pending. Approval transaction reverted.' : 'Wallet context changed while the LP-token approval was pending. Reconnect to refresh balances and approvals.')
				return
			}
			if (receipt.status === 'reverted') throw new Error('Approval transaction reverted')
			const refreshResult = await refreshBalancesAfterApproval('LP-token approval', market, account)
			if (refreshResult !== 'ready') {
				setState('error')
				if (refreshResult === 'context-changed') setError('Wallet context changed while approved balances were refreshing. Reconnect to continue.')
				return
			}
			setReceiptWarning(undefined)
			setError(undefined)
			setState('idle')
		} catch (caught) {
			if (!walletContextIsCurrent(account)) {
				if (broadcastHash !== undefined && !receiptKnown) {
					keepLocked = true
					setState('pending')
					setError(undefined)
					setReceiptWarning(broadcastUncertainMessage('LP-token approval', broadcastHash))
				} else {
					setState('error')
					setError('Wallet context changed while the LP-token approval was pending. Reconnect to continue.')
				}
				return
			}
			const failure = approvalFailureTransition('LP-token approval', broadcastHash, receiptKnown, caught, 'LP approval failed')
			keepLocked = failure.keepLocked
			setState(failure.state)
			setError(failure.message)
			setReceiptWarning(failure.warning)
		} finally {
			workflow.finish()
			if (!keepLocked) onWorkflowLockChange(false)
		}
	}

	async function submit() {
		if (walletClient === undefined || account === undefined || quote === undefined) return
		if (externallyLocked) return
		if (!liquidityOperationAvailable(quote.operation, quote.market, nowSeconds)) {
			setQuote(undefined)
			setState('error')
			setError('This market no longer accepts liquidity initialization or additions. Raw liquidity removal remains available.')
			return
		}
		if (!workflow.begin()) return
		onWorkflowLockChange(true)
		setState('pending')
		setReceiptWarning(undefined)
		let broadcastHash: Hash | undefined
		let receiptKnown = false
		let keepLocked = false
		try {
			if (
				quote.account !== account ||
				quote.walletClient !== walletClient ||
				quote.configuration.chainId !== configuration.chainId ||
				quote.configuration.router !== configuration.router ||
				quote.market.pool !== market.pool ||
				quote.operation !== operation ||
				quote.amount !== parsed ||
				(operation === 'initialize' && quote.conditionalYesBps !== conditionalBps)
			)
				throw new Error('Liquidity inputs changed; simulate the current selection again')
			simulationRequests.invalidate()
			const provider = getInjectedEthereum()
			if (provider === undefined || (await walletChainId(provider)) !== configuration.chainId) throw new Error('Wallet network changed; switch back before submitting')
			const currentAccount = await connectWallet(provider)
			if (currentAccount !== account) throw new Error('Wallet account changed; reconnect and simulate again')
			broadcastHash = await submitFreshLiquidity(walletClient, configuration, account, quote)
			const receipt = await walletClient.waitForTransactionReceipt({ hash: broadcastHash })
			receiptKnown = true
			if (receipt.status === 'reverted') throw new Error('Liquidity transaction reverted')
			setQuote(undefined)
			setReceiptWarning(undefined)
			await refresh()
			setState('confirmed')
		} catch (caught) {
			if (broadcastHash !== undefined && !receiptKnown) {
				keepLocked = true
				setState('pending')
				setReceiptWarning(broadcastUncertainMessage('Liquidity transaction', broadcastHash))
				setError(undefined)
			} else {
				const failure = failedSubmissionTransition(caught, 'Liquidity transaction failed')
				setQuote(failure.quote)
				setState(failure.state)
				setError(failure.message)
				setReceiptWarning(undefined)
			}
		} finally {
			workflow.finish()
			if (!keepLocked) onWorkflowLockChange(false)
		}
	}

	return (
		<div class='operation-block'>
			<h3>Live liquidity</h3>
			{balanceState === 'disconnected' ? <p>Connect a wallet to load balances and simulate liquidity transactions.</p> : null}
			{balanceState === 'loading' ? <p role='status'>Refreshing wallet balances and LP allowance…</p> : null}
			{balanceState === 'error' ? <BalanceLoadError message={`Wallet balances and LP allowance are unavailable: ${balanceError ?? 'balance refresh failed'}.`} retry={retryBalances} disabled={workflowLocked} /> : null}
			<div class='segmented' aria-label='Liquidity operation'>
				<button
					aria-pressed={operation === 'initialize'}
					disabled={market.lpTotalSupply > 0n || closedForAdding || workflowLocked}
					onClick={() => {
						if (workflow.isActive()) return
						simulationRequests.invalidate()
						setOperation('initialize')
						setQuote(undefined)
						setState('idle')
					}}
				>
					Initialize
				</button>
				<button
					aria-pressed={operation === 'add'}
					disabled={market.lpTotalSupply === 0n || closedForAdding || workflowLocked}
					onClick={() => {
						if (workflow.isActive()) return
						simulationRequests.invalidate()
						setOperation('add')
						setQuote(undefined)
						setState('idle')
					}}
				>
					Add
				</button>
				<button
					aria-pressed={operation === 'remove'}
					disabled={market.lpTotalSupply === 0n || workflowLocked}
					onClick={() => {
						if (workflow.isActive()) return
						simulationRequests.invalidate()
						setOperation('remove')
						setQuote(undefined)
						setState('idle')
					}}
				>
					Remove
				</button>
			</div>
			<label class='field'>
				<span>{operation === 'remove' ? 'LP tokens' : 'ETH amount'}</span>
				<div class='amount-input'>
					<input
						value={amount}
						disabled={workflowLocked}
						inputMode='decimal'
						onInput={event => {
							if (workflow.isActive()) return
							simulationRequests.invalidate()
							setAmount(event.currentTarget.value)
							setQuote(undefined)
							setState('idle')
						}}
					/>
					<span>{operation === 'remove' ? 'LP' : 'ETH'}</span>
				</div>
			</label>
			{operation === 'initialize' ? (
				<label class='field'>
					<span>Conditional YES price</span>
					<div class='amount-input'>
						<input
							value={probability}
							disabled={workflowLocked}
							inputMode='numeric'
							onInput={event => {
								if (workflow.isActive()) return
								simulationRequests.invalidate()
								setProbability(event.currentTarget.value)
								setQuote(undefined)
								setState('idle')
							}}
						/>
						<span>%</span>
					</div>
				</label>
			) : null}
			{operation === 'initialize' && conditionalBps === undefined ? (
				<p class='error' role='alert'>
					Enter a Conditional YES price above 0% and below 100%, with at most two decimal places.
				</p>
			) : null}
			{operation === 'remove' ? <p>Removal returns raw YES and NO. It never consumes wallet INVALID.</p> : <p>All INVALID and unused directional shares return to the wallet; LP tokens do not include wallet INVALID.</p>}
			{quote === undefined ? null : (
				<>
					<p class='quote'>Authoritative router simulation at block {quote.blockNumber.toString()}.</p>
					<dl class='metrics'>
						{quote.operation === 'remove' ? (
							<>
								<div>
									<dt>Raw YES returned</dt>
									<dd>{formatShareAmount(quote.expectedYes)}</dd>
								</div>
								<div>
									<dt>Raw NO returned</dt>
									<dd>{formatShareAmount(quote.expectedNo)}</dd>
								</div>
							</>
						) : (
							<>
								<div>
									<dt>Complete-set shares created</dt>
									<dd>{formatShareAmount(quote.result.completeSetShares)}</dd>
								</div>
								<div>
									<dt>Simulated effective complete-set rate</dt>
									<dd>{formatEthPerShare(quote.amount, quote.result.completeSetShares)}</dd>
								</div>
								<div>
									<dt>YES / NO deposited</dt>
									<dd>
										{formatShareAmount(quote.result.yesUsed)} / {formatShareAmount(quote.result.noUsed)}
									</dd>
								</div>
								<div>
									<dt>Unused YES / NO returned</dt>
									<dd>
										{formatShareAmount(quote.result.yesReturned)} / {formatShareAmount(quote.result.noReturned)}
									</dd>
								</div>
								<div>
									<dt>INVALID retained</dt>
									<dd>{formatShareAmount(quote.result.invalidInsurance)}</dd>
								</div>
								<div>
									<dt>LP tokens expected</dt>
									<dd>{formatUnits(quote.expectedLiquidity)} LP</dd>
								</div>
							</>
						)}
					</dl>
				</>
			)}
			{receiptWarning === undefined ? null : (
				<p class='error broadcast-warning' role='alert'>
					{receiptWarning}
				</p>
			)}
			{error === undefined ? null : (
				<p class='error' role='alert'>
					{error}
				</p>
			)}
			<p role='status' aria-live='polite'>
				{stateLabel(state)}
			</p>
			{needsLpApproval ? (
				<button class='primary-action' disabled={workflowLocked} onClick={approveLp}>
					Approve exact LP amount
				</button>
			) : null}
			{!needsLpApproval && quote === undefined ? (
				<button class='primary-action' disabled={balanceState !== 'ready' || account === undefined || parsed === undefined || (operation === 'initialize' && conditionalBps === undefined) || (operation !== 'remove' && closedForAdding) || state === 'simulating' || workflowLocked} onClick={simulateCurrent}>
					Simulate liquidity transaction
				</button>
			) : null}
			{!needsLpApproval && quote !== undefined ? (
				<button class='primary-action' disabled={workflowLocked || state !== 'ready' || !liquidityOperationAvailable(quote.operation, quote.market, nowSeconds)} onClick={submit}>
					Submit liquidity transaction
				</button>
			) : null}
		</div>
	)
}

function LivePortfolioBalanceMetrics({ market, balances }: { market: LiveMarket; balances: LiveBalances }) {
	const yesClaim = market.lpTotalSupply === 0n ? 0n : (market.yesReserve * balances.lp) / market.lpTotalSupply
	const noClaim = market.lpTotalSupply === 0n ? 0n : (market.noReserve * balances.lp) / market.lpTotalSupply
	let coveredSets = balances.invalid
	if (yesClaim < coveredSets) coveredSets = yesClaim
	if (noClaim < coveredSets) coveredSets = noClaim
	const maximumYesExit = maximumInsuredExit({ longOutcome: 'YES', longBalance: balances.yes, invalidBalance: balances.invalid, yesReserve: market.yesReserve, noReserve: market.noReserve, feeBps: market.feeBps })
	const maximumNoExit = maximumInsuredExit({ longOutcome: 'NO', longBalance: balances.no, invalidBalance: balances.invalid, yesReserve: market.yesReserve, noReserve: market.noReserve, feeBps: market.feeBps })
	return (
		<>
			<dl class='metrics'>
				<div>
					<dt>YES</dt>
					<dd>{formatShareAmount(balances.yes)}</dd>
				</div>
				<div>
					<dt>NO</dt>
					<dd>{formatShareAmount(balances.no)}</dd>
				</div>
				<div>
					<dt>INVALID</dt>
					<dd>{formatShareAmount(balances.invalid)}</dd>
				</div>
				<div>
					<dt>LP tokens</dt>
					<dd>{formatUnits(balances.lp)} LP</dd>
				</div>
				<div>
					<dt>LP YES claim</dt>
					<dd>{formatShareAmount(yesClaim)}</dd>
				</div>
				<div>
					<dt>LP NO claim</dt>
					<dd>{formatShareAmount(noClaim)}</dd>
				</div>
				<div>
					<dt>Claim covered by separate INVALID</dt>
					<dd>{formatShareAmount(coveredSets)}</dd>
				</div>
				<div>
					<dt>Maximum insured YES exit</dt>
					<dd>{formatShareAmount(maximumYesExit)}</dd>
				</div>
				<div>
					<dt>Maximum insured NO exit</dt>
					<dd>{formatShareAmount(maximumNoExit)}</dd>
				</div>
				<div>
					<dt>Share approval</dt>
					<dd>{balances.approved ? 'Router approved' : 'Approval required for exit'}</dd>
				</div>
				<div>
					<dt>LP allowance</dt>
					<dd>{formatUnits(balances.lpAllowance)} LP</dd>
				</div>
			</dl>
			<p>Transferring LP tokens does not transfer INVALID.</p>
		</>
	)
}

function hasPortfolioBalance(balances: LiveBalances) {
	return balances.yes > 0n || balances.no > 0n || balances.invalid > 0n || balances.lp > 0n
}

export function LivePortfolio({ entries, balanceState, balanceError, retryBalances }: { entries: readonly PortfolioBalanceEntry[]; balanceState: BalanceState; balanceError: string | undefined; retryBalances(): Promise<void> }) {
	const visibleEntries = balanceState === 'ready' ? entries.filter(entry => entry.error !== undefined || (entry.balances !== undefined && hasPortfolioBalance(entry.balances))) : entries
	return (
		<div class='portfolio-groups' aria-busy={balanceState === 'loading'}>
			<p>Balances are grouped by the SecurityPool and universe that minted their outcome shares.</p>
			{balanceState === 'disconnected' ? <p>Connect a wallet to load the positions for these SecurityPools.</p> : null}
			{balanceState === 'loading' ? <p role='status'>Loading balances separately for each SecurityPool…</p> : null}
			{balanceState === 'error' ? <BalanceLoadError message={balanceError ?? 'Portfolio balances could not be loaded.'} retry={retryBalances} /> : null}
			{balanceState === 'ready' && visibleEntries.length === 0 ? <p>No YES, NO, INVALID, or LP balance was found in the discovered SecurityPools.</p> : null}
			{visibleEntries.map(entry => (
				<article class='operation-block' data-portfolio-pool={entry.market.pool} key={entry.market.pool}>
					<div class='section-heading'>
						<div>
							<span class='section-kicker'>SecurityPool position</span>
							<h3>{entry.market.title}</h3>
						</div>
						<Status tone={entry.error === undefined ? 'neutral' : 'warn'}>{entry.error === undefined ? `Universe ${entry.market.universeId.toString()}` : 'Balance unavailable'}</Status>
					</div>
					<dl class='metrics'>
						<MarketShareIdentityRows market={entry.market} />
					</dl>
					{entry.error === undefined ? null : <BalanceLoadError message={`This SecurityPool’s balances could not be loaded: ${entry.error}`} retry={retryBalances} />}
					{entry.balances === undefined ? null : <LivePortfolioBalanceMetrics market={entry.market} balances={entry.balances} />}
				</article>
			))}
		</div>
	)
}

type SettlementQuote = Awaited<ReturnType<typeof simulateSettlement>> & Readonly<{ account: Address; walletClient: WalletClient; inputRevision: number }>

export function settlementQuoteMatchesInputs(
	quote: SettlementQuote | undefined,
	inputRevision: number,
	market: LiveMarket,
	operation: SettlementOperation,
	parsedAmount: bigint | undefined,
	sourceOutcome: ShareOutcome,
	parsedTargetOutcome: bigint | undefined,
	account: Address | undefined,
	walletClient: WalletClient | undefined,
) {
	if (quote === undefined || quote.inputRevision !== inputRevision || quote.market.pool !== market.pool || quote.operation !== operation || quote.account !== account || quote.walletClient !== walletClient) return false
	if (quote.operation === 'redeem-complete-set') return quote.amount === parsedAmount
	if (quote.operation === 'migrate-shares') return quote.sourceOutcome === sourceOutcome && quote.targetOutcomeIndex === parsedTargetOutcome
	return true
}

export function settlementQuoteCanSubmit(balanceState: BalanceState, inputBlocker: string | undefined, quoteMatchesInputs: boolean) {
	return balanceState === 'ready' && inputBlocker === undefined && quoteMatchesInputs
}

function LiveSettlementControls({
	configuration,
	market,
	balances,
	balanceState,
	balanceError,
	account,
	walletClient,
	externallyLocked,
	refresh,
	refreshBalancesAfterApproval,
	walletContextIsCurrent,
	retryBalances,
	onWorkflowLockChange,
}: {
	configuration: DeploymentConfiguration
	market: LiveMarket
	balances: LiveBalances | undefined
	balanceState: BalanceState
	balanceError: string | undefined
	account: Address | undefined
	walletClient: WalletClient | undefined
	externallyLocked: boolean
	refresh(): Promise<void>
	refreshBalancesAfterApproval(label: string, market: LiveMarket, account: Address): Promise<'ready' | 'refresh-error' | 'context-changed'>
	walletContextIsCurrent(account: Address): boolean
	retryBalances(): Promise<void>
	onWorkflowLockChange(locked: boolean): void
}) {
	let initialOperation: SettlementOperation = 'redeem-complete-set'
	if (market.universeForkTime !== 0n) initialOperation = 'migrate-shares'
	else if (market.questionOutcome !== 3) initialOperation = 'redeem-winning-shares'
	const [operation, setOperation] = useState<SettlementOperation>(initialOperation)
	const [amount, setAmount] = useState('0.01')
	const [sourceOutcome, setSourceOutcome] = useState<ShareOutcome>('YES')
	const [targetOutcomeIndex, setTargetOutcomeIndex] = useState('')
	const [quote, setQuote] = useState<SettlementQuote>()
	const [state, setState] = useState<TransactionState>('idle')
	const [error, setError] = useState<string>()
	const [receiptWarning, setReceiptWarning] = useState<string>()
	const workflow = useRef(createExclusiveWorkflowGuard()).current
	const simulationRequests = useRef(createLatestRequestGuard()).current
	const inputRevision = useRef(0)
	const availability = settlementAvailability(market, balances)
	const parsedAmount = parseUnitsOrUndefined(amount)
	const parsedTargetOutcome = useMemo(() => {
		return parseForkOutcomeIndex(targetOutcomeIndex)
	}, [targetOutcomeIndex])
	let operationAvailable = availability.canMigrateShares
	if (operation === 'redeem-complete-set') operationAvailable = availability.canRedeemCompleteSets
	else if (operation === 'redeem-winning-shares') operationAvailable = availability.canRedeemWinningShares
	let sourceBalance = balances?.no
	if (sourceOutcome === 'INVALID') sourceBalance = balances?.invalid
	else if (sourceOutcome === 'YES') sourceBalance = balances?.yes
	const workflowLocked = externallyLocked || state === 'approval' || state === 'pending' || receiptWarning !== undefined
	const inputBlocker = settlementInputBlocker(operation, operationAvailable, availability.completeSets, parsedAmount, parsedTargetOutcome, sourceOutcome, sourceBalance)
	const approvalRequired = operation === 'redeem-complete-set' && balances?.approved === false
	const quoteMatchesInputs = settlementQuoteMatchesInputs(quote, inputRevision.current, market, operation, parsedAmount, sourceOutcome, parsedTargetOutcome, account, walletClient)
	const actionableQuote = !approvalRequired && settlementQuoteCanSubmit(balanceState, inputBlocker, quoteMatchesInputs) ? quote : undefined
	const submitContext = useRef({ balanceState, inputBlocker, actionableQuote })
	submitContext.current = { balanceState, inputBlocker, actionableQuote }
	let settlementStatus = 'Connect a wallet to load balances for settlement'
	if (balanceState === 'loading') settlementStatus = 'Loading wallet balances for settlement…'
	else if (balanceState === 'ready') {
		if (state === 'confirmed') settlementStatus = 'Settlement transaction confirmed on-chain'
		else if (account === undefined || walletClient === undefined) settlementStatus = 'Connect a wallet to load balances for settlement'
		else if (state === 'approval') settlementStatus = 'Share-token approval pending…'
		else if (state === 'pending') settlementStatus = error ?? 'Settlement transaction pending…'
		else if (state === 'error') settlementStatus = error ?? 'Settlement workflow needs attention'
		else if (approvalRequired) settlementStatus = 'Approve the router to pull the explicit complete set before simulation'
		else if (inputBlocker !== undefined) settlementStatus = inputBlocker
		else if (state === 'simulating') settlementStatus = 'Simulating the authoritative settlement call…'
		else if (state === 'ready' && actionableQuote !== undefined) {
			if (actionableQuote.operation === 'migrate-shares') settlementStatus = migrationSimulationSummary(actionableQuote.blockNumber, actionableQuote.sourceOutcome, actionableQuote.targetOutcomeIndex)
			else if (actionableQuote.operation === 'redeem-complete-set') settlementStatus = `Authoritative redemption simulation at block ${actionableQuote.blockNumber.toString()}: ${formatUnits(actionableQuote.expectedAttoEth)} ETH expected, ${formatUnits(actionableQuote.minimumAttoEth)} ETH minimum`
			else settlementStatus = `Authoritative settlement simulation ready at block ${actionableQuote.blockNumber.toString()}`
		} else settlementStatus = 'Ready to simulate an authoritative protocol action'
	}

	function invalidateSettlementInputs() {
		if (receiptWarning !== undefined) return
		inputRevision.current++
		simulationRequests.invalidate()
		setQuote(undefined)
		setError(undefined)
		if (!workflow.isActive()) setState('idle')
	}

	useEffect(() => {
		if (receiptWarning !== undefined) return
		simulationRequests.invalidate()
		setQuote(undefined)
		if (!workflow.isActive()) setState('idle')
	}, [account, amount, market.pool, market.systemState, market.awaitingForkContinuation, market.universeForkTime, market.questionOutcome, operation, receiptWarning, sourceOutcome, targetOutcomeIndex, walletClient])

	useEffect(() => {
		if (receiptWarning !== undefined) return
		simulationRequests.invalidate()
		setQuote(undefined)
		if (!workflow.isActive()) setState(current => (current === 'confirmed' ? current : 'idle'))
	}, [balances, balanceState, receiptWarning])

	useEffect(
		() => () => {
			simulationRequests.invalidate()
			if (workflow.isActive()) workflow.finish()
			onWorkflowLockChange(false)
		},
		[onWorkflowLockChange],
	)

	async function simulateCurrent() {
		if (walletClient === undefined || account === undefined || inputBlocker !== undefined) return
		const request = simulationRequests.begin()
		const revision = inputRevision.current
		setState('simulating')
		setError(undefined)
		try {
			let parameters: Readonly<{ amount?: bigint; sourceOutcome?: ShareOutcome; targetOutcomeIndex?: bigint }> = {}
			if (operation === 'redeem-complete-set' && parsedAmount !== undefined) parameters = { amount: parsedAmount }
			else if (operation === 'migrate-shares' && parsedTargetOutcome !== undefined) parameters = { sourceOutcome, targetOutcomeIndex: parsedTargetOutcome }
			const simulation = await simulateSettlement(walletClient, configuration, market, account, operation, parameters)
			if (!simulationRequests.isCurrent(request) || inputRevision.current !== revision) return
			setQuote({ ...simulation, account, walletClient, inputRevision: revision })
			setState('ready')
		} catch (caught) {
			if (!simulationRequests.isCurrent(request)) return
			setState('error')
			setError(caught instanceof Error ? caught.message : 'Settlement simulation failed')
		}
	}

	async function submitCurrent() {
		const selectedQuote = actionableQuote
		if (walletClient === undefined || account === undefined || selectedQuote === undefined) return
		if (externallyLocked) return
		if (!workflow.begin()) return
		onWorkflowLockChange(true)
		setState('pending')
		setError(undefined)
		setReceiptWarning(undefined)
		let broadcastHash: Hash | undefined
		let receiptKnown = false
		let keepLocked = false
		try {
			const provider = getInjectedEthereum()
			if (provider === undefined || (await walletChainId(provider)) !== configuration.chainId) throw new Error('Wallet network changed; reconnect and simulate again')
			if ((await connectWallet(provider)) !== account) throw new Error('Wallet account changed; reconnect and simulate again')
			const current = submitContext.current
			if (current.balanceState !== 'ready' || current.inputBlocker !== undefined || current.actionableQuote !== selectedQuote) throw new Error('Settlement inputs or balances changed; simulate again')
			broadcastHash = await submitFreshSettlement(walletClient, configuration, account, selectedQuote)
			const receipt = await walletClient.waitForTransactionReceipt({ hash: broadcastHash })
			receiptKnown = true
			if (receipt.status === 'reverted') throw new Error('Settlement transaction reverted')
			setQuote(undefined)
			setReceiptWarning(undefined)
			await refresh()
			setState('confirmed')
		} catch (caught) {
			if (broadcastHash !== undefined && !receiptKnown) {
				keepLocked = true
				setState('pending')
				setError(undefined)
				setReceiptWarning(broadcastUncertainMessage('Settlement transaction', broadcastHash))
			} else {
				const failure = failedSubmissionTransition(caught, 'Settlement transaction failed')
				setQuote(failure.quote)
				setState(failure.state)
				setError(failure.message)
				setReceiptWarning(undefined)
			}
		} finally {
			workflow.finish()
			if (!keepLocked) onWorkflowLockChange(false)
		}
	}

	async function approveCompleteSetRouter() {
		if (walletClient === undefined || account === undefined || !approvalRequired || externallyLocked) return
		if (!workflow.begin()) return
		onWorkflowLockChange(true)
		setState('approval')
		setError(undefined)
		setReceiptWarning(undefined)
		let broadcastHash: Hash | undefined
		let receiptKnown = false
		let keepLocked = false
		try {
			const provider = getInjectedEthereum()
			if (provider === undefined || (await walletChainId(provider)) !== configuration.chainId) throw new Error('Wallet network changed; reconnect before approving')
			if ((await connectWallet(provider)) !== account) throw new Error('Wallet account changed; reconnect before approving')
			broadcastHash = await approveRouter(walletClient, market, configuration, account)
			const receipt = await walletClient.waitForTransactionReceipt({ hash: broadcastHash })
			receiptKnown = true
			if (!walletContextIsCurrent(account)) {
				setState('error')
				setError(receipt.status === 'reverted' ? 'Wallet context changed while the share-token approval was pending. Approval transaction reverted.' : 'Wallet context changed while the share-token approval was pending. Reconnect to refresh balances and approvals.')
				return
			}
			if (receipt.status === 'reverted') throw new Error('Approval transaction reverted')
			const refreshResult = await refreshBalancesAfterApproval('Share-token approval', market, account)
			if (refreshResult !== 'ready') {
				setState('error')
				if (refreshResult === 'context-changed') setError('Wallet context changed while approved balances were refreshing. Reconnect to continue.')
				return
			}
			setState('idle')
		} catch (caught) {
			if (!walletContextIsCurrent(account)) {
				if (broadcastHash !== undefined && !receiptKnown) {
					keepLocked = true
					setState('pending')
					setError(undefined)
					setReceiptWarning(broadcastUncertainMessage('Share-token approval', broadcastHash))
				} else {
					setState('error')
					setError('Wallet context changed while the share-token approval was pending. Reconnect to continue.')
				}
				return
			}
			const failure = approvalFailureTransition('Share-token approval', broadcastHash, receiptKnown, caught, 'Approval failed')
			keepLocked = failure.keepLocked
			setState(failure.state)
			setError(failure.message)
			setReceiptWarning(failure.warning)
		} finally {
			workflow.finish()
			if (!keepLocked) onWorkflowLockChange(false)
		}
	}

	return (
		<div class='operation-block'>
			<div class='section-heading'>
				<div>
					<span class='section-kicker'>Authoritative protocol actions</span>
					<h3>Settlement and fork migration</h3>
				</div>
			</div>
			<div class='segmented' aria-label='Settlement operation'>
				<button
					aria-pressed={operation === 'redeem-complete-set'}
					disabled={workflowLocked}
					onClick={() => {
						invalidateSettlementInputs()
						setOperation('redeem-complete-set')
					}}
				>
					Complete set
				</button>
				<button
					aria-pressed={operation === 'redeem-winning-shares'}
					disabled={workflowLocked}
					onClick={() => {
						invalidateSettlementInputs()
						setOperation('redeem-winning-shares')
					}}
				>
					Winning shares
				</button>
				<button
					aria-pressed={operation === 'migrate-shares'}
					disabled={workflowLocked}
					onClick={() => {
						invalidateSettlementInputs()
						setOperation('migrate-shares')
					}}
				>
					Fork migration
				</button>
			</div>
			{(() => {
				if (operation === 'redeem-complete-set')
					return (
						<>
							<p>Burn equal wallet INVALID, YES, and NO shares for ETH at the SecurityPool’s current collateral rate. Available complete sets: {settlementBalanceLabel(balanceState, availability.completeSets)}.</p>
							<label class='field'>
								<span>Complete-set shares to redeem</span>
								<div class='amount-input'>
									<input
										value={amount}
										disabled={workflowLocked}
										inputMode='decimal'
										onInput={event => {
											invalidateSettlementInputs()
											setAmount(event.currentTarget.value)
										}}
									/>
									<span>shares</span>
								</div>
							</label>
						</>
					)
				if (operation === 'redeem-winning-shares')
					return (
						<p>
							Redeem the wallet’s entire {questionOutcomeLabel(market.questionOutcome)} winning-share balance ({settlementBalanceLabel(balanceState, availability.winningBalance)}) through this exact SecurityPool.
						</p>
					)
				return (
					<>
						<p>Migration copies the entire selected source-share balance into the explicitly selected child branch and locks the parent balance. It never chooses a branch automatically.</p>
						<label class='field'>
							<span>Source share</span>
							<select
								value={sourceOutcome}
								disabled={workflowLocked}
								onChange={event => {
									const value = event.currentTarget.value
									if (value === 'INVALID' || value === 'YES' || value === 'NO') {
										invalidateSettlementInputs()
										setSourceOutcome(value)
									}
								}}
							>
								<option value='INVALID'>INVALID</option>
								<option value='YES'>YES</option>
								<option value='NO'>NO</option>
							</select>
						</label>
						<p>Selected source balance: {settlementBalanceLabel(balanceState, sourceBalance)}</p>
						<label class='field'>
							<span>Fork outcome index for the child universe</span>
							<input
								value={targetOutcomeIndex}
								disabled={workflowLocked}
								inputMode='numeric'
								onInput={event => {
									invalidateSettlementInputs()
									setTargetOutcomeIndex(event.currentTarget.value)
								}}
							/>
						</label>
					</>
				)
			})()}
			{receiptWarning === undefined ? null : (
				<p class='error broadcast-warning' role='alert'>
					{receiptWarning}
				</p>
			)}
			{balanceState === 'error' ? <BalanceLoadError message={balanceError ?? 'Wallet balances are unavailable'} retry={retryBalances} disabled={workflowLocked} /> : null}
			{state === 'error' && error !== undefined ? (
				<p class='error' role='alert'>
					{error}
				</p>
			) : null}
			{!(state === 'error' && error !== undefined) && balanceState !== 'error' && receiptWarning === undefined ? (
				<p class={state === 'error' ? 'error' : undefined} role={state === 'error' ? 'alert' : 'status'} aria-live={state === 'error' ? 'assertive' : 'polite'}>
					{settlementStatus}
				</p>
			) : null}
			{approvalRequired ? (
				<>
					<p>This ERC-1155 approval covers every token ID in the pool's ShareToken, including shares on other universe branches. Revoke it through a compatible wallet or ShareToken contract interface when it is no longer needed.</p>
					<button class='primary-action' disabled={workflowLocked || balanceState !== 'ready' || walletClient === undefined || account === undefined} onClick={() => void approveCompleteSetRouter()}>
						Approve router for complete-set redemption
					</button>
				</>
			) : null}
			{!approvalRequired && actionableQuote === undefined ? (
				<button class='primary-action' disabled={inputBlocker !== undefined || balanceState !== 'ready' || walletClient === undefined || account === undefined || state === 'simulating' || workflowLocked} onClick={() => void simulateCurrent()}>
					Simulate authoritative settlement
				</button>
			) : null}
			{!approvalRequired && actionableQuote !== undefined ? (
				<button class='primary-action' disabled={workflowLocked || state !== 'ready'} onClick={() => void submitCurrent()}>
					{actionableQuote.operation === 'migrate-shares' ? `Submit migration to child outcome ${actionableQuote.targetOutcomeIndex.toString()}` : 'Submit settlement transaction'}
				</button>
			) : null}
		</div>
	)
}

function LivePositionControls({
	market,
	balances,
	balanceState,
	balanceError,
	mode,
	side,
	amount,
	quote,
	state,
	receiptWarning,
	externallyLocked,
	nowSeconds,
	setMode,
	setSide,
	setAmount,
	simulate,
	approve,
	submit,
	retryBalances,
}: {
	market: LiveMarket
	balances: LiveBalances | undefined
	balanceState: BalanceState
	balanceError: string | undefined
	mode: 'entry' | 'exit'
	side: 'YES' | 'NO'
	amount: string
	quote: Quote | undefined
	state: TransactionState
	receiptWarning: string | undefined
	externallyLocked: boolean
	nowSeconds: bigint
	setMode(value: 'entry' | 'exit'): void
	setSide(value: 'YES' | 'NO'): void
	setAmount(value: string): void
	simulate(): Promise<void>
	approve(): Promise<void>
	submit(): Promise<void>
	retryBalances(): Promise<void>
}) {
	const yesPercent = market.yesReserve + market.noReserve === 0n ? 0 : bigintToSafeNumber((market.noReserve * 1_000n) / (market.yesReserve + market.noReserve), 'Conditional YES tenths') / 10
	const closed = !marketAcceptsNewRisk(market, nowSeconds)
	const longBalance = side === 'YES' ? balances?.yes : balances?.no
	const maximumExit = balances === undefined || longBalance === undefined ? undefined : maximumInsuredExit({ longOutcome: side, longBalance, invalidBalance: balances.invalid, yesReserve: market.yesReserve, noReserve: market.noReserve, feeBps: market.feeBps })
	const parsedInput = parseUnitsOrUndefined(amount)
	const exceedsInsurance = mode === 'exit' && parsedInput !== undefined && maximumExit !== undefined && parsedInput > maximumExit
	const entryPriceImpactBps = quote?.kind === 'entry' ? quote.value.result.conditionalYesBpsAfter - quote.value.result.conditionalYesBpsBefore : undefined
	const workflowLocked = externallyLocked || positionControlsWorkflowLocked(state, receiptWarning)
	const walletBalanceLabel = (value: bigint | undefined) => {
		if (value !== undefined) return formatShareAmount(value)
		if (balanceState === 'loading') return 'Loading…'
		if (balanceState === 'error') return 'Unavailable'
		return 'Connect wallet'
	}
	return (
		<div class='operation-block' aria-busy={balanceState === 'loading'}>
			<ProbabilityBar yesPercent={yesPercent} />
			{mode === 'entry' ? (
				<p class='pool-mint-note'>
					Submitted ETH goes to Statoblast SecurityPool <code class='pool-mint-note__address'>{market.pool}</code>. That exact pool reconciles collateral and mints complete-set shares at its live rate.
				</p>
			) : null}
			<dl class='metrics'>
				<div>
					<dt>YES reserve</dt>
					<dd>{formatShareAmount(market.yesReserve)}</dd>
				</div>
				<div>
					<dt>NO reserve</dt>
					<dd>{formatShareAmount(market.noReserve)}</dd>
				</div>
				<div>
					<dt>Wallet YES</dt>
					<dd>{walletBalanceLabel(balances?.yes)}</dd>
				</div>
				<div>
					<dt>Wallet NO</dt>
					<dd>{walletBalanceLabel(balances?.no)}</dd>
				</div>
				<div>
					<dt>Wallet INVALID</dt>
					<dd>{walletBalanceLabel(balances?.invalid)}</dd>
				</div>
			</dl>
			{balanceState === 'loading' ? <p role='status'>Refreshing wallet balances and approvals…</p> : null}
			{balanceState === 'error' ? <BalanceLoadError message={`Wallet balances are unavailable; retry before simulating. ${balanceError ?? 'Balance refresh failed.'}`} retry={retryBalances} disabled={workflowLocked} /> : null}
			<div class='segmented' aria-label='Live position operation'>
				<button aria-pressed={mode === 'entry'} disabled={closed || workflowLocked} onClick={() => setMode('entry')}>
					Enter
				</button>
				<button aria-pressed={mode === 'exit'} disabled={closed || workflowLocked} onClick={() => setMode('exit')}>
					Exit
				</button>
			</div>
			<div class='side-picker' aria-label='Outcome'>
				<button aria-pressed={side === 'YES'} disabled={closed || workflowLocked} onClick={() => setSide('YES')}>
					YES
				</button>
				<button aria-pressed={side === 'NO'} disabled={closed || workflowLocked} onClick={() => setSide('NO')}>
					NO
				</button>
			</div>
			<label class='field'>
				<span>{mode === 'entry' ? 'ETH amount' : 'Complete-set shares to redeem'}</span>
				<div class='amount-input'>
					<input value={amount} disabled={closed || workflowLocked} inputMode='decimal' onInput={event => setAmount(event.currentTarget.value)} />
					<span>{mode === 'entry' ? 'ETH' : 'shares'}</span>
				</div>
			</label>
			{mode !== 'exit' || maximumExit === undefined ? null : (
				<p>
					Maximum insured {side} exit: {formatShareAmount(maximumExit)}.
				</p>
			)}
			{exceedsInsurance ? (
				<p class='error' role='alert'>
					{insuredExitLimitMessage(parsedInput ?? 0n, maximumExit ?? 0n, balances?.invalid ?? 0n)}
				</p>
			) : null}
			{quote === undefined ? null : (
				<dl class='metrics'>
					<div>
						<dt>Simulation block</dt>
						<dd>{quote.value.blockNumber.toString()}</dd>
					</div>
					<div>
						<dt>Complete-set shares</dt>
						<dd>{formatShareAmount(quote.value.result.completeSetShares)}</dd>
					</div>
					<div>
						<dt>{quote.kind === 'entry' ? 'Opposite shares swapped' : `${side} shares swapped`}</dt>
						<dd>{formatShareAmount(quote.kind === 'entry' ? quote.value.result.oppositeSharesSwapped : quote.value.result.longSharesSwapped)}</dd>
					</div>
					<div>
						<dt>{quote.kind === 'entry' ? `Additional ${side} received` : `Total ${side} required`}</dt>
						<dd>{formatShareAmount(quote.kind === 'entry' ? quote.value.result.additionalLongShares : quote.value.result.totalLongShares)}</dd>
					</div>
					<div>
						<dt>{quote.kind === 'entry' ? `Total ${side} delivered` : 'INVALID required'}</dt>
						<dd>{formatShareAmount(quote.kind === 'entry' ? quote.value.result.totalLongShares : quote.value.result.invalidInsurance)}</dd>
					</div>
					<div>
						<dt>{quote.kind === 'entry' ? 'INVALID received' : 'Estimated ETH out'}</dt>
						<dd>{quote.kind === 'entry' ? formatShareAmount(quote.value.result.invalidInsurance) : `${formatUnits(quote.value.result.ethOut)} ETH`}</dd>
					</div>
					<div>
						<dt>AMM fee</dt>
						<dd>{formatShareAmount(quote.value.result.feeAmount)}</dd>
					</div>
					<div>
						<dt>{quote.kind === 'entry' ? `Minimum ${side} received` : `Maximum ${side} required`}</dt>
						<dd>{formatShareAmount(quote.kind === 'entry' ? quote.value.minimumLongShares : quote.value.maximumLongShares)}</dd>
					</div>
					<div>
						<dt>{quote.kind === 'entry' ? 'Average ETH per long share' : 'Minimum ETH received'}</dt>
						<dd>{quote.kind === 'entry' ? formatEthPerShare(quote.value.amount, quote.value.result.totalLongShares) : `${formatUnits(quote.value.minimumEth)} ETH`}</dd>
					</div>
					<div>
						<dt>Simulated effective complete-set rate</dt>
						<dd>{formatEthPerShare(quote.kind === 'entry' ? quote.value.amount : quote.value.result.ethOut, quote.value.result.completeSetShares)}</dd>
					</div>
					<div>
						<dt>Deadline</dt>
						<dd>{formatTimestamp(quote.value.deadline)}</dd>
					</div>
					{quote.kind === 'entry' ? (
						<>
							<div>
								<dt>Conditional YES before / after</dt>
								<dd>
									{formatUnits(quote.value.result.conditionalYesBpsBefore, 2, 2)}% / {formatUnits(quote.value.result.conditionalYesBpsAfter, 2, 2)}%
								</dd>
							</div>
							<div>
								<dt>Conditional YES price impact</dt>
								<dd>{entryPriceImpactBps === undefined ? '—' : `${entryPriceImpactBps > 0n ? '+' : ''}${formatUnits(entryPriceImpactBps, 2, 2)} percentage points`}</dd>
							</div>
						</>
					) : null}
				</dl>
			)}
			<p role='status' aria-live='polite'>
				{stateLabel(state)}
			</p>
			{receiptWarning === undefined ? null : (
				<p class='error broadcast-warning' role='alert'>
					{receiptWarning}
				</p>
			)}
			{mode === 'exit' && balances?.approved === false ? (
				<>
					<p>This ERC-1155 approval covers every token ID in the pool’s ShareToken, including shares on other universe branches. Revoke it through a compatible wallet or ShareToken contract interface when it is no longer needed.</p>
					<button class='primary-action' disabled={closed || balanceState !== 'ready' || workflowLocked} onClick={approve}>
						Approve router for all ShareToken shares
					</button>
				</>
			) : null}
			{!(mode === 'exit' && balances?.approved === false) && quote === undefined ? (
				<button class='primary-action' disabled={closed || balanceState !== 'ready' || balances === undefined || parsedInput === undefined || parsedInput === 0n || exceedsInsurance || state === 'simulating' || workflowLocked} onClick={simulate}>
					Simulate authoritative router call
				</button>
			) : null}
			{!(mode === 'exit' && balances?.approved === false) && quote !== undefined ? (
				<button class='primary-action' disabled={workflowLocked || closed || state !== 'ready'} onClick={submit}>
					Submit transaction
				</button>
			) : null}
		</div>
	)
}
