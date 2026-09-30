import { submissionWindowBlocker } from '../protocol/submissionWindow.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import * as availabilityCopy from '../copy/availability.js'
import { FormField } from '@zoltar/ui-core-shared/components/FormField.js'
import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { formatTrimmedUnits, formatValueWithUnit } from '@zoltar/ui-core-shared/lib/formatters.js'
import { formatCompleteSetQuantity, formatLpQuantity, formatOutcomeQuantity } from '../lib/shareValue.js'
import { formatRoundedUnits } from '../lib/format.js'
import { formatSlippagePercent } from '../lib/tradeSettings.js'
import { marketAcceptsNewRisk, publicErrorMessage, simulateLiquidity, submitFreshLiquidity } from '../protocol/live.js'
import * as workflowCopy from '../copy/workflows.js'
import * as liquidityCopy from '../copy/liquidity.js'
import * as settingsCopy from '../copy/tradeSettings.js'
import { useId } from 'preact/hooks'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { ViewTabs } from '@zoltar/ui-core-shared/components/ViewTabs.js'
import type { LiveWorkflowPanelProps } from './live/liveTradingTypes.js'
import { BalanceLoadError } from './LiveTradingTransactionUi.js'
import { liquidityOperationAvailable, useLiquidityWorkflowController } from './live/useLiquidityWorkflowController.js'
import { resolveLiquidityAvailability } from './live/actionAvailability.js'
import { panelWalletStep, QuotedTransactionPanel } from './QuotedTransactionPanel.js'

export type LiveLiquidityServices = Readonly<{
	publicErrorMessage: typeof publicErrorMessage
	simulateLiquidity: typeof simulateLiquidity
	submitFreshLiquidity: typeof submitFreshLiquidity
}>

export const liveLiquidityServices: LiveLiquidityServices = {
	publicErrorMessage,
	simulateLiquidity,
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
		oracleBlocker?: string | undefined
		services?: LiveLiquidityServices
	}>) {
	const { market, balanceState, account, walletClient, settings } = context
	const controller = useLiquidityWorkflowController({ ...context, nowSeconds, services })
	const { operation, amount, probability, parsed, conditionalBps, transaction, selectOperation, updateAmount, updateProbability, submit } = controller
	const { quote, state, workflowLocked } = transaction
	const closedForAdding = !marketAcceptsNewRisk(market, nowSeconds)
	const walletConnected = account !== undefined && walletClient !== undefined
	const baseAvailability = resolveLiquidityAvailability({
		walletConnected,
		networkMismatchReason,
		balanceState,
		operation,
		submissionBlocker: submissionWindowBlocker(market, operation, nowSeconds),
		marketClosed: quote === undefined ? closedForAdding : !liquidityOperationAvailable(quote.operation, quote.market, nowSeconds),
		requestedAmount: parsed,
		walletEthAttoEth,
		lpBalance: balances?.lp,
		initializePriceValid: conditionalBps !== undefined,
		workflowLocked,
		quoteState: transaction.quoteState,
		quoteError: transaction.quoteError,
	})
	const availability = operation !== 'remove' && context.oracleBlocker !== undefined && walletConnected && networkMismatchReason === undefined ? { disabled: true, reason: context.oracleBlocker } : baseAvailability
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
		if (parsed === undefined || parsed <= 0n) return availabilityCopy.amountRequiredReason
		if (availableAmount !== undefined && parsed > availableAmount) return operation === 'remove' ? availabilityCopy.insufficientLpReason : availabilityCopy.insufficientEthReason
		return undefined
	})()
	let amountHint: string | undefined
	if (operation === 'remove' && balances !== undefined) amountHint = liquidityCopy.lpHeld(formatLpQuantity(balances.lp, 4, 'down'))
	else if (operation !== 'remove' && walletEthAttoEth !== undefined) amountHint = liquidityCopy.walletEth(formatTrimmedUnits(walletEthAttoEth))
	return (
		<div className='liquidity-controls'>
			{balanceState === 'error' && networkMismatchReason === undefined ? <BalanceLoadError message={liquidityCopy.balancesUnavailable(balanceError ?? liquidityCopy.balanceRefreshFallback)} retry={retryBalances} disabled={workflowLocked} /> : null}
			<ViewTabs
				ariaLabel={liquidityCopy.operationLabel}
				semantics='switcher'
				variant='segmented'
				size='compact'
				value={operation}
				onChange={selectOperation}
				options={[
					{ value: 'initialize', label: liquidityCopy.initializeAction, disabled: market.lpTotalSupply > 0n || closedForAdding || workflowLocked },
					{ value: 'add', label: liquidityCopy.addAction, disabled: market.lpTotalSupply === 0n || closedForAdding || workflowLocked },
					{ value: 'remove', label: liquidityCopy.removeAction, disabled: market.lpTotalSupply === 0n || workflowLocked },
				]}
			/>
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
			<UserMessage className='detail' detail={operation === 'remove' ? liquidityCopy.removalGuidance : liquidityCopy.additionGuidance} />
			<QuotedTransactionPanel phase={state} actionLabel={actionLabel} availability={availability} transactionHash={transaction.transactionHash} receiptWarning={transaction.receiptWarning} error={transaction.error} walletStep={walletStep} onSubmit={() => void submit()}>
				{transaction.quoteState === 'error' ? (
					<TransactionActionButton idleLabel={liquidityCopy.retryQuote} pendingLabel={liquidityCopy.gettingQuote} pending={false} tone='secondary' availability={{ disabled: workflowLocked, reason: workflowLocked ? liquidityCopy.waitForTransaction : undefined }} onClick={transaction.retryQuote} />
				) : null}
				{transaction.quoteState === 'loading' && quote === undefined ? <LoadingText>{liquidityCopy.gettingQuote}</LoadingText> : null}
				{quote === undefined ? null : (
					<section className='trade-estimate' aria-label={liquidityCopy.quoteHeading} aria-busy={transaction.quoteState === 'loading'}>
						<div className='exchange-preview'>
							<div>
								<p className='detail'>{liquidityCopy.youProvide}</p>
								<strong className='decision-amount'>{quote.operation === 'remove' ? formatLpQuantity(quote.amount) : formatValueWithUnit(formatRoundedUnits(quote.amount), workflowCopy.eth)}</strong>
							</div>
							<span className='exchange-arrow' aria-hidden='true'>
								→
							</span>
							<div>
								<p className='detail'>{liquidityCopy.youReceive}</p>
								{quote.operation === 'remove' ? (
									<ul className='portfolio-holdings'>
										<li className='portfolio-holding-yes'>{formatOutcomeQuantity(quote.expectedYes, liquidityCopy.yes)}</li>
										<li className='portfolio-holding-no'>{formatOutcomeQuantity(quote.expectedNo, liquidityCopy.no)}</li>
									</ul>
								) : (
									<>
										<strong className='decision-amount'>{formatLpQuantity(quote.expectedLiquidity)}</strong>
										<ul className='portfolio-holdings'>
											<li>{formatOutcomeQuantity(quote.result.invalidInsurance, liquidityCopy.invalid)}</li>
											{quote.result.yesReturned === 0n ? undefined : <li className='portfolio-holding-yes'>{formatOutcomeQuantity(quote.result.yesReturned, liquidityCopy.yes)}</li>}
											{quote.result.noReturned === 0n ? undefined : <li className='portfolio-holding-no'>{formatOutcomeQuantity(quote.result.noReturned, liquidityCopy.no)}</li>}
										</ul>
									</>
								)}
							</div>
						</div>
						<ReadOnlyDetailAccordion title={liquidityCopy.previewDetails}>
							<DataGrid dense>
								{quote.operation === 'remove' ? undefined : (
									<>
										<MetricField label={liquidityCopy.completeSetSharesCreated}>{formatCompleteSetQuantity(quote.result.completeSetShares)}</MetricField>
										<MetricField label={liquidityCopy.sharesDeposited}>
											{formatOutcomeQuantity(quote.result.yesUsed, liquidityCopy.yes)} / {formatOutcomeQuantity(quote.result.noUsed, liquidityCopy.no)}
										</MetricField>
									</>
								)}
								<MetricField label={liquidityCopy.quoteBlock}>{quote.blockNumber.toString()}</MetricField>
							</DataGrid>
						</ReadOnlyDetailAccordion>
						<UserMessage className='detail trade-estimate-note' detail={settingsCopy.protectionSummary(formatSlippagePercent(settings.slippageBps), settings.validityMinutes, operation === 'remove' ? undefined : 'question-or-oracle')} />
					</section>
				)}
			</QuotedTransactionPanel>
		</div>
	)
}
