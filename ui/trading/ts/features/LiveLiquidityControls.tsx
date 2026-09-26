import { FormField } from '@zoltar/ui-core-shared/components/FormField.js'
import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import type { Address, WalletClient } from '@zoltar/core-shared/evm/ethereum'
import { formatTrimmedUnits } from '@zoltar/ui-core-shared/lib/formatters.js'
import { formatCompleteSetQuantity, formatLpQuantity, formatOutcomeQuantity } from '../lib/shareValue.js'
import { formatSlippagePercent, type TradeSettings } from '../lib/tradeSettings.js'
import type { DeploymentConfiguration } from '../protocol/config.js'
import { marketAcceptsNewRisk, publicErrorMessage, simulateLiquidity, submitFreshLiquidity, type LiveBalances, type LiveMarket } from '../protocol/live.js'
import * as workflowCopy from '../copy/workflows.js'
import * as liquidityCopy from '../copy/liquidity.js'
import * as settingsCopy from '../copy/tradeSettings.js'
import { useId } from 'preact/hooks'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { ViewTabs } from '@zoltar/ui-core-shared/components/ViewTabs.js'
import type { GuardedWalletWrite } from './liveTradingControllerHelpers.js'
import type { BalanceState } from './live/liveTradingTypes.js'
import { BalanceLoadError } from './LiveTradingTransactionUi.js'
import { liquidityOperationAvailable, useLiquidityWorkflowController } from './live/useLiquidityWorkflowController.js'
import { resolveLiquidityAvailability } from './live/actionAvailability.js'
import { QuotedTransactionPanel, type WalletStep } from './QuotedTransactionPanel.js'

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

/** The first step of the panel when no usable wallet is connected: connect, or switch back to the deployment chain. */
export type PanelWallet = Readonly<{ actionLabel: string; connect(): Promise<void> }>

export function LiveLiquidityControls({
	configuration,
	market,
	balances,
	balanceState,
	balanceError,
	account,
	walletClient,
	networkMismatchReason,
	walletEthAttoEth,
	wallet,
	settings,
	externallyLocked,
	nowSeconds,
	refresh,
	onKnownReceipt,
	executeWithCurrentWalletContext,
	createGuardedWalletWrite,
	retryBalances,
	onWorkflowLockChange,
	services = liveLiquidityServices,
}: {
	configuration: DeploymentConfiguration
	market: LiveMarket
	balances: LiveBalances | undefined
	balanceState: BalanceState
	balanceError: string | undefined
	account: Address | undefined
	walletClient: WalletClient | undefined
	networkMismatchReason: string | undefined
	walletEthAttoEth: bigint | undefined
	wallet: PanelWallet
	settings: TradeSettings
	externallyLocked: boolean
	nowSeconds: bigint
	refresh(): Promise<void>
	onKnownReceipt(): void
	executeWithCurrentWalletContext<T>(account: Address, networkFailure: string, accountFailure: string, action: () => Promise<T>): Promise<T>
	createGuardedWalletWrite(account: Address, networkFailure: string, accountFailure: string): GuardedWalletWrite
	retryBalances(): Promise<void>
	onWorkflowLockChange(locked: boolean): void
	services?: LiveLiquidityServices
}) {
	const controller = useLiquidityWorkflowController({ configuration, market, balanceState, account, walletClient, externallyLocked, nowSeconds, settings, refresh, onKnownReceipt, executeWithCurrentWalletContext, createGuardedWalletWrite, onWorkflowLockChange, services })
	const { operation, amount, probability, parsed, conditionalBps, transaction, selectOperation, updateAmount, updateProbability, submit } = controller
	const { quote, state, workflowLocked } = transaction
	const closedForAdding = !marketAcceptsNewRisk(market, nowSeconds)
	const walletConnected = account !== undefined && walletClient !== undefined
	const availability = resolveLiquidityAvailability({
		walletConnected,
		networkMismatchReason,
		balanceState,
		operation,
		marketClosed: quote === undefined ? closedForAdding : !liquidityOperationAvailable(quote.operation, quote.market, nowSeconds),
		requestedAmount: parsed,
		walletEthAttoEth,
		lpBalance: balances?.lp,
		initializePriceValid: conditionalBps !== undefined,
		workflowLocked,
		quoteState: transaction.quoteState,
		quoteError: transaction.quoteError,
	})
	const walletStep: WalletStep | undefined = walletConnected && networkMismatchReason === undefined ? undefined : { label: wallet.actionLabel, disabled: workflowLocked, onClick: () => void wallet.connect() }
	const fieldId = useId()
	const amountId = `${fieldId}-amount`
	const probabilityId = `${fieldId}-probability`
	const probabilityInvalid = operation === 'initialize' && probability.trim() !== '' && conditionalBps === undefined
	let actionLabel = liquidityCopy.addLiquidityAction
	if (operation === 'initialize') actionLabel = liquidityCopy.initializeLiquidityAction
	else if (operation === 'remove') actionLabel = liquidityCopy.removeLiquidityAction
	let amountHint: string | undefined
	if (operation === 'remove' && balances !== undefined) amountHint = liquidityCopy.lpHeld(formatLpQuantity(balances.lp))
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
					onInput={event => updateAmount(event.currentTarget.value)}
				/>
			</FormField>
			{operation === 'initialize' ? (
				<FormField id={probabilityId} label={liquidityCopy.conditionalYesPrice}>
					<FormInput id={probabilityId} name='probability' value={probability} disabled={workflowLocked} inputMode='numeric' adornment={liquidityCopy.percent} error={probabilityInvalid ? liquidityCopy.conditionalYesPriceValidation : undefined} onInput={event => updateProbability(event.currentTarget.value)} />
				</FormField>
			) : null}
			<p className='detail'>{operation === 'remove' ? liquidityCopy.removalGuidance : liquidityCopy.additionGuidance}</p>
			<QuotedTransactionPanel phase={state} actionLabel={actionLabel} availability={availability} transactionHash={transaction.transactionHash} receiptWarning={transaction.receiptWarning} error={transaction.error} walletStep={walletStep} onSubmit={() => void submit()}>
				{transaction.quoteState === 'loading' && quote === undefined ? <LoadingText>{liquidityCopy.gettingQuote}</LoadingText> : null}
				{quote === undefined ? null : (
					<section className='trade-estimate' aria-label={liquidityCopy.quoteHeading} aria-busy={transaction.quoteState === 'loading'}>
						<div className='exchange-preview'>
							<div>
								<p className='detail'>{liquidityCopy.youProvide}</p>
								<strong className='decision-amount'>{quote.operation === 'remove' ? formatLpQuantity(quote.amount) : `${formatTrimmedUnits(quote.amount)} ${workflowCopy.eth}`}</strong>
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
						<p className='detail trade-estimate-note'>{settingsCopy.protectionSummary(formatSlippagePercent(settings.slippageBps), settings.validityMinutes)}</p>
					</section>
				)}
			</QuotedTransactionPanel>
		</div>
	)
}
