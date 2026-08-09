import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { Address, WalletClient } from '@zoltar/shared/ethereum'
import { formatBpsMultiplier, formatEthPerShare, formatShareAmount, formatUnits, parseUnits, parseUnitsOrUndefined, shortAddress } from '../app/format.ts'
import { createLatestRequestGuard } from '../app/latestRequest.ts'
import { AddressValue, Status } from '../components/Status.tsx'
import { ProbabilityBar } from '../components/ProbabilityBar.tsx'
import type { DeploymentConfiguration } from '../protocol/config.ts'
import {
	approveLpRouter,
	approveRouter,
	connectWallet,
	createTradingPublicClient,
	createTradingWalletClient,
	discoverLiveMarkets,
	loadLiveBalances,
	marketAcceptsNewRisk,
	marketNewRiskBlocker,
	simulateEntry,
	simulateExit,
	simulateLiquidity,
	submitFreshEntry,
	submitFreshExit,
	submitFreshLiquidity,
	switchWalletChain,
	validateLiveDeployment,
	walletChainId,
	type LiquidityOperation,
	type LiveBalances,
	type LiveMarket,
} from '../protocol/live.ts'
import { getInjectedEthereum } from '../protocol/injected.ts'
import { maximumInsuredExit } from '../../../ts/sdk/positions.ts'

type EntryQuote = Awaited<ReturnType<typeof simulateEntry>>
type ExitQuote = Awaited<ReturnType<typeof simulateExit>>
type QuoteContext = Readonly<{ account: Address; configuration: DeploymentConfiguration; walletClient: WalletClient }>
type Quote = (Readonly<{ kind: 'entry'; value: EntryQuote }> | Readonly<{ kind: 'exit'; value: ExitQuote }>) & QuoteContext
type TransactionState = 'idle' | 'simulating' | 'ready' | 'approval' | 'pending' | 'confirmed' | 'error'

function statusLabel(market: LiveMarket, nowSeconds: bigint) {
	const blocker = marketNewRiskBlocker(market, nowSeconds)
	if (blocker !== undefined) return blocker
	if (market.pair === undefined) return 'Pair not created'
	return market.tradingStatus === 6 ? 'Pair uninitialized' : 'Trading open'
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
	return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(Number(timestamp) * 1_000))
}

function stateLabel(state: TransactionState) {
	if (state === 'simulating') return 'Simulating router call…'
	if (state === 'ready') return 'Fresh authoritative simulation ready'
	if (state === 'approval') return 'Approval transaction pending…'
	if (state === 'pending') return 'Transaction pending…'
	if (state === 'confirmed') return 'Transaction confirmed; balances and reserves refreshed'
	if (state === 'error') return 'Transaction workflow needs attention'
	return 'Enter an amount to simulate'
}

function configuredClient(configuration: DeploymentConfiguration) {
	return createTradingPublicClient(configuration)
}

function MissingPairAction({ market }: { market: LiveMarket }) {
	const blocker = marketNewRiskBlocker(market, BigInt(Math.floor(Date.now() / 1_000)))
	if (blocker !== undefined)
		return (
			<button class='primary-action' disabled>
				{blocker} — pair creation unavailable
			</button>
		)
	return (
		<a class='primary-action' href='#/liquidity'>
			Create pair and initialize atomically in Liquidity
		</a>
	)
}

export function insuredExitLimitMessage(requested: bigint, maximum: bigint, invalidBalance: bigint) {
	if (maximum === invalidBalance && requested > invalidBalance) return `Your INVALID balance covers only ${formatUnits(invalidBalance)} complete sets. Excess YES/NO profit must remain as shares unless you acquire more INVALID.`
	return `Your current long-share balance and pair liquidity support an insured exit of at most ${formatUnits(maximum)} complete sets. Reduce the exit amount; excess directional shares remain in your wallet.`
}

export function LiveTrading({ route, configuration, configurationError }: { route: string; configuration: DeploymentConfiguration | undefined; configurationError: string | undefined }) {
	const [markets, setMarkets] = useState<LiveMarket[]>([])
	const [selectedPool, setSelectedPool] = useState<Address>()
	const [account, setAccount] = useState<Address>()
	const [walletClient, setWalletClient] = useState<WalletClient>()
	const [balances, setBalances] = useState<LiveBalances>()
	const [mode, setMode] = useState<'entry' | 'exit'>('entry')
	const [side, setSide] = useState<'YES' | 'NO'>('YES')
	const [amount, setAmount] = useState('0.01')
	const [quote, setQuote] = useState<Quote>()
	const [state, setState] = useState<TransactionState>('idle')
	const [message, setMessage] = useState<string>()
	const [discoveryState, setDiscoveryState] = useState<'loading' | 'ready' | 'error'>('loading')
	const [discoveryError, setDiscoveryError] = useState<string>()
	const discoveryRequests = useRef(createLatestRequestGuard()).current
	const balanceRequests = useRef(createLatestRequestGuard()).current
	const simulationRequests = useRef(createLatestRequestGuard()).current
	const selected = markets.find(market => market.pool === selectedPool) ?? markets[0]
	const nowSeconds = BigInt(Math.floor(Date.now() / 1_000))
	const parsedAmount = useMemo(() => {
		try {
			return { value: parseUnits(amount), error: undefined }
		} catch (error) {
			return { value: undefined, error: error instanceof Error ? error.message : 'Invalid amount' }
		}
	}, [amount])

	async function refresh(nextConfiguration = configuration) {
		if (nextConfiguration === undefined) return
		const request = discoveryRequests.begin()
		simulationRequests.invalidate()
		setQuote(undefined)
		setState('idle')
		setDiscoveryState('loading')
		setDiscoveryError(undefined)
		try {
			const client = configuredClient(nextConfiguration)
			await validateLiveDeployment(client, nextConfiguration)
			if (!discoveryRequests.isCurrent(request)) return
			const discovered = await discoverLiveMarkets(client, nextConfiguration)
			if (!discoveryRequests.isCurrent(request)) return
			setMarkets(discovered)
			if (selectedPool === undefined && discovered[0] !== undefined) setSelectedPool(discovered[0].pool)
			setDiscoveryState('ready')
		} catch (error) {
			if (!discoveryRequests.isCurrent(request)) return
			const detail = error instanceof Error ? error.message : 'SecurityPool discovery failed'
			setDiscoveryError(detail)
			setDiscoveryState('error')
		}
	}

	useEffect(() => {
		if (configuration === undefined) {
			discoveryRequests.invalidate()
			balanceRequests.invalidate()
			simulationRequests.invalidate()
			setMessage(configurationError)
			return
		}
		void refresh(configuration)
	}, [configuration, configurationError])

	useEffect(() => {
		simulationRequests.invalidate()
		setQuote(undefined)
		setState('idle')
	}, [route])

	useEffect(() => {
		const request = balanceRequests.begin()
		setBalances(undefined)
		if (configuration === undefined || account === undefined || selected === undefined) return
		void loadLiveBalances(configuredClient(configuration), selected, account, configuration.router).then(
			loaded => {
				if (balanceRequests.isCurrent(request)) setBalances(loaded)
			},
			error => {
				if (balanceRequests.isCurrent(request)) setMessage(error instanceof Error ? error.message : 'Balance refresh failed')
			},
		)
		return () => balanceRequests.invalidate()
	}, [account, configuration, selected])

	async function connect() {
		try {
			const provider = getInjectedEthereum()
			if (provider === undefined) throw new Error('No injected wallet was found')
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
			setAccount(connected)
			setWalletClient(createTradingWalletClient(provider, connected))
			setMessage(undefined)
			await refresh(configuration)
		} catch (error) {
			setMessage(error instanceof Error ? error.message : 'Wallet connection failed')
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
		const balanceRequest = balanceRequests.begin()
		try {
			setState('approval')
			const hash = await approveRouter(walletClient, selected, configuration, account)
			await walletClient.waitForTransactionReceipt({ hash })
			const loaded = await loadLiveBalances(configuredClient(configuration), selected, account, configuration.router)
			if (balanceRequests.isCurrent(balanceRequest)) setBalances(loaded)
			setState('idle')
		} catch (error) {
			setState('error')
			setMessage(error instanceof Error ? error.message : 'Approval failed')
		}
	}

	async function submit() {
		if (configuration === undefined || account === undefined || walletClient === undefined || quote === undefined) return
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
			setState('pending')
			const hash = quote.kind === 'entry' ? await submitFreshEntry(walletClient, configuration, account, quote.value) : await submitFreshExit(walletClient, configuration, account, quote.value)
			const receipt = await walletClient.waitForTransactionReceipt({ hash })
			if (receipt.status === 'reverted') throw new Error('Transaction reverted')
			setQuote(undefined)
			await refresh(configuration)
			setState('confirmed')
		} catch (error) {
			setState('error')
			setMessage(error instanceof Error ? error.message : 'Transaction failed')
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
				<button class='secondary-action' onClick={() => void refresh()}>
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
				onClick={() => {
					balanceRequests.invalidate()
					simulationRequests.invalidate()
					setBalances(undefined)
					setSelectedPool(market.pool)
					setQuote(undefined)
					setState('idle')
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
					<button class='secondary-action' onClick={() => void refresh()}>
						Retry discovery
					</button>
					{marketButtons}
				</div>
			) : (
				marketButtons
			)
	}
	let selectionContent = <p>Select a deployed SecurityPool.</p>
	if (discoveryState === 'loading' && markets.length === 0) selectionContent = <p role='status'>Waiting for SecurityPool discovery…</p>
	else if (discoveryState === 'error' && markets.length === 0) selectionContent = <p>Discovery failed. Retry from the SecurityPools panel.</p>
	else if (markets.length === 0) selectionContent = <p>No SecurityPool is available to select.</p>

	return (
		<main class='route' id='main-content'>
			<header class='route-header'>
				<div>
					<span class='eyebrow'>Canonical SecurityPools · live RPC</span>
					<h1>Two-way markets</h1>
					<p>{configuration.chainName} · conditional prices only · INVALID is not traded.</p>
				</div>
				<button class='wallet-button' onClick={connect}>
					{account === undefined ? 'Connect wallet' : shortAddress(account)}
				</button>
			</header>
			{message === undefined && parsedAmount.error === undefined ? null : (
				<p class='error' role='alert'>
					{message ?? parsedAmount.error}
				</p>
			)}
			<div class='two-column'>
				<section class='section' aria-busy={discoveryState === 'loading'}>
					<div class='section-heading'>
						<div>
							<span class='section-kicker'>Factory discovery</span>
							<h2>SecurityPools</h2>
						</div>
						<button class='secondary-action' disabled={discoveryState === 'loading'} onClick={() => void refresh()}>
							Refresh
						</button>
					</div>
					{discoveryContent}
				</section>
				{selected === undefined ? (
					<section class='section'>{selectionContent}</section>
				) : (
					<section class='section' key={selected.pool}>
						<div class='section-heading'>
							<div>
								<span class='section-kicker'>Exact pool and branch</span>
								<h2>{selected.title}</h2>
							</div>
							<Status tone={marketAcceptsNewRisk(selected, nowSeconds) ? 'good' : 'warn'}>{statusLabel(selected, nowSeconds)}</Status>
						</div>
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
								<dd>{formatTimestamp(selected.endTime)} UTC</dd>
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
								<dd>{selected.universeForkTime === 0n ? 'Not forked' : `Forked ${formatTimestamp(selected.universeForkTime)} UTC`}</dd>
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
								<dd>{formatUnits(selected.initialReportPriorityFeeAttoEthPerGas, 9)} gwei / gas</dd>
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
								<dt>Total / fee-eligible coverage commitment</dt>
								<dd>
									{formatUnits(selected.totalCoverageCommitmentAttoEth)} / {formatUnits(selected.feeEligibleCoverageCommitmentAttoEth)} ETH
								</dd>
							</div>
							<div>
								<dt>Checkpointed collateral / share ratio</dt>
								<dd>{selected.shareTokenSupplyAttoShares === 0n ? 'No complete sets yet' : formatEthPerShare(selected.settlementCollateralAttoEth, selected.shareTokenSupplyAttoShares)}</dd>
							</div>
							<div>
								<dt>AMM fee</dt>
								<dd>{Number(selected.feeBps) / 100}%</dd>
							</div>
						</dl>
						{route === 'liquidity' ? <LiveLiquidityControls configuration={configuration} market={selected} balances={balances} account={account} walletClient={walletClient} refresh={() => refresh(configuration)} /> : null}
						{route === 'portfolio' ? <LivePortfolio market={selected} balances={balances} /> : null}
						{route !== 'liquidity' && route !== 'portfolio' && selected.pair === undefined ? <MissingPairAction market={selected} /> : null}
						{route !== 'liquidity' && route !== 'portfolio' && selected.pair !== undefined ? (
							<LivePositionControls
								market={selected}
								balances={balances}
								mode={mode}
								side={side}
								amount={amount}
								quote={quote}
								state={state}
								setMode={value => {
									simulationRequests.invalidate()
									setMode(value)
									setQuote(undefined)
									setState('idle')
								}}
								setSide={value => {
									simulationRequests.invalidate()
									setSide(value)
									setQuote(undefined)
									setState('idle')
								}}
								setAmount={value => {
									simulationRequests.invalidate()
									setAmount(value)
									setQuote(undefined)
									setState('idle')
								}}
								simulate={simulate}
								approve={approve}
								submit={submit}
							/>
						) : null}
					</section>
				)}
			</div>
		</main>
	)
}

type LiquidityQuote = Awaited<ReturnType<typeof simulateLiquidity>> & QuoteContext

function LiveLiquidityControls({ configuration, market, balances, account, walletClient, refresh }: { configuration: DeploymentConfiguration; market: LiveMarket; balances: LiveBalances | undefined; account: Address | undefined; walletClient: WalletClient | undefined; refresh(): Promise<void> }) {
	const defaultOperation: LiquidityOperation = market.pair === undefined || market.lpTotalSupply === 0n ? 'initialize' : 'add'
	const [operation, setOperation] = useState<LiquidityOperation>(defaultOperation)
	const [amount, setAmount] = useState('0.01')
	const [probability, setProbability] = useState('50')
	const [quote, setQuote] = useState<LiquidityQuote>()
	const [state, setState] = useState<TransactionState>('idle')
	const [error, setError] = useState<string>()
	const simulationRequests = useRef(createLatestRequestGuard()).current
	const parsed = useMemo(() => parseUnitsOrUndefined(amount), [amount])
	const conditionalBps = useMemo(() => {
		const value = parseUnitsOrUndefined(probability, 2)
		return value !== undefined && value > 0n && value < 10_000n ? value : undefined
	}, [probability])
	const closedForAdding = !marketAcceptsNewRisk(market, BigInt(Math.floor(Date.now() / 1_000)))
	const needsLpApproval = operation === 'remove' && market.lpTotalSupply > 0n && parsed !== undefined && (balances?.lpAllowance ?? 0n) < parsed
	const workflowLocked = state === 'approval' || state === 'pending'

	useEffect(() => {
		simulationRequests.invalidate()
		setQuote(undefined)
		setState('idle')
		return () => simulationRequests.invalidate()
	}, [account, configuration, market, walletClient])

	async function simulateCurrent() {
		if (walletClient === undefined || account === undefined || parsed === undefined || parsed === 0n || (operation === 'initialize' && conditionalBps === undefined)) return
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
		try {
			setState('approval')
			const hash = await approveLpRouter(walletClient, configuration, market, account, parsed)
			await walletClient.waitForTransactionReceipt({ hash })
			await refresh()
			setState('idle')
		} catch (caught) {
			setState('error')
			setError(caught instanceof Error ? caught.message : 'LP approval failed')
		}
	}

	async function submit() {
		if (walletClient === undefined || account === undefined || quote === undefined) return
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
			setState('pending')
			const hash = await submitFreshLiquidity(walletClient, configuration, account, quote)
			const receipt = await walletClient.waitForTransactionReceipt({ hash })
			if (receipt.status === 'reverted') throw new Error('Liquidity transaction reverted')
			setQuote(undefined)
			await refresh()
			setState('confirmed')
		} catch (caught) {
			setState('error')
			setError(caught instanceof Error ? caught.message : 'Liquidity transaction failed')
		}
	}

	return (
		<div class='operation-block'>
			<h3>Live liquidity</h3>
			<div class='segmented' aria-label='Liquidity operation'>
				<button
					aria-pressed={operation === 'initialize'}
					disabled={market.lpTotalSupply > 0n || closedForAdding || workflowLocked}
					onClick={() => {
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
			{operation === 'remove' ? <p>Removal returns raw YES and NO. It never consumes wallet INVALID.</p> : <p>All INVALID and unused directional shares return to the wallet; LP tokens do not carry insurance.</p>}
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
				<button class='primary-action' disabled={account === undefined || parsed === undefined || (operation === 'initialize' && conditionalBps === undefined) || (operation !== 'remove' && closedForAdding) || state === 'simulating' || workflowLocked} onClick={simulateCurrent}>
					Simulate liquidity transaction
				</button>
			) : null}
			{!needsLpApproval && quote !== undefined ? (
				<button class='primary-action' disabled={state !== 'ready'} onClick={submit}>
					Submit liquidity transaction
				</button>
			) : null}
		</div>
	)
}

function LivePortfolio({ market, balances }: { market: LiveMarket; balances: LiveBalances | undefined }) {
	if (balances === undefined) return <p>Connect a wallet to load aggregate YES, NO, INVALID, and LP balances.</p>
	const yesClaim = market.lpTotalSupply === 0n ? 0n : (market.yesReserve * balances.lp) / market.lpTotalSupply
	const noClaim = market.lpTotalSupply === 0n ? 0n : (market.noReserve * balances.lp) / market.lpTotalSupply
	let coveredSets = balances.invalid
	if (yesClaim < coveredSets) coveredSets = yesClaim
	if (noClaim < coveredSets) coveredSets = noClaim
	const maximumYesExit = maximumInsuredExit({ longOutcome: 'YES', longBalance: balances.yes, invalidBalance: balances.invalid, yesReserve: market.yesReserve, noReserve: market.noReserve, feeBps: market.feeBps })
	const maximumNoExit = maximumInsuredExit({ longOutcome: 'NO', longBalance: balances.no, invalidBalance: balances.invalid, yesReserve: market.yesReserve, noReserve: market.noReserve, feeBps: market.feeBps })
	return (
		<div class='operation-block'>
			<h3>Aggregate wallet exposure</h3>
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
			<p>Coverage is derived from aggregate wallet balances. Transferring LP tokens does not transfer INVALID.</p>
		</div>
	)
}

function LivePositionControls({
	market,
	balances,
	mode,
	side,
	amount,
	quote,
	state,
	setMode,
	setSide,
	setAmount,
	simulate,
	approve,
	submit,
}: {
	market: LiveMarket
	balances: LiveBalances | undefined
	mode: 'entry' | 'exit'
	side: 'YES' | 'NO'
	amount: string
	quote: Quote | undefined
	state: TransactionState
	setMode(value: 'entry' | 'exit'): void
	setSide(value: 'YES' | 'NO'): void
	setAmount(value: string): void
	simulate(): Promise<void>
	approve(): Promise<void>
	submit(): Promise<void>
}) {
	const yesPercent = market.yesReserve + market.noReserve === 0n ? 0 : Number((market.noReserve * 1_000n) / (market.yesReserve + market.noReserve)) / 10
	const closed = market.tradingStatus !== 0
	const longBalance = side === 'YES' ? balances?.yes : balances?.no
	const maximumExit = balances === undefined || longBalance === undefined ? undefined : maximumInsuredExit({ longOutcome: side, longBalance, invalidBalance: balances.invalid, yesReserve: market.yesReserve, noReserve: market.noReserve, feeBps: market.feeBps })
	const parsedInput = parseUnitsOrUndefined(amount)
	const exceedsInsurance = mode === 'exit' && parsedInput !== undefined && maximumExit !== undefined && parsedInput > maximumExit
	const entryPriceImpact = quote?.kind === 'entry' ? Number(quote.value.result.conditionalYesBpsAfter - quote.value.result.conditionalYesBpsBefore) / 100 : undefined
	const workflowLocked = state === 'approval' || state === 'pending'
	return (
		<div class='operation-block'>
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
					<dd>{balances === undefined ? 'Connect wallet' : formatShareAmount(balances.yes)}</dd>
				</div>
				<div>
					<dt>Wallet NO</dt>
					<dd>{balances === undefined ? 'Connect wallet' : formatShareAmount(balances.no)}</dd>
				</div>
				<div>
					<dt>Wallet INVALID</dt>
					<dd>{balances === undefined ? 'Connect wallet' : formatShareAmount(balances.invalid)}</dd>
				</div>
			</dl>
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
						<dt>{quote.kind === 'entry' ? 'INVALID insurance' : 'Estimated ETH out'}</dt>
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
						<dd>{formatTimestamp(quote.value.deadline)} UTC</dd>
					</div>
					{quote.kind === 'entry' ? (
						<>
							<div>
								<dt>Conditional YES before / after</dt>
								<dd>
									{Number(quote.value.result.conditionalYesBpsBefore) / 100}% / {Number(quote.value.result.conditionalYesBpsAfter) / 100}%
								</dd>
							</div>
							<div>
								<dt>Conditional YES price impact</dt>
								<dd>{entryPriceImpact === undefined ? '—' : `${entryPriceImpact > 0 ? '+' : ''}${entryPriceImpact.toFixed(2)} percentage points`}</dd>
							</div>
						</>
					) : null}
				</dl>
			)}
			<p role='status' aria-live='polite'>
				{stateLabel(state)}
			</p>
			{mode === 'exit' && balances?.approved === false ? (
				<>
					<p>This ERC-1155 approval covers every token ID in the pool’s ShareToken, including shares on other universe branches. Revoke it through a compatible wallet or ShareToken contract interface when it is no longer needed.</p>
					<button class='primary-action' disabled={closed || workflowLocked} onClick={approve}>
						Approve router for all ShareToken shares
					</button>
				</>
			) : null}
			{!(mode === 'exit' && balances?.approved === false) && quote === undefined ? (
				<button class='primary-action' disabled={closed || balances === undefined || parsedInput === undefined || parsedInput === 0n || exceedsInsurance || state === 'simulating' || workflowLocked} onClick={simulate}>
					Simulate authoritative router call
				</button>
			) : null}
			{!(mode === 'exit' && balances?.approved === false) && quote !== undefined ? (
				<button class='primary-action' disabled={closed || state !== 'ready'} onClick={submit}>
					Submit transaction
				</button>
			) : null}
		</div>
	)
}
