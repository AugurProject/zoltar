import type { Hash } from '@zoltar/core-shared/evm/ethereum'
import { bigintToSafeNumber, formatRoundedUnits, formatUnits, parseUnitsOrUndefined } from '../lib/format.js'
import { attoSharesToCollateralAttoEth, averagePriceBps, collateralAttoEthToAttoShares, formatCollateralEth, formatCompleteSetValue, formatOutcomeValue } from '../lib/shareValue.js'
import { ProbabilityBar } from '../components/ProbabilityBar.js'
import { marketAcceptsNewRisk, type LiveBalances, type LiveMarket, type ShareOutcome } from '../protocol/live.js'
import { maximumInsuredExit } from '@zoltar/trading-shared/trading/positions'
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
	message,
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
	message: string | undefined
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
	submit(): Promise<void>
	retryBalances(): Promise<void>
}) {
	const yesPercent = market.yesReserve + market.noReserve === 0n ? 0 : bigintToSafeNumber((market.noReserve * 1_000n) / (market.yesReserve + market.noReserve), 'Conditional YES tenths') / 10
	const oppositeOutcome = side === 'YES' ? 'NO' : 'YES'
	const closed = !marketAcceptsNewRisk(market, nowSeconds)
	const longBalance = side === 'YES' ? balances?.yes : balances?.no
	const maximumExit = balances === undefined || longBalance === undefined ? undefined : maximumInsuredExit({ longOutcome: side, longBalance, invalidBalance: balances.invalid, yesReserve: market.yesReserve, noReserve: market.noReserve, feeBps: market.feeBps })
	const parsedInput = parseUnitsOrUndefined(amount)
	// Exit amounts are entered as complete-set collateral value, so convert them to the share amount the router redeems.
	const exitAttoShares = mode === 'exit' && parsedInput !== undefined ? collateralAttoEthToAttoShares(parsedInput, market) : undefined
	const slippageBps = parseSlippageBps(slippage)
	const validityMinutes = parseTransactionValidityMinutes(transactionValidityMinutes)
	const exceedsInsurance = exitAttoShares !== undefined && maximumExit !== undefined && exitAttoShares > maximumExit
	const exitTooSmall = mode === 'exit' && parsedInput !== undefined && parsedInput > 0n && (exitAttoShares === undefined || attoSharesToCollateralAttoEth(exitAttoShares, market) === 0n)
	const entryPriceImpactBps = quote?.kind === 'entry' ? quote.value.result.conditionalYesBpsAfter - quote.value.result.conditionalYesBpsBefore : undefined
	const averagePrice = quote?.kind === 'entry' ? averagePriceBps(quote.value.amount, quote.value.result.totalLongShares, market) : undefined
	const workflowLocked = externallyLocked || positionControlsWorkflowLocked(state, receiptWarning)
	// After a receipt the workflow stays locked until the market and balances have been re-read; say so instead of showing a silent disabled form.
	const revalidatingAfterReceipt = state === 'confirmed' && externallyLocked
	const submitLabel = mode === 'entry' ? workflowCopy.enterOutcome(side) : workflowCopy.exitInsuredOutcome(side)
	const stateText = stateLabel(state, mode === 'entry' ? workflowCopy.enterOutcome(side) : workflowCopy.insuredOutcomeExit(side))
	const statusText = revalidatingAfterReceipt && stateText !== undefined ? workflowCopy.revalidatingAfterReceipt(stateText) : stateText
	const walletBalanceLabel = (value: bigint | undefined, outcome: ShareOutcome) => {
		if (value !== undefined) return formatOutcomeValue(value, outcome, market)
		if (balanceState === 'loading') return appCopy.loadingBalances
		if (balanceState === 'error') return appCopy.unavailable
		return appCopy.connectWallet
	}
	return (
		<div class='operation-block' aria-busy={balanceState === 'loading' || revalidatingAfterReceipt}>
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
				<span>{mode === 'entry' ? workflowCopy.ethAmount : workflowCopy.completeSetValueToRedeem}</span>
				<div class='amount-input'>
					<input value={amount} disabled={closed || workflowLocked} inputMode='decimal' onInput={event => setAmount(event.currentTarget.value)} />
					<span>{workflowCopy.eth}</span>
				</div>
			</label>
			<ExecutionProtectionFields slippage={slippage} validityMinutes={transactionValidityMinutes} disabled={closed || workflowLocked} onSlippageInput={setSlippage} onValidityInput={setTransactionValidityMinutes} />
			{mode !== 'exit' || maximumExit === undefined ? null : <p>{workflowCopy.maximumInsuredExit(side, formatCollateralEth(maximumExit, market, 'down'))}</p>}
			{exceedsInsurance ? (
				<p class='error' role='alert'>
					{insuredExitLimitMessage(exitAttoShares ?? 0n, maximumExit ?? 0n, balances?.invalid ?? 0n, market)}
				</p>
			) : null}
			{exitTooSmall && !exceedsInsurance ? (
				<p class='error' role='alert'>
					{workflowCopy.amountTooSmall}
				</p>
			) : null}
			{quote === undefined ? null : renderLiveTradeSummary(quote, side)}
			{quote === undefined ? (
				<TransactionActionButton
					disabled={closed || balanceState !== 'ready' || balances === undefined || parsedInput === undefined || parsedInput === 0n || slippageBps === undefined || validityMinutes === undefined || exceedsInsurance || exitTooSmall || workflowLocked}
					idleLabel={workflowCopy.previewTrade}
					pending={state === 'simulating'}
					pendingLabel={workflowCopy.simulatingTrade(mode, side)}
					onClick={simulate}
				/>
			) : null}
			{quote !== undefined ? <TransactionActionButton disabled={workflowLocked || closed || state !== 'ready'} idleLabel={submitLabel} pending={state === 'submitting' || state === 'pending'} pendingLabel={workflowCopy.submittingTrade} onClick={submit} /> : null}
			<p role='status' aria-live='polite'>
				{statusText}
			</p>
			{transactionHash === undefined ? null : <TradingTransactionHash hash={transactionHash} />}
			<ErrorNotice message={receiptWarning} />
			<ErrorNotice message={message} />
			{quote === undefined ? null : (
				<details class='trade-breakdown'>
					<summary>{workflowCopy.fullTradeBreakdown}</summary>
					<dl class='metrics quote'>
						<div>
							<dt>{workflowCopy.simulationBlock}</dt>
							<dd>{quote.value.blockNumber.toString()}</dd>
						</div>
						<div>
							<dt>{workflowCopy.completeSets}</dt>
							<dd>{formatCompleteSetValue(quote.value.result.completeSetShares, market)}</dd>
						</div>
						<div>
							<dt>{quote.kind === 'entry' ? workflowCopy.oppositeOutcomeSwapped : workflowCopy.outcomeSwapped(side)}</dt>
							<dd>{formatOutcomeValue(quote.kind === 'entry' ? quote.value.result.oppositeSharesSwapped : quote.value.result.longSharesSwapped, quote.kind === 'entry' ? oppositeOutcome : side, market)}</dd>
						</div>
						<div>
							<dt>{quote.kind === 'entry' ? workflowCopy.additionalOutcomeReceived(side) : workflowCopy.totalOutcomeRequired(side)}</dt>
							<dd>{formatOutcomeValue(quote.kind === 'entry' ? quote.value.result.additionalLongShares : quote.value.result.totalLongShares, side, market)}</dd>
						</div>
						<div>
							<dt>{quote.kind === 'entry' ? workflowCopy.totalOutcomeDelivered(side) : workflowCopy.invalidRequiredUppercase}</dt>
							<dd>{formatOutcomeValue(quote.kind === 'entry' ? quote.value.result.totalLongShares : quote.value.result.invalidInsurance, quote.kind === 'entry' ? side : 'INVALID', market)}</dd>
						</div>
						<div>
							<dt>{quote.kind === 'entry' ? workflowCopy.invalidReceived : workflowCopy.estimatedEthOut}</dt>
							<dd>{quote.kind === 'entry' ? formatOutcomeValue(quote.value.result.invalidInsurance, workflowCopy.invalid, market) : `${formatRoundedUnits(quote.value.result.ethOut)} ${workflowCopy.eth}`}</dd>
						</div>
						<div>
							<dt>{workflowCopy.ammFee}</dt>
							<dd>{formatOutcomeValue(quote.value.result.feeAmount, quote.kind === 'entry' ? oppositeOutcome : side, market, 8)}</dd>
						</div>
						<div>
							<dt>{quote.kind === 'entry' ? workflowCopy.minimumOutcomeReceived(side) : workflowCopy.maximumOutcomeRequired(side)}</dt>
							<dd>{formatOutcomeValue(quote.kind === 'entry' ? quote.value.minimumLongShares : quote.value.maximumLongShares, side, market)}</dd>
						</div>
						{quote.kind === 'entry' ? (
							<div>
								<dt>{workflowCopy.averageOutcomePrice(side)}</dt>
								<dd>{averagePrice === undefined ? workflowCopy.unavailableMetric : `${formatUnits(averagePrice, 2, 2)}%`}</dd>
							</div>
						) : (
							<div>
								<dt>{workflowCopy.minimumEthReceived}</dt>
								<dd>
									{formatUnits(quote.value.minimumEth)} {workflowCopy.eth}
								</dd>
							</div>
						)}
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
