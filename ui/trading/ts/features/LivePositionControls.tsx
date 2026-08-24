import type { Hash } from '@zoltar/shared/ethereum'
import { bigintToSafeNumber, formatEthPerShare, formatOutcomeAmount, formatShareAmount, formatUnits, parseUnitsOrUndefined } from '../lib/format.js'
import { SecurityPoolAddressLink } from '../components/TradingAddress.js'
import { ProbabilityBar } from '../components/ProbabilityBar.js'
import { marketAcceptsNewRisk, type LiveBalances, type LiveMarket, type ShareOutcome } from '../protocol/live.js'
import { maximumInsuredExit } from '@zoltar/shared/trading/positions'
import * as workflowCopy from '../copy/workflows.js'
import * as appCopy from '../copy/app.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { parseSlippageBps, parseTransactionValidityMinutes, positionControlsWorkflowLocked } from './liveTradingControllerHelpers.js'
import type { BalanceState, Quote, TransactionState } from './live/liveTradingTypes.js'
import { BalanceLoadError, ExecutionProtectionFields, formatTimestamp, renderLiveTradeSummary, stateLabel, TradingTransactionHash } from './LiveTradingTransactionUi.js'
import { insuredExitLimitMessage } from './LiveSettlementModel.js'

export function LivePositionControls({
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
	const submitLabel = mode === 'entry' ? workflowCopy.enterOutcome(side) : workflowCopy.exitInsuredOutcome(side)
	const walletBalanceLabel = (value: bigint | undefined, outcome: ShareOutcome) => {
		if (value !== undefined) return formatOutcomeAmount(value, outcome)
		if (balanceState === 'loading') return appCopy.loadingBalances
		if (balanceState === 'error') return appCopy.unavailable
		return appCopy.connectWallet
	}
	return (
		<div class='operation-block' aria-busy={balanceState === 'loading'}>
			<ProbabilityBar yesPercent={yesPercent} />
			<dl class='metrics'>
				<div>
					<dt>{workflowCopy.walletYes}</dt>
					<dd>{walletBalanceLabel(balances?.yes, workflowCopy.yes)}</dd>
				</div>
				<div>
					<dt>{workflowCopy.walletNo}</dt>
					<dd>{walletBalanceLabel(balances?.no, workflowCopy.no)}</dd>
				</div>
				<div>
					<dt>{workflowCopy.walletInvalid}</dt>
					<dd>{walletBalanceLabel(balances?.invalid, 'INVALID')}</dd>
				</div>
			</dl>
			{balanceState === 'loading' ? <p role='status'>{workflowCopy.refreshingWalletBalances}</p> : null}
			{balanceState === 'error' ? <BalanceLoadError message={workflowCopy.walletBalancesUnavailable(balanceError ?? workflowCopy.balanceRefreshFailed)} retry={retryBalances} disabled={workflowLocked} /> : null}
			<div class='segmented' aria-label={workflowCopy.livePositionOperation}>
				<button aria-pressed={mode === 'entry'} disabled={closed || workflowLocked} onClick={() => setMode('entry')}>
					{workflowCopy.enter}
				</button>
				<button aria-pressed={mode === 'exit'} disabled={closed || workflowLocked} onClick={() => setMode('exit')}>
					{workflowCopy.exit}
				</button>
			</div>
			<div class='side-picker' aria-label={workflowCopy.outcome}>
				<button aria-pressed={side === 'YES'} disabled={closed || workflowLocked} onClick={() => setSide('YES')}>
					{workflowCopy.yes}
				</button>
				<button aria-pressed={side === 'NO'} disabled={closed || workflowLocked} onClick={() => setSide('NO')}>
					{workflowCopy.no}
				</button>
			</div>
			<label class='field'>
				<span>{mode === 'entry' ? workflowCopy.ethAmount : workflowCopy.completeSetSharesToRedeem}</span>
				<div class='amount-input'>
					<input value={amount} disabled={closed || workflowLocked} inputMode='decimal' onInput={event => setAmount(event.currentTarget.value)} />
					<span>{mode === 'entry' ? workflowCopy.eth : workflowCopy.shares}</span>
				</div>
			</label>
			<ExecutionProtectionFields slippage={slippage} validityMinutes={transactionValidityMinutes} disabled={closed || workflowLocked} onSlippageInput={setSlippage} onValidityInput={setTransactionValidityMinutes} />
			{mode !== 'exit' || maximumExit === undefined ? null : <p>{workflowCopy.maximumInsuredExit(side, formatOutcomeAmount(maximumExit, side))}</p>}
			{exceedsInsurance ? (
				<p class='error' role='alert'>
					{insuredExitLimitMessage(parsedInput ?? 0n, maximumExit ?? 0n, balances?.invalid ?? 0n)}
				</p>
			) : null}
			{quote === undefined ? null : renderLiveTradeSummary(quote, side)}
			{mode === 'exit' && balances?.approved === false ? (
				<>
					<p>{workflowCopy.erc1155ApprovalScopeWarning}</p>
					<TransactionActionButton disabled={closed || balanceState !== 'ready' || workflowLocked} idleLabel={workflowCopy.approveOutcomeTokens} pending={state === 'preparing' || state === 'approval' || state === 'approval-pending'} pendingLabel={workflowCopy.approvingRouter} onClick={approve} />
				</>
			) : null}
			{!(mode === 'exit' && balances?.approved === false) && quote === undefined ? (
				<TransactionActionButton
					disabled={closed || balanceState !== 'ready' || balances === undefined || parsedInput === undefined || parsedInput === 0n || slippageBps === undefined || validityMinutes === undefined || exceedsInsurance || workflowLocked}
					idleLabel={workflowCopy.previewTrade}
					pending={state === 'simulating'}
					pendingLabel={workflowCopy.simulatingTrade(mode, side)}
					onClick={simulate}
				/>
			) : null}
			{!(mode === 'exit' && balances?.approved === false) && quote !== undefined ? <TransactionActionButton disabled={workflowLocked || closed || state !== 'ready'} idleLabel={submitLabel} pending={state === 'submitting' || state === 'pending'} pendingLabel={workflowCopy.submittingTrade} onClick={submit} /> : null}
			<p role='status' aria-live='polite'>
				{stateLabel(state, mode === 'entry' ? workflowCopy.enterOutcome(side) : workflowCopy.insuredOutcomeExit(side))}
			</p>
			{transactionHash === undefined ? null : <TradingTransactionHash hash={transactionHash} />}
			<ErrorNotice message={receiptWarning} />
			<details class='trade-breakdown pool-mechanics'>
				<summary>{workflowCopy.poolAndReserveDetails}</summary>
				{mode === 'entry' ? (
					<p class='pool-mint-note'>
						{workflowCopy.submittedEthPoolPrefix} <SecurityPoolAddressLink value={market.pool} disabled={workflowLocked} />. {workflowCopy.submittedEthPoolSuffix}
					</p>
				) : null}
				<dl class='metrics quote'>
					<div>
						<dt>{workflowCopy.yesReserve}</dt>
						<dd>{formatOutcomeAmount(market.yesReserve, workflowCopy.yes)}</dd>
					</div>
					<div>
						<dt>{workflowCopy.noReserve}</dt>
						<dd>{formatOutcomeAmount(market.noReserve, workflowCopy.no)}</dd>
					</div>
				</dl>
			</details>
			{quote === undefined ? null : (
				<details class='trade-breakdown'>
					<summary>{workflowCopy.fullTradeBreakdown}</summary>
					<dl class='metrics quote'>
						<div>
							<dt>{workflowCopy.simulationBlock}</dt>
							<dd>{quote.value.blockNumber.toString()}</dd>
						</div>
						<div>
							<dt>{workflowCopy.completeSetShares}</dt>
							<dd>{formatShareAmount(quote.value.result.completeSetShares)}</dd>
						</div>
						<div>
							<dt>{quote.kind === 'entry' ? workflowCopy.oppositeOutcomeSwapped : workflowCopy.outcomeSwapped(side)}</dt>
							<dd>{formatOutcomeAmount(quote.kind === 'entry' ? quote.value.result.oppositeSharesSwapped : quote.value.result.longSharesSwapped, quote.kind === 'entry' ? oppositeOutcome : side)}</dd>
						</div>
						<div>
							<dt>{quote.kind === 'entry' ? workflowCopy.additionalOutcomeReceived(side) : workflowCopy.totalOutcomeRequired(side)}</dt>
							<dd>{formatOutcomeAmount(quote.kind === 'entry' ? quote.value.result.additionalLongShares : quote.value.result.totalLongShares, side)}</dd>
						</div>
						<div>
							<dt>{quote.kind === 'entry' ? workflowCopy.totalOutcomeDelivered(side) : workflowCopy.invalidRequiredUppercase}</dt>
							<dd>{formatOutcomeAmount(quote.kind === 'entry' ? quote.value.result.totalLongShares : quote.value.result.invalidInsurance, quote.kind === 'entry' ? side : 'INVALID')}</dd>
						</div>
						<div>
							<dt>{quote.kind === 'entry' ? workflowCopy.invalidReceived : workflowCopy.estimatedEthOut}</dt>
							<dd>{quote.kind === 'entry' ? formatOutcomeAmount(quote.value.result.invalidInsurance, workflowCopy.invalid) : `${formatUnits(quote.value.result.ethOut)} ${workflowCopy.eth}`}</dd>
						</div>
						<div>
							<dt>{workflowCopy.ammFee}</dt>
							<dd>{formatOutcomeAmount(quote.value.result.feeAmount, quote.kind === 'entry' ? oppositeOutcome : side)}</dd>
						</div>
						<div>
							<dt>{quote.kind === 'entry' ? workflowCopy.minimumOutcomeReceived(side) : workflowCopy.maximumOutcomeRequired(side)}</dt>
							<dd>{formatOutcomeAmount(quote.kind === 'entry' ? quote.value.minimumLongShares : quote.value.maximumLongShares, side)}</dd>
						</div>
						<div>
							<dt>{quote.kind === 'entry' ? workflowCopy.averageEthPerLongShare : workflowCopy.minimumEthReceived}</dt>
							<dd>{quote.kind === 'entry' ? formatEthPerShare(quote.value.amount, quote.value.result.totalLongShares) : `${formatUnits(quote.value.minimumEth)} ${workflowCopy.eth}`}</dd>
						</div>
						<div>
							<dt>{workflowCopy.simulatedCompleteSetRate}</dt>
							<dd>{formatEthPerShare(quote.kind === 'entry' ? quote.value.amount : quote.value.result.ethOut, quote.value.result.completeSetShares)}</dd>
						</div>
						<div>
							<dt>{workflowCopy.deadline}</dt>
							<dd>{formatTimestamp(quote.value.deadline)}</dd>
						</div>
						<div>
							<dt>{workflowCopy.slippageTolerance}</dt>
							<dd>{formatUnits(quote.value.slippageBps, 2, 2)}%</dd>
						</div>
						{quote.kind === 'entry' ? (
							<>
								<div>
									<dt>{workflowCopy.conditionalYesBeforeAfter}</dt>
									<dd>
										{formatUnits(quote.value.result.conditionalYesBpsBefore, 2, 2)}% / {formatUnits(quote.value.result.conditionalYesBpsAfter, 2, 2)}%
									</dd>
								</div>
								<div>
									<dt>{workflowCopy.conditionalYesPriceImpact}</dt>
									<dd>{entryPriceImpactBps === undefined ? workflowCopy.unavailableMetric : `${entryPriceImpactBps > 0n ? workflowCopy.positiveSign : ''}${formatUnits(entryPriceImpactBps, 2, 2)} ${workflowCopy.percentagePoints}`}</dd>
								</div>
							</>
						) : null}
					</dl>
				</details>
			)}
		</div>
	)
}
