import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'preact/hooks'
import type { Address, Hash, PublicClient, WalletClient } from '@zoltar/shared/ethereum'
import { bigintToSafeNumber, formatBpsMultiplier, formatCapacityOwnership, formatEthPerShare, formatMintingCapacity, formatOutcomeAmount, formatShareAmount, formatUnits, parseUnits, parseUnitsOrUndefined, shortAddress } from '../app/format.ts'
import { createExclusiveWorkflowGuard, createLatestRequestGuard } from '../app/latestRequest.ts'
import { AddressValue, SecurityPoolAddressLink, Status } from '../components/Status.tsx'
import { ProbabilityBar } from '../components/ProbabilityBar.tsx'
import { ForkMigrationTargets } from './ForkMigrationTargets.tsx'
import type { DeploymentConfiguration } from '../protocol/config.ts'
import { loadForkMigrationContext, type ForkMigrationContext, type ForkTarget } from '../protocol/forks.ts'
import {
	approveLpRouter,
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
	marketAcceptsNewRisk,
	marketNewRiskBlocker,
	mapWithConcurrency,
	publicErrorMessage,
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
	type SecurityPoolDeployment,
	type ShareOutcome,
} from '../protocol/live.ts'
import { getInjectedEthereum, subscribeToWalletContextChanges, type InjectedEthereum, type WalletContextChangeEvent } from '../protocol/injected.ts'
import { maximumInsuredExit } from '../../../ts/sdk/positions.ts'

type EntryQuote = Awaited<ReturnType<typeof simulateEntry>>
type ExitQuote = Awaited<ReturnType<typeof simulateExit>>
type QuoteContext = Readonly<{ account: Address; configuration: DeploymentConfiguration; walletClient: WalletClient }>
type Quote = (Readonly<{ kind: 'entry'; value: EntryQuote }> | Readonly<{ kind: 'exit'; value: ExitQuote }>) & QuoteContext
type TransactionState = 'idle' | 'simulating' | 'ready' | 'preparing' | 'approval' | 'approval-pending' | 'approval-confirmed' | 'submitting' | 'pending' | 'confirmed' | 'error'
type BalanceState = 'disconnected' | 'loading' | 'ready' | 'error'
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
type GuardedWalletWrite = <T>(write: () => Promise<T>) => Promise<T>

type LiveSettlementServices = Readonly<{
	createPublicClient(configuration: DeploymentConfiguration): PublicClient
	loadForkContext: typeof loadForkMigrationContext
	simulate: typeof simulateSettlement
	submit: typeof submitFreshSettlement
}>

const liveSettlementServices: LiveSettlementServices = {
	createPublicClient: createTradingPublicClient,
	loadForkContext: loadForkMigrationContext,
	simulate: simulateSettlement,
	submit: submitFreshSettlement,
}

const ignoreWalletSummaryChange = () => undefined

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

function resolvedQuestionOutcome(outcome: number): ShareOutcome | undefined {
	if (outcome === 0) return 'INVALID'
	if (outcome === 1) return 'YES'
	if (outcome === 2) return 'NO'
	return undefined
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

function stateLabel(state: TransactionState, action = 'Transaction') {
	if (state === 'simulating') return 'Simulating router call…'
	if (state === 'ready') return 'Fresh authoritative simulation ready'
	if (state === 'preparing') return `Preparing ${action}…`
	if (state === 'approval') return `${action} approval pending in wallet…`
	if (state === 'approval-pending') return `${action} approval pending on-chain…`
	if (state === 'approval-confirmed') return `${action} approval confirmed on-chain`
	if (state === 'submitting') return `${action} pending in wallet…`
	if (state === 'pending') return `${action} pending on-chain…`
	if (state === 'confirmed') return `${action} confirmed on-chain`
	if (state === 'error') return 'Transaction workflow needs attention'
	return 'Ready to simulate after wallet balances and inputs are valid'
}

function renderLiveTradeSummary(quote: Quote, side: 'YES' | 'NO') {
	if (quote.kind === 'entry')
		return (
			<div class='trade-summary' aria-label='Trade summary'>
				<div>
					<span>You pay</span>
					<strong>{formatUnits(quote.value.amount)} ETH</strong>
				</div>
				<span class='trade-summary__arrow' aria-hidden='true'>
					→
				</span>
				<div>
					<span>You receive</span>
					<strong>{formatOutcomeAmount(quote.value.result.totalLongShares, side)}</strong>
					<small>+ {formatOutcomeAmount(quote.value.result.invalidInsurance, 'INVALID')}</small>
				</div>
			</div>
		)
	return (
		<div class='trade-summary' aria-label='Trade summary'>
			<div>
				<span>You use</span>
				<strong>{formatOutcomeAmount(quote.value.result.totalLongShares, side)}</strong>
				<small>+ {formatOutcomeAmount(quote.value.result.invalidInsurance, 'INVALID')}</small>
			</div>
			<span class='trade-summary__arrow' aria-hidden='true'>
				→
			</span>
			<div>
				<span>You receive</span>
				<strong>{formatUnits(quote.value.result.ethOut)} ETH</strong>
			</div>
		</div>
	)
}

const DEFAULT_SLIPPAGE_PERCENT = '0.5'
const DEFAULT_TRANSACTION_VALIDITY_MINUTES = '20'

export function parseSlippageBps(value: string) {
	const parsed = parseUnitsOrUndefined(value, 2)
	return parsed !== undefined && parsed >= 0n && parsed <= 500n ? parsed : undefined
}

export function parseTransactionValidityMinutes(value: string) {
	if (!/^\d+$/.test(value)) return undefined
	const parsed = BigInt(value)
	return parsed >= 1n && parsed <= 1_440n ? parsed : undefined
}

export function ExecutionProtectionFields({ slippage, validityMinutes, disabled, onSlippageInput, onValidityInput }: { slippage: string; validityMinutes: string; disabled: boolean; onSlippageInput(value: string): void; onValidityInput(value: string): void }) {
	const slippageBps = parseSlippageBps(slippage)
	const parsedValidityMinutes = parseTransactionValidityMinutes(validityMinutes)
	const fieldId = useId()
	const slippageErrorId = `${fieldId}-slippage-error`
	const validityErrorId = `${fieldId}-validity-error`
	return (
		<fieldset class='execution-settings'>
			<legend>Transaction protection</legend>
			<div class='execution-settings__fields'>
				<label class='field'>
					<span>Slippage tolerance</span>
					<div class='amount-input'>
						<input value={slippage} disabled={disabled} inputMode='decimal' aria-invalid={slippageBps === undefined} aria-describedby={slippageBps === undefined ? slippageErrorId : undefined} onInput={event => onSlippageInput(event.currentTarget.value)} />
						<span>%</span>
					</div>
					{slippageBps === undefined ? (
						<small class='error' id={slippageErrorId} role='alert'>
							Enter 0% to 5%, with at most two decimal places.
						</small>
					) : null}
				</label>
				<label class='field'>
					<span>Transaction valid for</span>
					<div class='amount-input'>
						<input value={validityMinutes} disabled={disabled} inputMode='numeric' aria-invalid={parsedValidityMinutes === undefined} aria-describedby={parsedValidityMinutes === undefined ? validityErrorId : undefined} onInput={event => onValidityInput(event.currentTarget.value)} />
						<span>minutes</span>
					</div>
					{parsedValidityMinutes === undefined ? (
						<small class='error' id={validityErrorId} role='alert'>
							Enter a whole number from 1 to 1440 minutes.
						</small>
					) : null}
				</label>
			</div>
			<small>Lower slippage allows less adverse movement from the simulated quote. A shorter validity window reduces stale-transaction exposure. Either setting can cause more reverts.</small>
		</fieldset>
	)
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

function SecurityPoolIdentityRows({ market }: { market: Pick<LiveMarket, 'pool' | 'shareToken' | 'universeId' | 'questionId'> }) {
	const scope = shareBalanceScope(market)
	return (
		<>
			<div>
				<dt>Security pool address</dt>
				<dd>
					<AddressValue value={scope.pool} />
				</dd>
			</div>
			<div>
				<dt>Share token address</dt>
				<dd>
					<AddressValue value={scope.shareToken} />
				</dd>
			</div>
			<div>
				<dt>Question ID</dt>
				<dd>{market.questionId.toString()}</dd>
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

export function LiveSecurityPoolDetails({ market, refreshError, refreshing = false, retry, workflowLocked }: { market: LiveMarket; refreshError?: string | undefined; refreshing?: boolean; retry(): void; workflowLocked: boolean }) {
	const hasLoadedDetails = market.loadError === undefined
	let refreshMessage: string | undefined
	if (refreshing) refreshMessage = hasLoadedDetails ? 'Refreshing security pool; showing the last successful result.' : 'Retrying security pool details…'
	let errorMessage: string | undefined
	if (market.loadError !== undefined) errorMessage = refreshError === undefined ? `Security pool details could not be loaded: ${market.loadError}` : `Security pool details could not be loaded: ${market.loadError}. Latest retry failed: ${refreshError}`
	else if (refreshError !== undefined) errorMessage = `SecurityPool refresh failed; showing the last successful result: ${refreshError}`
	return (
		<main class='route' id='main-content'>
			<header class='route-header'>
				<div>
					<a class='eyebrow' href='#/markets'>
						← Markets
					</a>
					<h1>Security pool</h1>
					<p>{market.title}</p>
				</div>
				{market.loadError === undefined ? null : <Status tone='warn'>Pool data unavailable</Status>}
			</header>
			<section class='section' aria-busy={refreshing}>
				{refreshMessage === undefined ? null : <p role='status'>{refreshMessage}</p>}
				{errorMessage === undefined ? null : (
					<>
						<p class='error' role='alert'>
							{errorMessage}
						</p>
						{refreshing ? null : (
							<button class='secondary-action' disabled={workflowLocked} onClick={retry}>
								{hasLoadedDetails ? 'Retry refresh' : 'Retry security pool'}
							</button>
						)}
					</>
				)}
				{market.loadError === undefined ? (
					<dl class='fact-list'>
						<SecurityPoolIdentityRows market={market} />
						<div>
							<dt>Question end</dt>
							<dd>{formatTimestamp(market.endTime)}</dd>
						</div>
						<div>
							<dt>System state</dt>
							<dd>{systemStateLabel(market.systemState)}</dd>
						</div>
						<div>
							<dt>Universe fork</dt>
							<dd>{market.universeForkTime === 0n ? 'Not forked' : `Forked ${formatTimestamp(market.universeForkTime)}`}</dd>
						</div>
						{market.questionOutcome === 3 ? null : (
							<div>
								<dt>Outcome</dt>
								<dd>{questionOutcomeLabel(market.questionOutcome)}</dd>
							</div>
						)}
						<div>
							<dt>Security multiplier</dt>
							<dd>{formatBpsMultiplier(market.statoblastSecurityMultiplierBps)}</dd>
						</div>
						<div>
							<dt>Initial report priority fee</dt>
							<dd>{formatUnits(market.initialReportPriorityFeeAttoEthPerGas, 9)} nETH / gas</dd>
						</div>
						<div>
							<dt>Registered vaults</dt>
							<dd>{market.vaultCount.toString()}</dd>
						</div>
						<div>
							<dt>Per-second retention multiplier</dt>
							<dd>{formatUnits(market.currentRetentionRate, 18, 12)}×</dd>
						</div>
						<div>
							<dt>Total / fee-eligible capacity ownership</dt>
							<dd>{formatCapacityOwnership(market.totalCapacityOwnershipAttoRep, market.feeEligibleCapacityOwnershipAttoRep)}</dd>
						</div>
						<div>
							<dt>Minting capacity</dt>
							<dd>{formatMintingCapacity(market.settlementCollateralAttoEth, market.mintingCapacityCeilingAttoEth)}</dd>
						</div>
						<div>
							<dt>Checkpointed collateral / share ratio</dt>
							<dd>{market.shareTokenSupplyAttoShares === 0n ? 'No complete sets yet' : formatEthPerShare(market.settlementCollateralAttoEth, market.shareTokenSupplyAttoShares)}</dd>
						</div>
					</dl>
				) : (
					<dl class='fact-list'>
						<SecurityPoolIdentityRows market={market} />
					</dl>
				)}
			</section>
		</main>
	)
}

export function insuredExitLimitMessage(requested: bigint, maximum: bigint, invalidBalance: bigint) {
	if (maximum === invalidBalance && requested > invalidBalance) return `Your INVALID balance covers only ${formatUnits(invalidBalance)} complete sets. Excess YES/NO profit must remain as shares unless you acquire more INVALID.`
	return `Your current long-share balance and pair liquidity support an insured exit of at most ${formatUnits(maximum)} complete sets. Reduce the exit amount; excess directional shares remain in your wallet.`
}

export function migrationSimulationSummary(blockNumber: bigint, sourceOutcome: ShareOutcome, targetCount: bigint) {
	return `Fork migration simulation ready at block ${blockNumber.toString()}: the entire selected ${sourceOutcome} balance will be copied into ${targetCount.toString()} selected child ${targetCount === 1n ? 'branch' : 'branches'} and locked in the parent universe.`
}

export function settlementInputBlocker(operation: SettlementOperation, operationAvailable: boolean, completeSets: bigint, parsedAmount: bigint | undefined, targetOutcomeIndexes: readonly bigint[], sourceOutcome: ShareOutcome, sourceBalance: bigint | undefined) {
	if (!operationAvailable) return 'The selected settlement action is unavailable for the current lifecycle state or wallet balances'
	if (operation === 'redeem-complete-set') {
		if (parsedAmount === undefined || parsedAmount === 0n) return 'Enter a valid positive complete-set share amount'
		if (parsedAmount > completeSets) return `Enter no more than the available complete-set balance of ${formatShareAmount(completeSets)}`
	}
	if (operation === 'migrate-shares') {
		if (targetOutcomeIndexes.length === 0) return 'Select at least one child branch from the fork question'
		if (sourceBalance === undefined || sourceBalance === 0n) return `The selected ${sourceOutcome} balance is zero`
	}
	return undefined
}

export function forkMigrationBatchBlocker(targets: readonly ForkTarget[]) {
	if (targets.length <= 1 || targets.every(target => target.canonicalPool !== undefined)) return undefined
	return 'This selection includes a missing child pool; migrate each missing target separately for the current source share'
}

export function forkMigrationBatchWarning(targets: readonly ForkTarget[]) {
	if (forkMigrationBatchBlocker(targets) === undefined) return undefined
	return 'For this source share, submit each missing child as a separate migration. After confirmation, do not select that same source-child pair again. A different source share may batch those children once their pools are ready.'
}

export function settlementBalanceLabel(balanceState: BalanceState, balance: bigint | undefined, outcome?: ShareOutcome) {
	if (balanceState === 'loading') return 'Loading…'
	if (balanceState === 'error') return 'Unavailable'
	if (balanceState !== 'ready' || balance === undefined) return 'Not loaded'
	return outcome === undefined ? formatShareAmount(balance) : formatOutcomeAmount(balance, outcome)
}

export function SecurityPoolRouteEmptyState({ discoveryState, discoveryError, workflowLocked, retry }: { discoveryState: 'loading' | 'ready' | 'error'; discoveryError: string | undefined; workflowLocked: boolean; retry(): void }) {
	if (discoveryState === 'loading') return <p role='status'>Loading security pool details…</p>
	if (discoveryState === 'error')
		return (
			<>
				<p class='error' role='alert'>
					Security pool discovery failed: {discoveryError ?? 'unknown discovery error'}
				</p>
				<button class='secondary-action' disabled={workflowLocked} onClick={retry}>
					Retry discovery
				</button>
			</>
		)
	return (
		<p class='error' role='alert'>
			This security pool is not available in the selected universe.
		</p>
	)
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

export function LiveTrading({
	route,
	configuration,
	configurationError,
	selectedUniverseId,
	onUniversesChange = () => undefined,
	onWorkflowLockChange,
	onWalletSummaryChange = ignoreWalletSummaryChange,
	walletSummaryRetryNonce = 0,
	onDeploymentRetry = () => undefined,
}: {
	route: string
	configuration: DeploymentConfiguration | undefined
	configurationError: string | undefined
	selectedUniverseId?: string | undefined
	onUniversesChange?(universeIds: readonly bigint[], selectedUniverseId: bigint | undefined): void
	onWorkflowLockChange(locked: boolean): void
	onWalletSummaryChange?(summary: WalletSummaryState): void
	walletSummaryRetryNonce?: number
	onDeploymentRetry?(): void
}) {
	const [markets, setMarkets] = useState<LiveMarket[]>([])
	const [selectedPool, setSelectedPool] = useState<Address>()
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
	const [slippage, setSlippage] = useState(DEFAULT_SLIPPAGE_PERCENT)
	const [transactionValidityMinutes, setTransactionValidityMinutes] = useState(DEFAULT_TRANSACTION_VALIDITY_MINUTES)
	const [quote, setQuote] = useState<Quote>()
	const [state, setState] = useState<TransactionState>('idle')
	const [positionHash, setPositionHash] = useState<Hash>()
	const [message, setMessage] = useState<string>()
	const [positionReceiptWarning, setPositionReceiptWarning] = useState<string>()
	const [discoveryState, setDiscoveryState] = useState<'loading' | 'ready' | 'error'>('loading')
	const [discoveryError, setDiscoveryError] = useState<string>()
	const [marketPage, setMarketPage] = useState({ start: 0n, total: 0n, previousStart: undefined as bigint | undefined, nextStart: undefined as bigint | undefined })
	const marketListRef = useRef<HTMLElement>(null)
	const deploymentIndex = useRef(createSecurityPoolDeploymentIndex<SecurityPoolDeployment, { blockNumber: bigint; blockHash: Hash }>()).current
	const portfolioBalanceRequests = useRef(createLatestRequestGuard()).current
	const previousRoute = useRef(route)
	const marketDetailRef = useRef<HTMLElement>(null)
	const discoveryRequests = useRef(createLatestRequestGuard()).current
	const balanceRequests = useRef(createLatestRequestGuard()).current
	const walletSummaryRequests = useRef(createLatestRequestGuard()).current
	const connectionRequests = useRef(createLatestRequestGuard()).current
	const walletContextRevision = useRef(0)
	const walletSubscriptionCleanup = useRef<(() => void) | undefined>()
	const walletContextChangeHandler = useRef<(provider: InjectedEthereum, eventName: WalletContextChangeEvent, allowDisconnectedRefresh: boolean) => void>(() => undefined)
	const walletConnectHandler = useRef<() => void>(() => undefined)
	const walletComponentMounted = useRef(true)
	const walletRenderContextKey = `${route}\u0000${selectedUniverseId ?? ''}\u0000${configuration?.chainId.toString() ?? ''}\u0000${configuration?.router ?? ''}`
	const walletRenderContextKeyRef = useRef(walletRenderContextKey)
	walletRenderContextKeyRef.current = walletRenderContextKey
	const previousWalletSummaryRetryNonce = useRef(walletSummaryRetryNonce)
	const simulationRequests = useRef(createLatestRequestGuard()).current
	const positionWorkflow = useRef(createExclusiveWorkflowGuard()).current
	const positionWorkflowLockedRef = useRef(false)
	const liquidityWorkflowLockedRef = useRef(false)
	const [positionWorkflowLocked, setPositionWorkflowLocked] = useState(false)
	const [liquidityWorkflowLocked, setLiquidityWorkflowLocked] = useState(false)
	const workflowLocked = positionWorkflowLocked || liquidityWorkflowLocked
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
			if (!positionWorkflowLockedRef.current) {
				setPositionHash(undefined)
				setPositionReceiptWarning(undefined)
			}
			setMessage(detail)
		},
		[balanceRequests, connectionRequests, onWalletSummaryChange, portfolioBalanceRequests, selectedUniverseId, simulationRequests, walletSummaryRequests],
	)
	const executeWithCurrentWalletContext = useCallback(
		async <T,>(expectedAccount: Address, networkFailure: string, accountFailure: string, action: () => Promise<T>): Promise<T> => {
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
	const [nowSeconds, setNowSeconds] = useState(() => BigInt(Math.floor(Date.now() / 1_000)))
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
		void loadWalletHeaderBalances(configuredClient(configuration), selected, account).then(
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
			const client = configuredClient(nextConfiguration)
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
		const client = configuredClient(configuration)
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
			const loaded = await loadLiveBalances(configuredClient(configuration), selected, account, configuration.router)
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
			setMessage(undefined)
			await refresh(configuration)
		} catch (error) {
			if (!connectionRequests.isCurrent(request)) return
			invalidateWalletIdentity(publicErrorMessage(error, 'Wallet connection failed'))
		}
	}
	walletConnectHandler.current = () => {
		void connect()
	}

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
			setMessage(undefined)
			setState('idle')
			await refresh(configuration)
		} catch (error) {
			if (!connectionRequests.isCurrent(request)) return
			invalidateWalletIdentity(`${contextLabel}: ${publicErrorMessage(error, 'wallet refresh failed')}`)
			setState('error')
		}
	}
	walletContextChangeHandler.current = (provider, eventName, allowDisconnectedRefresh) => {
		void refreshWalletContextAfterEvent(provider, eventName, allowDisconnectedRefresh)
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
		if (positionWorkflowLockedRef.current || liquidityWorkflowLockedRef.current) return
		if (!positionWorkflow.begin()) return
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
			if (refreshResult !== 'ready') {
				return
			}
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
			)
				throw new Error('Trade inputs changed; simulate the current selection again')
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
						<p class={configurationError === undefined ? undefined : 'error'} role={configurationError === undefined ? 'status' : 'alert'}>
							{configurationError ?? message ?? 'Loading deployment.json…'}
						</p>
						{configurationError === undefined ? null : (
							<button class='secondary-action' type='button' onClick={onDeploymentRetry}>
								Retry deployment
							</button>
						)}
					</div>
				</header>
			</main>
		)
	let discoveryContent
	if (discoveryState === 'loading' && visibleMarkets.length === 0) discoveryContent = <p role='status'>Discovering SecurityPools from the configured factory…</p>
	else if (discoveryState === 'error' && visibleMarkets.length === 0)
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
	else if (visibleMarkets.length === 0) discoveryContent = <p>No SecurityPools are deployed in the selected universe.</p>
	else {
		const marketButtons = visibleMarkets.map(market => (
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
					setPositionHash(undefined)
					setPositionReceiptWarning(undefined)
					focusSection(marketDetailRef)
				}}
			>
				<strong>{market.title}</strong>
				<span>{statusLabel(market, nowSeconds)}</span>
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
	if (routePool !== undefined) {
		if (selected !== undefined) return <LiveSecurityPoolDetails market={selected} refreshError={discoveryState === 'error' ? (discoveryError ?? 'unknown discovery error') : undefined} refreshing={discoveryState === 'loading'} retry={refreshFromControl} workflowLocked={workflowLocked} />
		return (
			<main class='route' id='main-content'>
				<header class='route-header'>
					<div>
						<a class='eyebrow' href='#/markets'>
							← Markets
						</a>
						<h1>Security pool</h1>
					</div>
				</header>
				<section class='section' aria-busy={discoveryState === 'loading'}>
					<SecurityPoolRouteEmptyState discoveryState={discoveryState} discoveryError={discoveryError} workflowLocked={workflowLocked} retry={refreshFromControl} />
				</section>
			</main>
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
					{discoveryState === 'loading' && visibleMarkets.length === 0 ? <p role='status'>Discovering SecurityPools…</p> : null}
					{discoveryState === 'error' ? (
						<p class='error' role='alert'>
							SecurityPool discovery failed: {discoveryError}
						</p>
					) : null}
					{discoveryState === 'ready' && visibleMarkets.length === 0 ? <p>No SecurityPools are deployed in the selected universe.</p> : null}
					{discoveryState === 'error' ? null : <LivePortfolio entries={visiblePortfolioEntries} balanceState={portfolioBalanceState} balanceError={portfolioBalanceError} retryBalances={retryPortfolioBalances} />}
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
								{(marketPage.start + 1n).toString()}–{(marketPage.start + BigInt(visibleMarkets.length)).toString()} of {marketPage.total.toString()}
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
										<span class='section-kicker'>SecurityPool</span>
										<h2>{selected.title}</h2>
									</div>
									<Status tone='warn'>Market data unavailable</Status>
								</div>
								<p class='error' role='alert'>
									This SecurityPool could not be loaded. No trading, liquidity, or settlement action is available until its authoritative reads succeed: {selected.loadError}
								</p>
								<dl class='fact-list'>
									<div>
										<dt>Security pool</dt>
										<dd>
											<SecurityPoolAddressLink value={selected.pool} disabled={workflowLocked} />
										</dd>
									</div>
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
									<span class='section-kicker'>SecurityPool</span>
									<h2>{selected.title}</h2>
								</div>
								<Status tone={marketAcceptsNewRisk(selected, nowSeconds) ? 'good' : 'warn'}>{statusLabel(selected, nowSeconds)}</Status>
							</div>
							{route !== 'liquidity' && route !== 'portfolio' && !selectedPairInitialized ? <PairInitializationAction market={selected} /> : null}
							<dl class='fact-list'>
								<div>
									<dt>Security pool</dt>
									<dd>
										<SecurityPoolAddressLink value={selected.pool} disabled={workflowLocked} />
									</dd>
								</div>
								<div>
									<dt>Pair</dt>
									<dd>{selected.pair === undefined ? 'Not created' : <AddressValue value={selected.pair} />}</dd>
								</div>
								<div>
									<dt>Question end</dt>
									<dd>{formatTimestamp(selected.endTime)}</dd>
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
									onKnownReceipt={refreshWalletSummaryAfterReceipt}
									walletContextIsCurrent={expectedAccount => accountRef.current === expectedAccount}
									executeWithCurrentWalletContext={executeWithCurrentWalletContext}
									createGuardedWalletWrite={createGuardedWalletWrite}
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
									onKnownReceipt={refreshWalletSummaryAfterReceipt}
									walletContextIsCurrent={expectedAccount => accountRef.current === expectedAccount}
									executeWithCurrentWalletContext={executeWithCurrentWalletContext}
									createGuardedWalletWrite={createGuardedWalletWrite}
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
									slippage={slippage}
									transactionValidityMinutes={transactionValidityMinutes}
									quote={quote}
									state={state}
									receiptWarning={positionReceiptWarning}
									transactionHash={positionHash}
									externallyLocked={workflowLocked}
									nowSeconds={nowSeconds}
									setMode={value => {
										if (positionWorkflowLockedRef.current) return
										simulationRequests.invalidate()
										setMode(value)
										setQuote(undefined)
										setPositionHash(undefined)
										setState('idle')
									}}
									setSide={value => {
										if (positionWorkflowLockedRef.current) return
										simulationRequests.invalidate()
										setSide(value)
										setQuote(undefined)
										setPositionHash(undefined)
										setState('idle')
									}}
									setAmount={value => {
										if (positionWorkflowLockedRef.current) return
										simulationRequests.invalidate()
										setAmount(value)
										setQuote(undefined)
										setPositionHash(undefined)
										setState('idle')
									}}
									setSlippage={value => {
										if (positionWorkflowLockedRef.current) return
										simulationRequests.invalidate()
										setSlippage(value)
										setQuote(undefined)
										setPositionHash(undefined)
										setState('idle')
									}}
									setTransactionValidityMinutes={value => {
										if (positionWorkflowLockedRef.current) return
										simulationRequests.invalidate()
										setTransactionValidityMinutes(value)
										setQuote(undefined)
										setPositionHash(undefined)
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
	onKnownReceipt,
	walletContextIsCurrent,
	executeWithCurrentWalletContext,
	createGuardedWalletWrite,
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
	onKnownReceipt(): void
	walletContextIsCurrent(account: Address): boolean
	executeWithCurrentWalletContext<T>(account: Address, networkFailure: string, accountFailure: string, action: () => Promise<T>): Promise<T>
	createGuardedWalletWrite(account: Address, networkFailure: string, accountFailure: string): GuardedWalletWrite
	retryBalances(): Promise<void>
	onWorkflowLockChange(locked: boolean): void
}) {
	const defaultOperation: LiquidityOperation = market.pair === undefined || market.lpTotalSupply === 0n ? 'initialize' : 'add'
	const [operation, setOperation] = useState<LiquidityOperation>(defaultOperation)
	const [amount, setAmount] = useState('0.01')
	const [probability, setProbability] = useState('50')
	const [slippage, setSlippage] = useState(DEFAULT_SLIPPAGE_PERCENT)
	const [transactionValidityMinutes, setTransactionValidityMinutes] = useState(DEFAULT_TRANSACTION_VALIDITY_MINUTES)
	const [quote, setQuote] = useState<LiquidityQuote>()
	const [state, setState] = useState<TransactionState>('idle')
	const [transactionHash, setTransactionHash] = useState<Hash>()
	const [error, setError] = useState<string>()
	const [receiptWarning, setReceiptWarning] = useState<string>()
	const simulationRequests = useRef(createLatestRequestGuard()).current
	const workflow = useRef(createExclusiveWorkflowGuard()).current
	const parsed = useMemo(() => parseUnitsOrUndefined(amount), [amount])
	const slippageBps = useMemo(() => parseSlippageBps(slippage), [slippage])
	const validityMinutes = useMemo(() => parseTransactionValidityMinutes(transactionValidityMinutes), [transactionValidityMinutes])
	const conditionalBps = useMemo(() => {
		const value = parseUnitsOrUndefined(probability, 2)
		return value !== undefined && value > 0n && value < 10_000n ? value : undefined
	}, [probability])
	const closedForAdding = !marketAcceptsNewRisk(market, nowSeconds)
	const operationAvailable = liquidityOperationAvailable(operation, market, nowSeconds)
	const needsLpApproval = market.lpTotalSupply > 0n && liquidityApprovalRequired(balanceState, operation, parsed, balances?.lpAllowance)
	const workflowLocked = externallyLocked || positionControlsWorkflowLocked(state, receiptWarning)
	useEffect(() => {
		if (receiptWarning !== undefined) return
		simulationRequests.invalidate()
		setQuote(undefined)
		if (!workflow.isActive()) {
			setTransactionHash(undefined)
			setState('idle')
		}
		return () => simulationRequests.invalidate()
	}, [account, configuration, market.pool, receiptWarning, walletClient])

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
		if (!operationAvailable || walletClient === undefined || account === undefined || parsed === undefined || parsed === 0n || slippageBps === undefined || validityMinutes === undefined || (operation === 'initialize' && conditionalBps === undefined)) return
		const request = simulationRequests.begin()
		try {
			setState('simulating')
			setTransactionHash(undefined)
			setError(undefined)
			const simulated = await simulateLiquidity(walletClient, configuration, market, account, operation, parsed, conditionalBps ?? 5_000n, validityMinutes, slippageBps)
			const nextQuote: LiquidityQuote = { ...simulated, account, configuration, walletClient }
			if (!simulationRequests.isCurrent(request)) return
			setQuote(nextQuote)
			setState('ready')
		} catch (caught) {
			if (!simulationRequests.isCurrent(request)) return
			setState('error')
			setError(publicErrorMessage(caught, 'Liquidity simulation failed'))
		}
	}

	async function approveLp() {
		if (walletClient === undefined || account === undefined || parsed === undefined) return
		if (externallyLocked) return
		if (!workflow.begin()) return
		onWorkflowLockChange(true)
		setState('preparing')
		setError(undefined)
		setReceiptWarning(undefined)
		setTransactionHash(undefined)
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
				return await approveLpRouter(walletClient, configuration, market, account, parsed)
			})
			setTransactionHash(broadcastHash)
			setState('approval-pending')
			const receipt = await observeKnownReceipt(walletClient.waitForTransactionReceipt({ hash: broadcastHash }), onKnownReceipt)
			receiptKnown = true
			if (receipt.status === 'reverted') {
				if (!walletContextIsCurrent(account)) {
					setState('error')
					setError('Wallet context changed while the LP-token approval was pending. Approval transaction reverted.')
					return
				}
				throw new Error('Approval transaction reverted')
			}
			setState('approval-confirmed')
			if (!walletContextIsCurrent(account)) return
			const refreshResult = await refreshBalancesAfterApproval('LP-token approval', market, account)
			if (refreshResult !== 'ready') {
				if (refreshResult === 'context-changed') setError('Wallet context changed while approved balances were refreshing. Reconnect to continue.')
				return
			}
			setReceiptWarning(undefined)
			setError(undefined)
		} catch (caught) {
			if (!walletContextIsCurrent(account)) {
				if (broadcastHash !== undefined && !receiptKnown) {
					keepLocked = true
					setState('approval-pending')
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
			setState(failure.state === 'pending' ? 'approval-pending' : failure.state)
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
		setState('preparing')
		setReceiptWarning(undefined)
		setTransactionHash(undefined)
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
			await executeWithCurrentWalletContext(account, 'Wallet network changed; switch back before submitting', 'Wallet account changed; reconnect and simulate again', async () => undefined)
			const guardedLiquidityWrite = createGuardedWalletWrite(account, 'Wallet network changed during liquidity revalidation; reconnect and simulate again', 'Wallet account changed during liquidity revalidation; reconnect and simulate again')
			broadcastHash = await submitFreshLiquidity(
				walletClient,
				configuration,
				account,
				quote,
				async write =>
					await guardedLiquidityWrite(async () => {
						setState('submitting')
						return await write()
					}),
			)
			setTransactionHash(broadcastHash)
			setState('pending')
			const receipt = await observeKnownReceipt(walletClient.waitForTransactionReceipt({ hash: broadcastHash }), onKnownReceipt)
			receiptKnown = true
			if (receipt.status === 'reverted') throw new Error('Liquidity transaction reverted')
			setQuote(undefined)
			setReceiptWarning(undefined)
			setState('confirmed')
			await refresh()
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
						setTransactionHash(undefined)
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
						setTransactionHash(undefined)
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
						setTransactionHash(undefined)
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
							setTransactionHash(undefined)
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
								setTransactionHash(undefined)
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
			<ExecutionProtectionFields
				slippage={slippage}
				validityMinutes={transactionValidityMinutes}
				disabled={workflowLocked}
				onSlippageInput={value => {
					if (workflow.isActive()) return
					simulationRequests.invalidate()
					setSlippage(value)
					setQuote(undefined)
					setTransactionHash(undefined)
					setState('idle')
				}}
				onValidityInput={value => {
					if (workflow.isActive()) return
					simulationRequests.invalidate()
					setTransactionValidityMinutes(value)
					setQuote(undefined)
					setTransactionHash(undefined)
					setState('idle')
				}}
			/>
			{operation === 'remove' ? <p>Removal returns raw YES and NO. It never consumes wallet INVALID.</p> : <p>All INVALID and unused directional shares return to the wallet; LP tokens do not include wallet INVALID.</p>}
			{quote === undefined ? null : (
				<>
					<p class='quote'>Authoritative router simulation at block {quote.blockNumber.toString()}.</p>
					<dl class='metrics'>
						<div>
							<dt>Slippage tolerance</dt>
							<dd>{formatUnits(quote.slippageBps, 2, 2)}%</dd>
						</div>
						<div>
							<dt>Deadline</dt>
							<dd>{formatTimestamp(quote.deadline)}</dd>
						</div>
						{quote.operation === 'remove' ? (
							<>
								<div>
									<dt>Raw YES returned</dt>
									<dd>{formatOutcomeAmount(quote.expectedYes, 'YES')}</dd>
								</div>
								<div>
									<dt>Raw NO returned</dt>
									<dd>{formatOutcomeAmount(quote.expectedNo, 'NO')}</dd>
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
										{formatOutcomeAmount(quote.result.yesUsed, 'YES')} / {formatOutcomeAmount(quote.result.noUsed, 'NO')}
									</dd>
								</div>
								<div>
									<dt>Unused YES / NO returned</dt>
									<dd>
										{formatOutcomeAmount(quote.result.yesReturned, 'YES')} / {formatOutcomeAmount(quote.result.noReturned, 'NO')}
									</dd>
								</div>
								<div>
									<dt>INVALID retained</dt>
									<dd>{formatOutcomeAmount(quote.result.invalidInsurance, 'INVALID')}</dd>
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
			{transactionHash === undefined ? null : (
				<p class='transaction-hash'>
					<span>Transaction</span>
					<code title={transactionHash}>{transactionHash}</code>
				</p>
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
				{stateLabel(state, 'Liquidity transaction')}
			</p>
			{needsLpApproval ? (
				<button class='primary-action' aria-busy={state === 'preparing' || state === 'approval' || state === 'approval-pending'} disabled={workflowLocked} onClick={approveLp}>
					Approve exact LP amount
				</button>
			) : null}
			{!needsLpApproval && quote === undefined ? (
				<button
					class='primary-action'
					disabled={balanceState !== 'ready' || account === undefined || parsed === undefined || slippageBps === undefined || validityMinutes === undefined || (operation === 'initialize' && conditionalBps === undefined) || (operation !== 'remove' && closedForAdding) || state === 'simulating' || workflowLocked}
					onClick={simulateCurrent}
				>
					Simulate liquidity transaction
				</button>
			) : null}
			{!needsLpApproval && quote !== undefined ? (
				<button class='primary-action' aria-busy={state === 'preparing' || state === 'submitting' || state === 'pending'} disabled={workflowLocked || state !== 'ready' || !liquidityOperationAvailable(quote.operation, quote.market, nowSeconds)} onClick={submit}>
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
					<dd>{formatOutcomeAmount(balances.yes, 'YES')}</dd>
				</div>
				<div>
					<dt>NO</dt>
					<dd>{formatOutcomeAmount(balances.no, 'NO')}</dd>
				</div>
				<div>
					<dt>INVALID</dt>
					<dd>{formatOutcomeAmount(balances.invalid, 'INVALID')}</dd>
				</div>
				<div>
					<dt>LP tokens</dt>
					<dd>{formatUnits(balances.lp)} LP</dd>
				</div>
				<div>
					<dt>LP YES claim</dt>
					<dd>{formatOutcomeAmount(yesClaim, 'YES')}</dd>
				</div>
				<div>
					<dt>LP NO claim</dt>
					<dd>{formatOutcomeAmount(noClaim, 'NO')}</dd>
				</div>
				<div>
					<dt>Claim covered by separate INVALID</dt>
					<dd>{formatShareAmount(coveredSets)}</dd>
				</div>
				<div>
					<dt>Maximum insured YES exit</dt>
					<dd>{formatOutcomeAmount(maximumYesExit, 'YES')}</dd>
				</div>
				<div>
					<dt>Maximum insured NO exit</dt>
					<dd>{formatOutcomeAmount(maximumNoExit, 'NO')}</dd>
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
						{entry.error === undefined ? null : <Status tone='warn'>Balance unavailable</Status>}
					</div>
					<dl class='metrics'>
						<div>
							<dt>Security pool</dt>
							<dd>
								<SecurityPoolAddressLink value={entry.market.pool} />
							</dd>
						</div>
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
	targetOutcomeIndexes: readonly bigint[],
	account: Address | undefined,
	walletClient: WalletClient | undefined,
) {
	if (quote === undefined || quote.inputRevision !== inputRevision || quote.market.pool !== market.pool || quote.operation !== operation || quote.account !== account || quote.walletClient !== walletClient) return false
	if (quote.operation === 'redeem-complete-set') return quote.amount === parsedAmount
	if (quote.operation === 'migrate-shares') return quote.sourceOutcome === sourceOutcome && quote.targetOutcomeIndexes.length === targetOutcomeIndexes.length && quote.targetOutcomeIndexes.every((target, index) => target === targetOutcomeIndexes[index])
	return true
}

export function settlementQuoteCanSubmit(balanceState: BalanceState, inputBlocker: string | undefined, quoteMatchesInputs: boolean) {
	return balanceState === 'ready' && inputBlocker === undefined && quoteMatchesInputs
}

export function LiveSettlementControls({
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
	onKnownReceipt,
	walletContextIsCurrent,
	executeWithCurrentWalletContext,
	createGuardedWalletWrite,
	retryBalances,
	onWorkflowLockChange,
	services = liveSettlementServices,
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
	onKnownReceipt(): void
	walletContextIsCurrent(account: Address): boolean
	executeWithCurrentWalletContext<T>(account: Address, networkFailure: string, accountFailure: string, action: () => Promise<T>): Promise<T>
	createGuardedWalletWrite(account: Address, networkFailure: string, accountFailure: string): GuardedWalletWrite
	retryBalances(): Promise<void>
	onWorkflowLockChange(locked: boolean): void
	services?: LiveSettlementServices
}) {
	let initialOperation: SettlementOperation = 'redeem-complete-set'
	if (market.universeForkTime !== 0n) initialOperation = 'migrate-shares'
	else if (market.questionOutcome !== 3) initialOperation = 'redeem-winning-shares'
	const [operation, setOperation] = useState<SettlementOperation>(initialOperation)
	const [amount, setAmount] = useState('0.01')
	const [slippage, setSlippage] = useState(DEFAULT_SLIPPAGE_PERCENT)
	const [transactionValidityMinutes, setTransactionValidityMinutes] = useState(DEFAULT_TRANSACTION_VALIDITY_MINUTES)
	const [sourceOutcome, setSourceOutcome] = useState<ShareOutcome>('YES')
	const [forkContext, setForkContext] = useState<ForkMigrationContext>()
	const [forkContextState, setForkContextState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
	const [forkContextError, setForkContextError] = useState<string>()
	const [forkContextNonce, setForkContextNonce] = useState(0)
	const [selectedForkTargets, setSelectedForkTargets] = useState<readonly ForkTarget[]>([])
	const [quote, setQuote] = useState<SettlementQuote>()
	const [state, setState] = useState<TransactionState>('idle')
	const [transactionHash, setTransactionHash] = useState<Hash>()
	const [error, setError] = useState<string>()
	const [receiptWarning, setReceiptWarning] = useState<string>()
	const workflow = useRef(createExclusiveWorkflowGuard()).current
	const simulationRequests = useRef(createLatestRequestGuard()).current
	const inputRevision = useRef(0)
	const preserveConfirmedForkTargetReset = useRef(false)
	const forkClient = useMemo(() => services.createPublicClient(configuration), [configuration, services])
	const availability = settlementAvailability(market, balances)
	const winningOutcome = resolvedQuestionOutcome(market.questionOutcome)
	const parsedAmount = parseUnitsOrUndefined(amount)
	const targetOutcomeIndexes = useMemo(() => selectedForkTargets.map(target => target.outcomeIndex), [selectedForkTargets])
	const targetOutcomeKey = targetOutcomeIndexes.map(target => target.toString()).join(',')
	let operationAvailable = availability.canMigrateShares
	if (operation === 'redeem-complete-set') operationAvailable = availability.canRedeemCompleteSets
	else if (operation === 'redeem-winning-shares') operationAvailable = availability.canRedeemWinningShares
	let sourceBalance = balances?.no
	if (sourceOutcome === 'INVALID') sourceBalance = balances?.invalid
	else if (sourceOutcome === 'YES') sourceBalance = balances?.yes
	const workflowLocked = externallyLocked || positionControlsWorkflowLocked(state, receiptWarning)
	const slippageBps = parseSlippageBps(slippage)
	const validityMinutes = parseTransactionValidityMinutes(transactionValidityMinutes)
	let inputBlocker = settlementInputBlocker(operation, operationAvailable, availability.completeSets, parsedAmount, targetOutcomeIndexes, sourceOutcome, sourceBalance)
	if (operation === 'migrate-shares' && operationAvailable) {
		if (forkContextState === 'loading' || forkContextState === 'idle') inputBlocker = 'Loading the universe fork question and child branches'
		else if (forkContextState === 'error' || forkContext === undefined) inputBlocker = forkContextError ?? 'Fork question details are unavailable'
		else inputBlocker ??= forkMigrationBatchBlocker(selectedForkTargets)
	}
	let protectionInputBlocker: string | undefined
	if (operation === 'redeem-complete-set' && slippageBps === undefined) protectionInputBlocker = 'Enter a slippage tolerance from 0% to 5%'
	else if (operation === 'redeem-complete-set' && validityMinutes === undefined) protectionInputBlocker = 'Enter a transaction validity from 1 to 1440 whole minutes'
	if (protectionInputBlocker !== undefined) inputBlocker = protectionInputBlocker
	const approvalRequired = operation === 'redeem-complete-set' && balances?.approved === false
	const quoteMatchesInputs = settlementQuoteMatchesInputs(quote, inputRevision.current, market, operation, parsedAmount, sourceOutcome, targetOutcomeIndexes, account, walletClient)
	const actionableQuote = !approvalRequired && settlementQuoteCanSubmit(balanceState, inputBlocker, quoteMatchesInputs) ? quote : undefined
	const submitContext = useRef({ balanceState, inputBlocker, actionableQuote })
	submitContext.current = { balanceState, inputBlocker, actionableQuote }
	const suppressRedundantProtectionStatus = protectionInputBlocker !== undefined && balanceState === 'ready' && state !== 'error'
	let settlementStatus = 'Connect a wallet to load balances for settlement'
	if (state === 'confirmed') settlementStatus = 'Settlement transaction confirmed on-chain'
	else if (state === 'approval-confirmed') settlementStatus = 'Share-token approval confirmed on-chain'
	else if (balanceState === 'loading') settlementStatus = 'Loading wallet balances for settlement…'
	else if (balanceState === 'ready') {
		if (account === undefined || walletClient === undefined) settlementStatus = 'Connect a wallet to load balances for settlement'
		else if (state === 'preparing') settlementStatus = 'Preparing settlement transaction…'
		else if (state === 'approval') settlementStatus = 'Share-token approval pending in wallet…'
		else if (state === 'approval-pending') settlementStatus = 'Share-token approval pending on-chain…'
		else if (state === 'submitting') settlementStatus = 'Settlement transaction pending in wallet…'
		else if (state === 'pending') settlementStatus = error ?? 'Settlement transaction pending on-chain…'
		else if (state === 'error') settlementStatus = error ?? 'Settlement workflow needs attention'
		else if (approvalRequired) settlementStatus = 'Approve the router to pull the explicit complete set before simulation'
		else if (inputBlocker !== undefined) settlementStatus = inputBlocker
		else if (state === 'simulating') settlementStatus = 'Simulating the authoritative settlement call…'
		else if (state === 'ready' && actionableQuote !== undefined) {
			if (actionableQuote.operation === 'migrate-shares') settlementStatus = migrationSimulationSummary(actionableQuote.blockNumber, actionableQuote.sourceOutcome, BigInt(actionableQuote.targetOutcomeIndexes.length))
			else if (actionableQuote.operation === 'redeem-complete-set')
				settlementStatus = `Authoritative redemption simulation at block ${actionableQuote.blockNumber.toString()}: ${formatUnits(actionableQuote.expectedAttoEth)} ETH expected, ${formatUnits(actionableQuote.minimumAttoEth)} ETH minimum at ${formatUnits(actionableQuote.slippageBps, 2, 2)}% slippage; valid until ${formatTimestamp(actionableQuote.deadline)}`
			else settlementStatus = `Authoritative settlement simulation ready at block ${actionableQuote.blockNumber.toString()}`
		} else settlementStatus = 'Ready to simulate an authoritative protocol action'
	}
	function invalidateSettlementInputs() {
		if (receiptWarning !== undefined) return
		inputRevision.current++
		simulationRequests.invalidate()
		setQuote(undefined)
		setError(undefined)
		if (!workflow.isActive()) {
			setTransactionHash(undefined)
			setState('idle')
		}
	}

	function updateForkTargets(targets: readonly ForkTarget[]) {
		invalidateSettlementInputs()
		setSelectedForkTargets(targets)
	}

	useEffect(() => {
		if (market.universeForkTime === 0n) {
			setForkContext(undefined)
			setForkContextState('idle')
			setForkContextError(undefined)
			setSelectedForkTargets([])
			return
		}
		let active = true
		setForkContext(undefined)
		setForkContextState('loading')
		setForkContextError(undefined)
		setSelectedForkTargets([])
		void services
			.loadForkContext(forkClient, market)
			.then(context => {
				if (!active) return
				setForkContext(context)
				setForkContextState('ready')
			})
			.catch(caught => {
				if (!active) return
				setForkContextState('error')
				setForkContextError(publicErrorMessage(caught, 'Fork question details failed to load'))
			})
		return () => {
			active = false
		}
	}, [forkClient, forkContextNonce, market.pool, market.shareToken, market.universeForkTime, market.universeId, services])

	useEffect(() => {
		if (receiptWarning !== undefined) return
		simulationRequests.invalidate()
		setQuote(undefined)
		if (!workflow.isActive()) {
			setTransactionHash(undefined)
			setState('idle')
		}
	}, [account, amount, market.pool, market.systemState, market.awaitingForkContinuation, market.universeForkTime, market.questionOutcome, operation, receiptWarning, slippage, sourceOutcome, transactionValidityMinutes, walletClient])

	useEffect(() => {
		if (receiptWarning !== undefined) return
		simulationRequests.invalidate()
		setQuote(undefined)
		if (!workflow.isActive()) {
			const preserveConfirmed = preserveConfirmedForkTargetReset.current
			preserveConfirmedForkTargetReset.current = false
			setState(current => (preserveConfirmed && current === 'confirmed' ? current : 'idle'))
		}
	}, [receiptWarning, targetOutcomeKey])

	useEffect(() => {
		if (receiptWarning !== undefined) return
		simulationRequests.invalidate()
		setQuote(undefined)
		if (!workflow.isActive()) setState(current => (current === 'confirmed' || current === 'approval-confirmed' ? current : 'idle'))
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
		setTransactionHash(undefined)
		setError(undefined)
		try {
			let parameters: Readonly<{ amount?: bigint; validityMinutes?: bigint; slippageBps?: bigint; sourceOutcome?: ShareOutcome; targetOutcomeIndexes?: readonly bigint[] }> = {}
			if (operation === 'redeem-complete-set' && parsedAmount !== undefined && slippageBps !== undefined && validityMinutes !== undefined) parameters = { amount: parsedAmount, validityMinutes, slippageBps }
			else if (operation === 'migrate-shares') parameters = { sourceOutcome, targetOutcomeIndexes }
			const simulation = await services.simulate(walletClient, configuration, market, account, operation, parameters)
			if (!simulationRequests.isCurrent(request) || inputRevision.current !== revision) return
			setQuote({ ...simulation, account, walletClient, inputRevision: revision })
			setState('ready')
		} catch (caught) {
			if (!simulationRequests.isCurrent(request)) return
			setState('error')
			setError(publicErrorMessage(caught, 'Settlement simulation failed'))
		}
	}

	async function submitCurrent() {
		const selectedQuote = actionableQuote
		if (walletClient === undefined || account === undefined || selectedQuote === undefined) return
		if (externallyLocked) return
		if (!workflow.begin()) return
		onWorkflowLockChange(true)
		setState('preparing')
		setError(undefined)
		setReceiptWarning(undefined)
		setTransactionHash(undefined)
		let broadcastHash: Hash | undefined
		let receiptKnown = false
		let keepLocked = false
		try {
			await executeWithCurrentWalletContext(account, 'Wallet network changed; reconnect and simulate again', 'Wallet account changed; reconnect and simulate again', async () => undefined)
			const current = submitContext.current
			if (current.balanceState !== 'ready' || current.inputBlocker !== undefined || current.actionableQuote !== selectedQuote) throw new Error('Settlement inputs or balances changed; simulate again')
			const guardedSettlementWrite = createGuardedWalletWrite(account, 'Wallet network changed during settlement revalidation; reconnect and simulate again', 'Wallet account changed during settlement revalidation; reconnect and simulate again')
			broadcastHash = await services.submit(
				walletClient,
				configuration,
				account,
				selectedQuote,
				async write =>
					await guardedSettlementWrite(async () => {
						setState('submitting')
						return await write()
					}),
			)
			setTransactionHash(broadcastHash)
			setState('pending')
			const receipt = await observeKnownReceipt(walletClient.waitForTransactionReceipt({ hash: broadcastHash }), onKnownReceipt)
			receiptKnown = true
			if (receipt.status === 'reverted') throw new Error('Settlement transaction reverted')
			setQuote(undefined)
			setReceiptWarning(undefined)
			setState('confirmed')
			await refresh()
			if (selectedQuote.operation === 'migrate-shares') {
				preserveConfirmedForkTargetReset.current = true
				setForkContextNonce(current => current + 1)
			}
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
		setState('preparing')
		setError(undefined)
		setReceiptWarning(undefined)
		setTransactionHash(undefined)
		let broadcastHash: Hash | undefined
		let receiptKnown = false
		let keepLocked = false
		try {
			broadcastHash = await createGuardedWalletWrite(
				account,
				'Wallet network changed; reconnect before approving',
				'Wallet account changed; reconnect before approving',
			)(async () => {
				setState('approval')
				return await approveRouter(walletClient, market, configuration, account)
			})
			setTransactionHash(broadcastHash)
			setState('approval-pending')
			const receipt = await observeKnownReceipt(walletClient.waitForTransactionReceipt({ hash: broadcastHash }), onKnownReceipt)
			receiptKnown = true
			if (receipt.status === 'reverted') {
				if (!walletContextIsCurrent(account)) {
					setState('error')
					setError('Wallet context changed while the share-token approval was pending. Approval transaction reverted.')
					return
				}
				throw new Error('Approval transaction reverted')
			}
			setState('approval-confirmed')
			if (!walletContextIsCurrent(account)) return
			const refreshResult = await refreshBalancesAfterApproval('Share-token approval', market, account)
			if (refreshResult !== 'ready') {
				if (refreshResult === 'context-changed') setError('Wallet context changed while approved balances were refreshing. Reconnect to continue.')
				return
			}
		} catch (caught) {
			if (!walletContextIsCurrent(account)) {
				if (broadcastHash !== undefined && !receiptKnown) {
					keepLocked = true
					setState('approval-pending')
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
			setState(failure.state === 'pending' ? 'approval-pending' : failure.state)
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
				{winningOutcome === undefined ? null : (
					<button
						aria-pressed={operation === 'redeem-winning-shares'}
						disabled={workflowLocked}
						onClick={() => {
							invalidateSettlementInputs()
							setOperation('redeem-winning-shares')
						}}
					>
						Redeem {winningOutcome}
					</button>
				)}
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
							<p>Burn equal amounts of wallet INVALID, YES, and NO for ETH at the security pool’s current collateral rate. Available complete sets: {settlementBalanceLabel(balanceState, availability.completeSets)}.</p>
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
					return winningOutcome === undefined ? (
						<p>Winning-outcome redemption becomes available after the market finalizes.</p>
					) : (
						<p>
							Redeem the wallet’s entire {winningOutcome} balance ({settlementBalanceLabel(balanceState, availability.winningBalance, winningOutcome)}) through this exact security pool.
						</p>
					)
				return (
					<>
						<p>Choose the market share separately from the fork branches. Migration permanently locks parent-universe transfers for the selected share. The same source can still migrate later into other children.</p>
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
						<p>Selected source balance: {settlementBalanceLabel(balanceState, sourceBalance, sourceOutcome)}</p>
						{forkContextState === 'loading' || forkContextState === 'idle' ? <p role='status'>Loading fork question and child branches…</p> : null}
						{forkContextState === 'error' ? (
							<div class='error' role='alert'>
								<p>{forkContextError ?? 'Fork question details are unavailable.'}</p>
								<button type='button' class='secondary-action' disabled={workflowLocked} onClick={() => setForkContextNonce(current => current + 1)}>
									Retry fork details
								</button>
							</div>
						) : null}
						{forkContext === undefined ? null : <ForkMigrationTargets context={forkContext} selectedTargets={selectedForkTargets} disabled={workflowLocked} onChange={updateForkTargets} />}
						{forkMigrationBatchWarning(selectedForkTargets) === undefined ? null : <p class='warning'>{forkMigrationBatchWarning(selectedForkTargets)}</p>}
					</>
				)
			})()}
			{transactionHash === undefined ? null : (
				<p class='transaction-hash'>
					<span>Transaction</span>
					<code title={transactionHash}>{transactionHash}</code>
				</p>
			)}
			{operation === 'redeem-complete-set' ? (
				<ExecutionProtectionFields
					slippage={slippage}
					validityMinutes={transactionValidityMinutes}
					disabled={workflowLocked}
					onSlippageInput={value => {
						invalidateSettlementInputs()
						setSlippage(value)
					}}
					onValidityInput={value => {
						invalidateSettlementInputs()
						setTransactionValidityMinutes(value)
					}}
				/>
			) : null}
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
			{!(state === 'error' && error !== undefined) && (balanceState !== 'error' || state === 'confirmed' || state === 'approval-confirmed') && receiptWarning === undefined && !suppressRedundantProtectionStatus ? (
				<p class={state === 'error' ? 'error' : undefined} role={state === 'error' ? 'alert' : 'status'} aria-live={state === 'error' ? 'assertive' : 'polite'}>
					{settlementStatus}
				</p>
			) : null}
			{approvalRequired ? (
				<>
					<p>This ERC-1155 approval covers every token ID in the pool's share token, including other universe branches. Revoke it through a compatible wallet or share-token contract interface when it is no longer needed.</p>
					<button class='primary-action' aria-busy={state === 'preparing' || state === 'approval' || state === 'approval-pending'} disabled={workflowLocked || balanceState !== 'ready' || walletClient === undefined || account === undefined} onClick={() => void approveCompleteSetRouter()}>
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
				<button class='primary-action' aria-busy={state === 'preparing' || state === 'submitting' || state === 'pending'} disabled={workflowLocked || state !== 'ready'} onClick={() => void submitCurrent()}>
					{actionableQuote.operation === 'migrate-shares' ? `Submit migration to ${actionableQuote.targetOutcomeIndexes.length.toString()} child ${actionableQuote.targetOutcomeIndexes.length === 1 ? 'branch' : 'branches'}` : 'Submit settlement transaction'}
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
	slippage,
	transactionValidityMinutes,
	quote,
	state,
	receiptWarning,
	transactionHash,
	externallyLocked,
	nowSeconds,
	setMode,
	setSide,
	setAmount,
	setSlippage,
	setTransactionValidityMinutes,
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
	slippage: string
	transactionValidityMinutes: string
	quote: Quote | undefined
	state: TransactionState
	receiptWarning: string | undefined
	transactionHash: Hash | undefined
	externallyLocked: boolean
	nowSeconds: bigint
	setMode(value: 'entry' | 'exit'): void
	setSide(value: 'YES' | 'NO'): void
	setAmount(value: string): void
	setSlippage(value: string): void
	setTransactionValidityMinutes(value: string): void
	simulate(): Promise<void>
	approve(): Promise<void>
	submit(): Promise<void>
	retryBalances(): Promise<void>
}) {
	const yesPercent = market.yesReserve + market.noReserve === 0n ? 0 : bigintToSafeNumber((market.noReserve * 1_000n) / (market.yesReserve + market.noReserve), 'Conditional YES tenths') / 10
	const oppositeOutcome = side === 'YES' ? 'NO' : 'YES'
	const closed = !marketAcceptsNewRisk(market, nowSeconds)
	const longBalance = side === 'YES' ? balances?.yes : balances?.no
	const maximumExit = balances === undefined || longBalance === undefined ? undefined : maximumInsuredExit({ longOutcome: side, longBalance, invalidBalance: balances.invalid, yesReserve: market.yesReserve, noReserve: market.noReserve, feeBps: market.feeBps })
	const parsedInput = parseUnitsOrUndefined(amount)
	const slippageBps = parseSlippageBps(slippage)
	const validityMinutes = parseTransactionValidityMinutes(transactionValidityMinutes)
	const exceedsInsurance = mode === 'exit' && parsedInput !== undefined && maximumExit !== undefined && parsedInput > maximumExit
	const entryPriceImpactBps = quote?.kind === 'entry' ? quote.value.result.conditionalYesBpsAfter - quote.value.result.conditionalYesBpsBefore : undefined
	const workflowLocked = externallyLocked || positionControlsWorkflowLocked(state, receiptWarning)
	const submitLabel = mode === 'entry' ? `Enter ${side}` : `Exit insured ${side}`
	const walletBalanceLabel = (value: bigint | undefined, outcome: ShareOutcome) => {
		if (value !== undefined) return formatOutcomeAmount(value, outcome)
		if (balanceState === 'loading') return 'Loading…'
		if (balanceState === 'error') return 'Unavailable'
		return 'Connect wallet'
	}
	return (
		<div class='operation-block' aria-busy={balanceState === 'loading'}>
			<ProbabilityBar yesPercent={yesPercent} />
			<dl class='metrics'>
				<div>
					<dt>Wallet YES</dt>
					<dd>{walletBalanceLabel(balances?.yes, 'YES')}</dd>
				</div>
				<div>
					<dt>Wallet NO</dt>
					<dd>{walletBalanceLabel(balances?.no, 'NO')}</dd>
				</div>
				<div>
					<dt>Wallet INVALID</dt>
					<dd>{walletBalanceLabel(balances?.invalid, 'INVALID')}</dd>
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
			<ExecutionProtectionFields slippage={slippage} validityMinutes={transactionValidityMinutes} disabled={closed || workflowLocked} onSlippageInput={setSlippage} onValidityInput={setTransactionValidityMinutes} />
			{mode !== 'exit' || maximumExit === undefined ? null : (
				<p>
					Maximum insured {side} exit: {formatOutcomeAmount(maximumExit, side)}.
				</p>
			)}
			{exceedsInsurance ? (
				<p class='error' role='alert'>
					{insuredExitLimitMessage(parsedInput ?? 0n, maximumExit ?? 0n, balances?.invalid ?? 0n)}
				</p>
			) : null}
			{quote === undefined ? null : renderLiveTradeSummary(quote, side)}
			{mode === 'exit' && balances?.approved === false ? (
				<>
					<p>This ERC-1155 approval covers every token ID in the pool’s share token, including other universe branches. Revoke it through a compatible wallet or share-token contract interface when it is no longer needed.</p>
					<button class='primary-action' aria-busy={state === 'preparing' || state === 'approval' || state === 'approval-pending'} disabled={closed || balanceState !== 'ready' || workflowLocked} onClick={approve}>
						Approve router for all outcome tokens
					</button>
				</>
			) : null}
			{!(mode === 'exit' && balances?.approved === false) && quote === undefined ? (
				<button
					class='primary-action'
					aria-busy={state === 'simulating'}
					disabled={closed || balanceState !== 'ready' || balances === undefined || parsedInput === undefined || parsedInput === 0n || slippageBps === undefined || validityMinutes === undefined || exceedsInsurance || state === 'simulating' || workflowLocked}
					onClick={simulate}
				>
					{state === 'simulating' ? `Simulating ${mode === 'entry' ? `Enter ${side}` : `insured ${side} exit`}…` : 'Preview trade'}
				</button>
			) : null}
			{!(mode === 'exit' && balances?.approved === false) && quote !== undefined ? (
				<button class='primary-action' aria-busy={state === 'submitting' || state === 'pending'} disabled={workflowLocked || closed || state !== 'ready'} onClick={submit}>
					{submitLabel}
				</button>
			) : null}
			<p role='status' aria-live='polite'>
				{stateLabel(state, mode === 'entry' ? `Enter ${side}` : `Insured ${side} exit`)}
			</p>
			{transactionHash === undefined ? null : (
				<p class='transaction-hash'>
					<span>Transaction</span>
					<code title={transactionHash}>{transactionHash}</code>
				</p>
			)}
			{receiptWarning === undefined ? null : (
				<p class='error broadcast-warning' role='alert'>
					{receiptWarning}
				</p>
			)}
			<details class='trade-breakdown pool-mechanics'>
				<summary>Pool and reserve details</summary>
				{mode === 'entry' ? (
					<p class='pool-mint-note'>
						Submitted ETH goes to Statoblast security pool <SecurityPoolAddressLink value={market.pool} disabled={workflowLocked} />. That exact pool reconciles collateral and mints complete-set shares at its live rate.
					</p>
				) : null}
				<dl class='metrics quote'>
					<div>
						<dt>YES reserve</dt>
						<dd>{formatOutcomeAmount(market.yesReserve, 'YES')}</dd>
					</div>
					<div>
						<dt>NO reserve</dt>
						<dd>{formatOutcomeAmount(market.noReserve, 'NO')}</dd>
					</div>
				</dl>
			</details>
			{quote === undefined ? null : (
				<details class='trade-breakdown'>
					<summary>Full trade breakdown</summary>
					<dl class='metrics quote'>
						<div>
							<dt>Simulation block</dt>
							<dd>{quote.value.blockNumber.toString()}</dd>
						</div>
						<div>
							<dt>Complete-set shares</dt>
							<dd>{formatShareAmount(quote.value.result.completeSetShares)}</dd>
						</div>
						<div>
							<dt>{quote.kind === 'entry' ? 'Opposite outcome swapped' : `${side} swapped`}</dt>
							<dd>{formatOutcomeAmount(quote.kind === 'entry' ? quote.value.result.oppositeSharesSwapped : quote.value.result.longSharesSwapped, quote.kind === 'entry' ? oppositeOutcome : side)}</dd>
						</div>
						<div>
							<dt>{quote.kind === 'entry' ? `Additional ${side} received` : `Total ${side} required`}</dt>
							<dd>{formatOutcomeAmount(quote.kind === 'entry' ? quote.value.result.additionalLongShares : quote.value.result.totalLongShares, side)}</dd>
						</div>
						<div>
							<dt>{quote.kind === 'entry' ? `Total ${side} delivered` : 'INVALID required'}</dt>
							<dd>{formatOutcomeAmount(quote.kind === 'entry' ? quote.value.result.totalLongShares : quote.value.result.invalidInsurance, quote.kind === 'entry' ? side : 'INVALID')}</dd>
						</div>
						<div>
							<dt>{quote.kind === 'entry' ? 'INVALID received' : 'Estimated ETH out'}</dt>
							<dd>{quote.kind === 'entry' ? formatOutcomeAmount(quote.value.result.invalidInsurance, 'INVALID') : `${formatUnits(quote.value.result.ethOut)} ETH`}</dd>
						</div>
						<div>
							<dt>AMM fee</dt>
							<dd>{formatOutcomeAmount(quote.value.result.feeAmount, quote.kind === 'entry' ? oppositeOutcome : side)}</dd>
						</div>
						<div>
							<dt>{quote.kind === 'entry' ? `Minimum ${side} received` : `Maximum ${side} required`}</dt>
							<dd>{formatOutcomeAmount(quote.kind === 'entry' ? quote.value.minimumLongShares : quote.value.maximumLongShares, side)}</dd>
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
						<div>
							<dt>Slippage tolerance</dt>
							<dd>{formatUnits(quote.value.slippageBps, 2, 2)}%</dd>
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
				</details>
			)}
		</div>
	)
}
