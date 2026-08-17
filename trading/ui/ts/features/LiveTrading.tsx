import { useEffect, useId, useMemo, useRef, useState } from 'preact/hooks'
import type { Address, Hash, PublicClient, WalletClient } from '@zoltar/shared/ethereum'
import { bigintToSafeNumber, formatBpsMultiplier, formatCapacityOwnership, formatEthPerShare, formatMintingCapacity, formatOutcomeAmount, formatShareAmount, formatUnits, parseUnitsOrUndefined, shortAddress } from '../app/format.ts'
import { createExclusiveWorkflowGuard, createLatestRequestGuard } from '../app/latestRequest.ts'
import { AddressValue, SecurityPoolAddressLink, Status } from '../components/Status.tsx'
import { ProbabilityBar } from '../components/ProbabilityBar.tsx'
import { ForkMigrationTargets } from './ForkMigrationTargets.tsx'
import type { DeploymentConfiguration } from '../protocol/config.ts'
import { loadForkMigrationContext, type ForkMigrationContext, type ForkTarget } from '../protocol/forks.ts'
import {
	approveLpRouter,
	approveRouter,
	createTradingPublicClient,
	marketAcceptsNewRisk,
	marketNewRiskBlocker,
	publicErrorMessage,
	settlementAvailability,
	shareBalanceScope,
	simulateLiquidity,
	simulateSettlement,
	submitFreshLiquidity,
	submitFreshSettlement,
	type LiquidityOperation,
	type LiveBalances,
	type LiveMarket,
	type MarketLifecycle,
	type SettlementOperation,
	type ShareOutcome,
} from '../protocol/live.ts'
import { maximumInsuredExit } from '../../../ts/sdk/positions.ts'
import {
	approvalFailureTransition,
	broadcastUncertainMessage,
	failedSubmissionTransition,
	livePairInitialized,
	observeKnownReceipt,
	parseSlippageBps,
	parseTransactionValidityMinutes,
	positionControlsWorkflowLocked,
	useLiveTradingController,
	type BalanceState,
	type GuardedWalletWrite,
	type PortfolioBalanceEntry,
	type Quote,
	type QuoteContext,
	type TransactionState,
	type WalletSummaryState,
} from './liveTradingController.ts'

export {
	approvalFailureTransition,
	broadcastUncertainMessage,
	discoveryCommitAllowed,
	failedSubmissionTransition,
	filterMarketsByUniverse,
	livePairInitialized,
	marketSelectionAfterDiscovery,
	observeKnownReceipt,
	parseSlippageBps,
	parseTransactionValidityMinutes,
	positionControlsWorkflowLocked,
	securityPoolAddressFromRoute,
	walletSummaryAvailability,
	walletSummaryDiscoveryRetryStart,
	walletSummaryRefreshState,
} from './liveTradingController.ts'
export type { PortfolioBalanceEntry, WalletSummaryState } from './liveTradingController.ts'

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

export function LiveSecurityPoolDetails({ market, refreshError, refreshing = false, retry, workflowLocked, connectionMessage }: { market: LiveMarket; refreshError?: string | undefined; refreshing?: boolean; retry(): void; workflowLocked: boolean; connectionMessage?: string | undefined }) {
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
			{connectionMessage === undefined ? null : (
				<p class='error' role='alert'>
					{connectionMessage}
				</p>
			)}
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

export function LiveTrading({
	route,
	configuration,
	configurationError,
	selectedUniverseId,
	onUniversesChange = () => undefined,
	onWorkflowLockChange,
	onWalletSummaryChange = ignoreWalletSummaryChange,
	walletSummaryRetryNonce = 0,
	walletConnectRequestNonce,
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
	walletConnectRequestNonce?: number
	onDeploymentRetry?(): void
}) {
	const { wallet, balances, discovery, position, workflow } = useLiveTradingController({
		route,
		configuration,
		configurationError,
		selectedUniverseId,
		onUniversesChange,
		onWorkflowLockChange,
		onWalletSummaryChange,
		walletSummaryRetryNonce,
		defaultSlippage: DEFAULT_SLIPPAGE_PERCENT,
		defaultValidityMinutes: DEFAULT_TRANSACTION_VALIDITY_MINUTES,
	})
	const { account, walletClient, connect, refreshWalletSummaryAfterReceipt, walletContextIsCurrent, executeWithCurrentWalletContext, createGuardedWalletWrite } = wallet
	const { balanceError, portfolioBalanceState, portfolioBalanceError, visiblePortfolioEntries, selectedBalances, selectedBalanceState, retryBalances, retryPortfolioBalances, refreshBalancesAfterApproval } = balances
	const { visibleMarkets, selected, selectedPairInitialized, routePool, discoveryState, discoveryError, marketPage, marketListRef, marketDetailRef, nowSeconds, refresh, refreshFromControl, loadMarketPage, focusSection, selectMarket } = discovery
	const { parsedAmount, mode, setMode, side, setSide, amount, setAmount, slippage, setSlippage, transactionValidityMinutes, setTransactionValidityMinutes, quote, state, positionHash, message, positionReceiptWarning, simulate, approve, submit } = position
	const { workflowLocked, updateLiquidityWorkflowLock } = workflow
	const previousWalletConnectRequestNonce = useRef(walletConnectRequestNonce)
	useEffect(() => {
		if (walletConnectRequestNonce === undefined) return
		if (previousWalletConnectRequestNonce.current === walletConnectRequestNonce) return
		previousWalletConnectRequestNonce.current = walletConnectRequestNonce
		void connect()
	}, [connect, walletConnectRequestNonce])
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
			<button key={market.pool} class='live-market-button' aria-pressed={selected?.pool === market.pool} disabled={workflowLocked} onClick={() => selectMarket(market)}>
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
		if (selected !== undefined) return <LiveSecurityPoolDetails market={selected} refreshError={discoveryState === 'error' ? (discoveryError ?? 'unknown discovery error') : undefined} refreshing={discoveryState === 'loading'} retry={refreshFromControl} workflowLocked={workflowLocked} connectionMessage={message} />
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
				{message === undefined ? null : (
					<p class='error' role='alert'>
						{message}
					</p>
				)}
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
					{walletConnectRequestNonce === undefined ? (
						<button class='wallet-button' disabled={workflowLocked} onClick={connect}>
							{account === undefined ? 'Connect wallet' : shortAddress(account)}
						</button>
					) : null}
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
				{walletConnectRequestNonce === undefined ? (
					<button class='wallet-button' disabled={workflowLocked} onClick={connect}>
						{account === undefined ? 'Connect wallet' : shortAddress(account)}
					</button>
				) : null}
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
									walletContextIsCurrent={walletContextIsCurrent}
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
									walletContextIsCurrent={walletContextIsCurrent}
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
									setMode={setMode}
									setSide={setSide}
									setAmount={setAmount}
									setSlippage={setSlippage}
									setTransactionValidityMinutes={setTransactionValidityMinutes}
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
	if (quote.operation === 'migrate-shares') return quote.sourceOutcome === sourceOutcome && quote.targetOutcomeIndexes.length === targetOutcomeIndexes.length && quote.targetOutcomeIndexes.every(target => targetOutcomeIndexes.includes(target))
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
