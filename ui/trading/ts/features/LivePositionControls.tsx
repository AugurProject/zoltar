import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { FormField } from '@zoltar/ui-core-shared/components/FormField.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { BackingDetails } from './BackingDetails.js'
import { bigintToSafeNumber, type Hash } from '@zoltar/core-shared/evm/ethereum'
import { formatTrimmedUnits } from '@zoltar/ui-core-shared/lib/formatters.js'
import { tryParseNonNegativeDecimalInput } from '@zoltar/ui-core-shared/forms/decimal.js'
import { formatRoundedUnits } from '../lib/format.js'
import { attoSharesToCollateralAttoEth, averagePriceBps, collateralAttoEthToAttoShares, formatCollateralEth, formatCompleteSetQuantity, formatOutcomeQuantity } from '../lib/shareValue.js'
import { ProbabilityBar } from '../components/ProbabilityBar.js'
import { marketAcceptsNewRisk, type LiveBalances, type LiveMarket, type ShareOutcome } from '../protocol/live.js'
import { maximumInsuredExit } from '@zoltar/trading-shared/trading/positions'
import * as workflowCopy from '../copy/workflows.js'
import * as appCopy from '../copy/app.js'
import { useId } from 'preact/hooks'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { TransactionActionButton, TransactionActionGroup } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { ViewTabs } from '@zoltar/ui-core-shared/components/ViewTabs.js'
import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js'
import { parseSlippageBps, parseTransactionValidityMinutes, positionControlsWorkflowLocked } from './liveTradingControllerHelpers.js'
import type { BalanceState, Quote, TransactionState } from './live/liveTradingTypes.js'
import { BalanceLoadError, ExecutionProtectionFields, renderLiveTradeSummary, stateLabel, TradingTransactionHash } from './LiveTradingTransactionUi.js'
import { insuredExitLimitMessage } from './LiveSettlementModel.js'
import { resolvePositionSimulateAvailability, resolvePositionSubmitAvailability, resolveActionGroupMessage } from './live/actionAvailability.js'
import { useFocusOnKeyChange } from './live/useFocusOnKeyChange.js'

export function LivePositionControls({
	market,
	balances,
	balanceState,
	balanceError,
	walletConnected,
	networkMismatchReason,
	walletEthAttoEth,
	mode,
	side,
	amount,
	amountError,
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
	walletConnected: boolean
	networkMismatchReason: string | undefined
	walletEthAttoEth: bigint | undefined
	mode: 'entry' | 'exit'
	side: 'YES' | 'NO'
	amount: string
	amountError: string | undefined
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
	const parsedInput = tryParseNonNegativeDecimalInput(amount)
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
	const stateText = state === 'error' ? undefined : stateLabel(state, mode === 'entry' ? workflowCopy.enterOutcome(side) : workflowCopy.insuredOutcomeExit(side))
	const statusText = revalidatingAfterReceipt && stateText !== undefined ? workflowCopy.revalidatingAfterReceipt(stateText) : stateText
	const availabilityInputs = {
		walletConnected,
		networkMismatchReason,
		balanceState,
		mode,
		side,
		marketClosed: closed,
		enteredAmount: parsedInput,
		requestedAmount: mode === 'entry' ? parsedInput : exitAttoShares,
		amountError,
		walletEthAttoEth,
		outcomeBalance: longBalance,
		exceedsInsurance,
		exceedsInsuranceDetail: exceedsInsurance ? insuredExitLimitMessage(exitAttoShares ?? 0n, maximumExit ?? 0n, balances?.invalid ?? 0n, market) : undefined,
		exitTooSmall,
		protectionValid: slippageBps !== undefined && validityMinutes !== undefined,
		workflowLocked,
	}
	const simulateAvailability = resolvePositionSimulateAvailability(availabilityInputs)
	const submitAvailability = resolvePositionSubmitAvailability({ ...availabilityInputs, quoteReady: state === 'ready' })
	const actionAvailability = quote === undefined ? simulateAvailability : submitAvailability
	// Confirmation moves focus to the announced outcome so keyboard and screen-reader users land on the result.
	const outcomeRef = useFocusOnKeyChange<HTMLDivElement>(state === 'confirmed' ? transactionHash : undefined)
	const walletBalanceLabel = (value: bigint | undefined, outcome: ShareOutcome) => {
		if (value !== undefined) return formatOutcomeQuantity(value, outcome)
		if (balanceState === 'loading') return appCopy.loadingBalances
		if (balanceState === 'error') return appCopy.unavailable
		return appCopy.connectWallet
	}
	const amountId = useId()
	const controlsDisabled = closed || workflowLocked
	const quoteSide = quote?.kind === 'entry' ? oppositeOutcome : side
	const groupMessage = resolveActionGroupMessage(state, actionAvailability, statusText)
	return (
		<div className='position-controls' aria-busy={balanceState === 'loading' || revalidatingAfterReceipt}>
			<ProbabilityBar yesPercent={yesPercent} />
			<BackingDetails market={market} />
			<ul className='portfolio-holdings trade-holdings' aria-busy={balanceState === 'loading'}>
				<li className={`portfolio-holding-yes ${side === 'YES' ? 'selected-holding' : ''}`} data-outcome='yes'>
					<span className='holding-quantity'>{walletBalanceLabel(balances?.yes, workflowCopy.yes)}</span>
					{balances === undefined ? <small className='payout-caption'>{workflowCopy.walletYes}</small> : undefined}
				</li>
				<li className={`portfolio-holding-no ${side === 'NO' ? 'selected-holding' : ''}`} data-outcome='no'>
					<span className='holding-quantity'>{walletBalanceLabel(balances?.no, workflowCopy.no)}</span>
					{balances === undefined ? <small className='payout-caption'>{workflowCopy.walletNo}</small> : undefined}
				</li>
				<li data-outcome='invalid'>
					<span className='holding-quantity'>{walletBalanceLabel(balances?.invalid, 'INVALID')}</span>
					{balances === undefined ? <small className='payout-caption'>{workflowCopy.walletInvalid}</small> : undefined}
				</li>
			</ul>
			{balanceState === 'loading' && balances !== undefined ? <LoadingText>{appCopy.loadingBalances}</LoadingText> : undefined}
			{balanceState === 'error' && networkMismatchReason === undefined ? <BalanceLoadError message={workflowCopy.walletBalancesUnavailable(balanceError ?? workflowCopy.balanceRefreshFailed)} retry={retryBalances} disabled={workflowLocked} /> : null}
			<ViewTabs
				ariaLabel={workflowCopy.livePositionOperation}
				semantics='switcher'
				variant='segmented'
				size='compact'
				value={mode}
				onChange={setMode}
				options={[
					{ value: 'entry', label: workflowCopy.enter, disabled: controlsDisabled },
					{ value: 'exit', label: workflowCopy.exit, disabled: controlsDisabled },
				]}
			/>
			<ViewTabs
				ariaLabel={workflowCopy.outcome}
				className='outcome-picker'
				semantics='switcher'
				variant='segmented'
				size='compact'
				value={side}
				onChange={setSide}
				options={[
					{ value: 'YES', label: workflowCopy.yes, disabled: controlsDisabled },
					{ value: 'NO', label: workflowCopy.no, disabled: controlsDisabled },
				]}
			/>
			<FormField id={amountId} label={mode === 'entry' ? workflowCopy.ethAmount : workflowCopy.completeSetValueToRedeem}>
				<FormInput
					id={amountId}
					name='amount'
					value={amount}
					disabled={controlsDisabled}
					inputMode='decimal'
					adornment={workflowCopy.eth}
					error={amountError}
					hint={mode === 'exit' && maximumExit !== undefined ? workflowCopy.maximumInsuredExit(side, formatCollateralEth(maximumExit, market, 'down')) : undefined}
					onInput={event => setAmount(event.currentTarget.value)}
				/>
			</FormField>
			<ExecutionProtectionFields slippage={slippage} validityMinutes={transactionValidityMinutes} disabled={controlsDisabled} onSlippageInput={setSlippage} onValidityInput={setTransactionValidityMinutes} />
			{quote === undefined ? null : renderLiveTradeSummary(quote, side)}
			<div className='transaction-outcome' ref={outcomeRef} tabIndex={-1}>
				{transactionHash === undefined ? null : <TradingTransactionHash hash={transactionHash} />}
				<ErrorNotice message={receiptWarning} />
				<ErrorNotice message={message} />
				<TransactionActionGroup loading={actionAvailability.loading === true} message={groupMessage}>
					{quote === undefined ? <TransactionActionButton availability={simulateAvailability} idleLabel={workflowCopy.previewTrade} pending={state === 'simulating'} pendingLabel={workflowCopy.simulatingTrade(mode, side)} onClick={simulate} /> : null}
					{quote !== undefined ? <TransactionActionButton availability={submitAvailability} idleLabel={submitLabel} pending={state === 'submitting' || state === 'pending'} pendingLabel={workflowCopy.submittingTrade} onClick={submit} /> : null}
				</TransactionActionGroup>
			</div>
			{quote === undefined ? null : (
				<details className='trade-breakdown'>
					<summary>{workflowCopy.fullTradeBreakdown}</summary>
					<WorkflowSubsection title={workflowCopy.quoteShares}>
						<DataGrid dense>
							<MetricField label={workflowCopy.completeSets}>{formatCompleteSetQuantity(quote.value.result.completeSetShares)}</MetricField>
							<MetricField label={quote.kind === 'entry' ? workflowCopy.oppositeOutcomeSwapped : workflowCopy.outcomeSwapped(side)}>{formatOutcomeQuantity(quote.kind === 'entry' ? quote.value.result.oppositeSharesSwapped : quote.value.result.longSharesSwapped, quoteSide)}</MetricField>
							<MetricField label={quote.kind === 'entry' ? workflowCopy.additionalOutcomeReceived(side) : workflowCopy.totalOutcomeRequired(side)}>{formatOutcomeQuantity(quote.kind === 'entry' ? quote.value.result.additionalLongShares : quote.value.result.totalLongShares, side)}</MetricField>
							<MetricField label={quote.kind === 'entry' ? workflowCopy.totalOutcomeDelivered(side) : workflowCopy.invalidRequiredUppercase}>{formatOutcomeQuantity(quote.kind === 'entry' ? quote.value.result.totalLongShares : quote.value.result.invalidInsurance, quote.kind === 'entry' ? side : 'INVALID')}</MetricField>
							{quote.kind === 'entry' ? <MetricField label={workflowCopy.invalidReceived}>{formatOutcomeQuantity(quote.value.result.invalidInsurance, workflowCopy.invalid)}</MetricField> : undefined}
							<MetricField label={workflowCopy.ammFee}>{formatOutcomeQuantity(quote.value.result.feeAmount, quoteSide, 8)}</MetricField>
							<MetricField label={quote.kind === 'entry' ? workflowCopy.minimumOutcomeReceived(side) : workflowCopy.maximumOutcomeRequired(side)}>{formatOutcomeQuantity(quote.kind === 'entry' ? quote.value.minimumLongShares : quote.value.maximumLongShares, side)}</MetricField>
						</DataGrid>
					</WorkflowSubsection>
					<WorkflowSubsection title={workflowCopy.quoteEthValues}>
						<DataGrid dense>
							{quote.kind === 'entry' ? (
								<>
									<MetricField label={workflowCopy.averageOutcomePrice(side)}>{averagePrice === undefined ? workflowCopy.unavailableMetric : `${formatTrimmedUnits(averagePrice, 2, 2)}%`}</MetricField>
									<MetricField label={workflowCopy.conditionalYesBeforeAfter}>
										{formatTrimmedUnits(quote.value.result.conditionalYesBpsBefore, 2, 2)}% / {formatTrimmedUnits(quote.value.result.conditionalYesBpsAfter, 2, 2)}%
									</MetricField>
									<MetricField label={workflowCopy.conditionalYesPriceImpact}>{entryPriceImpactBps === undefined ? workflowCopy.unavailableMetric : `${entryPriceImpactBps > 0n ? workflowCopy.positiveSign : ''}${formatTrimmedUnits(entryPriceImpactBps, 2, 2)} ${workflowCopy.percentagePoints}`}</MetricField>
								</>
							) : (
								<>
									<MetricField label={workflowCopy.estimatedEthOut}>{`${formatRoundedUnits(quote.value.result.ethOut)} ${workflowCopy.eth}`}</MetricField>
									<MetricField label={workflowCopy.minimumEthReceived}>
										{formatTrimmedUnits(quote.value.minimumEth)} {workflowCopy.eth}
									</MetricField>
								</>
							)}
						</DataGrid>
					</WorkflowSubsection>
					<WorkflowSubsection title={workflowCopy.quoteTiming}>
						<DataGrid dense>
							<MetricField label={workflowCopy.simulationBlock}>{quote.value.blockNumber.toString()}</MetricField>
							<MetricField label={workflowCopy.deadline}>
								<TimestampValue timestamp={quote.value.deadline} relative={false} />
							</MetricField>
							<MetricField label={workflowCopy.slippageTolerance}>{formatTrimmedUnits(quote.value.slippageBps, 2, 2)}%</MetricField>
						</DataGrid>
					</WorkflowSubsection>
				</details>
			)}
		</div>
	)
}
