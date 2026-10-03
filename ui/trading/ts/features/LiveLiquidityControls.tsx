import { submissionWindowBlocker } from '../protocol/submissionWindow.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import * as availabilityCopy from '../copy/availability.js'
import { FormField } from '@zoltar/ui-core-shared/components/FormField.js'
import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js'
import { formatTrimmedUnits, formatValueWithUnit } from '@zoltar/ui-core-shared/lib/formatters.js'
import { formatCompleteSetWithValue, formatLpWithValue, formatOutcomeWithValue, shareOutcome } from '../lib/shareValue.js'
import { formatRoundedUnits } from '../lib/format.js'
import { formatSlippagePercent } from '../lib/tradeSettings.js'
import { marketNewRiskBlocker, submitFreshLiquidity, type LiveMarket } from '../protocol/live.js'
import * as workflowCopy from '../copy/workflows.js'
import * as liquidityCopy from '../copy/liquidity.js'
import * as settingsCopy from '../copy/tradeSettings.js'
import { useId } from 'preact/hooks'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import type { LiveWorkflowPanelProps } from './live/liveTradingTypes.js'
import { BalanceLoadError } from './LiveTradingTransactionUi.js'
import { liquidityOperationAvailable, useLiquidityWorkflowController } from './live/useLiquidityWorkflowController.js'
import { resolveLiquidityAvailability } from './live/actionAvailability.js'
import { panelWalletStep, QuotedTransactionPanel } from './QuotedTransactionPanel.js'
import { LpHolding } from './OutcomeHolding.js'
import { MINIMUM_LIQUIDITY, outcomeSharesValueAttoEth, type LiquidityPreview } from './live/liquidityEstimate.js'
import { operationOption } from './live/operationOption.js'
import { OperationSwitcher } from './OperationSwitcher.js'

export type LiveLiquidityServices = Readonly<{
	submitFreshLiquidity: typeof submitFreshLiquidity
}>

export const liveLiquidityServices: LiveLiquidityServices = {
	submitFreshLiquidity,
}

export function LiveLiquidityControls({
	balances,
	balanceError,
	networkMismatchReason,
	walletEthAttoEth,
	wallet,
	nowSeconds,
	retryBalances,
	services = liveLiquidityServices,
	...context
}: LiveWorkflowPanelProps &
	Readonly<{
		walletEthAttoEth: bigint | undefined
		nowSeconds: bigint
		services?: LiveLiquidityServices
	}>) {
	const { market, balanceState, account, walletClient, settings } = context
	const controller = useLiquidityWorkflowController({ ...context, nowSeconds, services })
	const { operation, amount, probability, parsed, conditionalBps, estimate, previewBlocker, transaction, selectOperation, updateAmount, updateProbability, submit } = controller
	const { state, workflowLocked } = transaction
	const closedForAdding = !liquidityOperationAvailable('add', market, nowSeconds)
	const newRiskBlocker = marketNewRiskBlocker(market, nowSeconds)
	const walletConnected = account !== undefined && walletClient !== undefined
	const availability = resolveLiquidityAvailability({
		walletConnected,
		networkMismatchReason,
		balanceState,
		operation,
		submissionBlocker: submissionWindowBlocker(market, operation, nowSeconds),
		marketClosed: closedForAdding,
		requestedAmount: parsed,
		walletEthAttoEth,
		lpBalance: balances?.lp,
		initializePriceValid: conditionalBps !== undefined,
		workflowLocked,
		previewBlocker,
	})
	const walletStep = panelWalletStep(wallet, walletConnected && networkMismatchReason === undefined, workflowLocked)
	const fieldId = useId()
	const amountId = `${fieldId}-amount`
	const probabilityId = `${fieldId}-probability`
	const probabilityInvalid = operation === 'initialize' && probability.trim() !== '' && conditionalBps === undefined
	let actionLabel = liquidityCopy.addLiquidityAction
	if (operation === 'initialize') actionLabel = liquidityCopy.initializeLiquidityAction
	else if (operation === 'remove') actionLabel = liquidityCopy.removeLiquidityAction
	const availableAmount = operation === 'remove' ? balances?.lp : walletEthAttoEth
	const amountError = (() => {
		if (amount.trim() === '') return undefined
		if (parsed === undefined) return operation === 'remove' ? liquidityCopy.invalidLpAmount : liquidityCopy.invalidEthAmount
		if (parsed === 0n) return availabilityCopy.amountRequiredReason
		if (availableAmount !== undefined && parsed > availableAmount) return operation === 'remove' ? availabilityCopy.insufficientLpReason : availabilityCopy.insufficientEthReason
		return undefined
	})()
	let amountHint: string | undefined
	if (operation === 'remove' && balances !== undefined) amountHint = liquidityCopy.lpHeld(formatLpWithValue(balances.lp, market, 4, 'down'))
	else if (operation !== 'remove' && walletEthAttoEth !== undefined) amountHint = liquidityCopy.walletEth(formatTrimmedUnits(walletEthAttoEth))
	const initialized = market.pair !== undefined && market.lpTotalSupply > 0n
	// An initialized pool can never be initialized again, so the option is removed rather than disabled.
	const operationOptions = [
		...(initialized ? [] : [operationOption('initialize', liquidityCopy.initializeAction, closedForAdding || workflowLocked, newRiskBlocker)]),
		operationOption('add', liquidityCopy.addAction, !initialized || closedForAdding || workflowLocked, addOptionReason(initialized, newRiskBlocker)),
		operationOption('remove', liquidityCopy.removeAction, !initialized || workflowLocked, initialized ? undefined : liquidityCopy.noLiquidityToRemoveReason),
	]
	return (
		<div className='liquidity-controls'>
			{balanceState === 'error' && networkMismatchReason === undefined ? <BalanceLoadError message={liquidityCopy.balancesUnavailable(balanceError ?? liquidityCopy.balanceRefreshFallback)} retry={retryBalances} disabled={workflowLocked} /> : null}
			<OperationSwitcher ariaLabel={liquidityCopy.operationLabel} value={operation} onChange={selectOperation} options={operationOptions} />
			<FormField id={amountId} label={operation === 'remove' ? liquidityCopy.lpTokenAmount : liquidityCopy.ethAmount}>
				<FormInput
					id={amountId}
					name='amount'
					value={amount}
					placeholder={workflowCopy.amountPlaceholder}
					autoComplete='off'
					disabled={workflowLocked}
					inputMode='decimal'
					adornment={operation === 'remove' ? liquidityCopy.lp : liquidityCopy.eth}
					hint={amountHint}
					error={amountError}
					onInput={event => updateAmount(event.currentTarget.value)}
				/>
			</FormField>
			{operation === 'initialize' ? (
				<FormField id={probabilityId} label={liquidityCopy.conditionalYesPrice}>
					<FormInput id={probabilityId} name='probability' value={probability} disabled={workflowLocked} inputMode='decimal' adornment={liquidityCopy.percent} error={probabilityInvalid ? liquidityCopy.conditionalYesPriceValidation : undefined} onInput={event => updateProbability(event.currentTarget.value)} />
				</FormField>
			) : null}
			<UserMessage className='detail' detail={operation === 'remove' ? liquidityCopy.removalGuidance(!closedForAdding) : liquidityCopy.additionGuidance} />
			<QuotedTransactionPanel phase={state} actionLabel={actionLabel} availability={availability} transactionHash={transaction.transactionHash} receiptWarning={transaction.receiptWarning} error={transaction.error} walletStep={walletStep} onSubmit={() => void submit()}>
				{estimate === undefined ? null : <LiquidityPreviewSection preview={estimate} market={market} connected={walletConnected} protection={settingsCopy.protectionSummary(formatSlippagePercent(settings.slippageBps), settings.validityMinutes, operation === 'remove' ? undefined : 'question')} />}
			</QuotedTransactionPanel>
		</div>
	)
}

function addOptionReason(initialized: boolean, newRiskBlocker: string | undefined) {
	if (!initialized) return liquidityCopy.poolNotInitializedReason
	return newRiskBlocker
}

/** What the operation gives and returns, computed from the loaded pool state. */
function LiquidityPreviewSection({ preview, market, connected, protection }: { preview: LiquidityPreview; market: LiveMarket; connected: boolean; protection: string }) {
	let estimateNote = connected ? liquidityCopy.localEstimateNote : liquidityCopy.estimateNote
	if (preview.operation === 'initialize') estimateNote = connected ? liquidityCopy.initializeLocalEstimateNote : liquidityCopy.initializeEstimateNote
	const removalValue = preview.operation === 'remove' ? outcomeSharesValueAttoEth(market, preview.yesOut, preview.noOut) : undefined
	return (
		<section className='trade-estimate' aria-label={liquidityCopy.estimateHeading}>
			<div className='exchange-preview'>
				<div>
					<p className='detail'>{liquidityCopy.youProvide}</p>
					<strong className='decision-amount'>{preview.operation === 'remove' ? <LpHolding amount={preview.amount} market={market} /> : formatValueWithUnit(formatRoundedUnits(preview.amount), workflowCopy.eth)}</strong>
				</div>
				<span className='exchange-arrow' aria-hidden='true'>
					→
				</span>
				<div>
					<p className='detail'>{liquidityCopy.youReceive}</p>
					{preview.operation === 'remove' ? (
						<ul className='portfolio-holdings'>
							<li className='portfolio-holding-yes'>{formatOutcomeWithValue(preview.yesOut, shareOutcome.yes, market)}</li>
							<li className='portfolio-holding-no'>{formatOutcomeWithValue(preview.noOut, shareOutcome.no, market)}</li>
						</ul>
					) : (
						<>
							<strong className='decision-amount'>
								<LpHolding amount={preview.liquidity} market={{ ...market, yesReserve: market.yesReserve + preview.yesUsed, noReserve: market.noReserve + preview.noUsed, lpTotalSupply: preview.operation === 'initialize' ? preview.liquidity + MINIMUM_LIQUIDITY : market.lpTotalSupply + preview.liquidity }} />
							</strong>
							<ul className='portfolio-holdings'>
								<li>{formatOutcomeWithValue(preview.invalidReturned, shareOutcome.invalid, market)}</li>
								{preview.yesReturned === 0n ? undefined : <li className='portfolio-holding-yes'>{formatOutcomeWithValue(preview.yesReturned, shareOutcome.yes, market)}</li>}
								{preview.noReturned === 0n ? undefined : <li className='portfolio-holding-no'>{formatOutcomeWithValue(preview.noReturned, shareOutcome.no, market)}</li>}
							</ul>
						</>
					)}
				</div>
			</div>
			{removalValue === undefined ? null : <p className='detail'>{liquidityCopy.approximateRemovalValue(formatRoundedUnits(removalValue))}</p>}
			{preview.operation === 'remove' ? null : (
				<ReadOnlyDetailAccordion title={liquidityCopy.previewDetails}>
					<DataGrid dense>
						<MetricField label={liquidityCopy.completeSetSharesCreated}>{formatCompleteSetWithValue(preview.completeSets, market)}</MetricField>
						<MetricField label={liquidityCopy.sharesDeposited}>
							{formatOutcomeWithValue(preview.yesUsed, shareOutcome.yes, market)} / {formatOutcomeWithValue(preview.noUsed, shareOutcome.no, market)}
						</MetricField>
					</DataGrid>
				</ReadOnlyDetailAccordion>
			)}
			<UserMessage
				className='detail trade-estimate-note'
				detail={
					<>
						{estimateNote} {protection}
					</>
				}
			/>
		</section>
	)
}
