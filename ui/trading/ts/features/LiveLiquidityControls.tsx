import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { FormField } from '@zoltar/ui-core-shared/components/FormField.js'
import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js'
import type { Address, WalletClient } from '@zoltar/core-shared/evm/ethereum'
import { formatTrimmedUnits } from '@zoltar/ui-core-shared/lib/formatters.js'
import { formatCompleteSetQuantity, formatLpQuantity, formatOutcomeQuantity } from '../lib/shareValue.js'
import type { DeploymentConfiguration } from '../protocol/config.js'
import { marketAcceptsNewRisk, publicErrorMessage, simulateLiquidity, submitFreshLiquidity, type LiveBalances, type LiveMarket } from '../protocol/live.js'
import * as workflowCopy from '../copy/workflows.js'
import * as liquidityCopy from '../copy/liquidity.js'
import { useId } from 'preact/hooks'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { TransactionActionButton, TransactionActionGroup } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { ViewTabs } from '@zoltar/ui-core-shared/components/ViewTabs.js'
import type { GuardedWalletWrite } from './liveTradingControllerHelpers.js'
import type { BalanceState } from './live/liveTradingTypes.js'
import { BalanceLoadError, ExecutionProtectionFields, stateLabel, TradingTransactionHash } from './LiveTradingTransactionUi.js'
import { liquidityOperationAvailable, useLiquidityWorkflowController } from './live/useLiquidityWorkflowController.js'
import { resolveLiquiditySimulateAvailability, resolveLiquiditySubmitAvailability, resolveActionGroupMessage } from './live/actionAvailability.js'
import { useFocusOnKeyChange } from './live/useFocusOnKeyChange.js'

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
	configuration,
	market,
	balances,
	balanceState,
	balanceError,
	account,
	walletClient,
	networkMismatchReason,
	walletEthAttoEth,
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
	const controller = useLiquidityWorkflowController({ configuration, market, balanceState, account, walletClient, externallyLocked, nowSeconds, refresh, onKnownReceipt, executeWithCurrentWalletContext, createGuardedWalletWrite, onWorkflowLockChange, services })
	const { operation, amount, probability, slippage, transactionValidityMinutes, quote, state, transactionHash, error, receiptWarning, parsed, slippageBps, validityMinutes, conditionalBps, workflowLocked, selectOperation, updateAmount, updateProbability, updateSlippage, updateValidity, simulateCurrent, submit } =
		controller
	const closedForAdding = !marketAcceptsNewRisk(market, nowSeconds)
	const availabilityInputs = {
		walletConnected: account !== undefined && walletClient !== undefined,
		networkMismatchReason,
		balanceState,
		operation,
		marketClosed: closedForAdding,
		requestedAmount: parsed,
		walletEthAttoEth,
		lpBalance: balances?.lp,
		initializePriceValid: conditionalBps !== undefined,
		protectionValid: slippageBps !== undefined && validityMinutes !== undefined,
		workflowLocked,
	}
	const simulateAvailability = resolveLiquiditySimulateAvailability(availabilityInputs)
	const submitAvailability = resolveLiquiditySubmitAvailability({ ...availabilityInputs, marketClosed: quote === undefined ? closedForAdding : !liquidityOperationAvailable(quote.operation, quote.market, nowSeconds), quoteReady: state === 'ready' })
	const actionAvailability = quote === undefined ? simulateAvailability : submitAvailability
	const statusText = state === 'error' ? undefined : stateLabel(state, workflowCopy.liquidityTransaction)
	const outcomeRef = useFocusOnKeyChange<HTMLDivElement>(state === 'confirmed' ? transactionHash : undefined)
	const fieldId = useId()
	const amountId = `${fieldId}-amount`
	const probabilityId = `${fieldId}-probability`
	const probabilityInvalid = operation === 'initialize' && probability.trim() !== '' && conditionalBps === undefined
	const groupMessage = resolveActionGroupMessage(state, actionAvailability, statusText)
	return (
		<div className='liquidity-controls'>
			{balanceState === 'disconnected' ? <p className='detail'>{liquidityCopy.disconnectedGuidance}</p> : null}
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
				<FormInput id={amountId} name='amount' value={amount} disabled={workflowLocked} inputMode='decimal' adornment={operation === 'remove' ? liquidityCopy.lp : liquidityCopy.eth} onInput={event => updateAmount(event.currentTarget.value)} />
			</FormField>
			{operation === 'initialize' ? (
				<FormField id={probabilityId} label={liquidityCopy.conditionalYesPrice}>
					<FormInput id={probabilityId} name='probability' value={probability} disabled={workflowLocked} inputMode='numeric' adornment={liquidityCopy.percent} error={probabilityInvalid ? liquidityCopy.conditionalYesPriceValidation : undefined} onInput={event => updateProbability(event.currentTarget.value)} />
				</FormField>
			) : null}
			<ExecutionProtectionFields slippage={slippage} validityMinutes={transactionValidityMinutes} disabled={workflowLocked} onSlippageInput={updateSlippage} onValidityInput={updateValidity} />
			<p className='detail'>{operation === 'remove' ? liquidityCopy.removalGuidance : liquidityCopy.additionGuidance}</p>
			{quote === undefined ? null : (
				<>
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
					<p className='inline-facts'>
						<span>
							{liquidityCopy.slippageTolerance}: {formatTrimmedUnits(quote.slippageBps, 2, 2)}%
						</span>
						<span>
							{liquidityCopy.deadline}: <TimestampValue timestamp={quote.deadline} relative={false} />
						</span>
					</p>
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
							<MetricField label={liquidityCopy.simulationBlockLabel}>{quote.blockNumber.toString()}</MetricField>
						</DataGrid>
					</ReadOnlyDetailAccordion>
				</>
			)}
			<div className='transaction-outcome' ref={outcomeRef} tabIndex={-1}>
				{transactionHash === undefined ? null : <TradingTransactionHash hash={transactionHash} />}
				<ErrorNotice message={receiptWarning} />
				<ErrorNotice message={error} />
				<TransactionActionGroup loading={actionAvailability.loading === true} message={groupMessage}>
					{quote === undefined ? <TransactionActionButton availability={simulateAvailability} idleLabel={workflowCopy.simulateLiquidity} pending={state === 'simulating'} pendingLabel={workflowCopy.simulatingLiquidity} onClick={simulateCurrent} /> : null}
					{quote !== undefined ? <TransactionActionButton availability={submitAvailability} idleLabel={workflowCopy.submitLiquidity} pending={state === 'preparing' || state === 'submitting' || state === 'pending'} pendingLabel={workflowCopy.submittingLiquidity} onClick={submit} /> : null}
				</TransactionActionGroup>
			</div>
		</div>
	)
}
