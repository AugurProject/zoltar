import type { Address, WalletClient } from '@zoltar/core-shared/evm/ethereum'
import { formatUnits } from '../lib/format.js'
import { formatCompleteSetValue, formatLpValue, formatOutcomeValue } from '../lib/shareValue.js'
import type { DeploymentConfiguration } from '../protocol/config.js'
import { marketAcceptsNewRisk, publicErrorMessage, simulateLiquidity, submitFreshLiquidity, type LiveMarket } from '../protocol/live.js'
import * as workflowCopy from '../copy/workflows.js'
import * as liquidityCopy from '../copy/liquidity.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import type { GuardedWalletWrite } from './liveTradingControllerHelpers.js'
import type { BalanceState } from './live/liveTradingTypes.js'
import { BalanceLoadError, ExecutionProtectionFields, formatTimestamp, stateLabel, TradingTransactionHash } from './LiveTradingTransactionUi.js'
import { liquidityOperationAvailable, useLiquidityWorkflowController } from './live/useLiquidityWorkflowController.js'

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
	balanceState,
	balanceError,
	account,
	walletClient,
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
	balanceState: BalanceState
	balanceError: string | undefined
	account: Address | undefined
	walletClient: WalletClient | undefined
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
	return (
		<div class='operation-block'>
			<h3>{liquidityCopy.sectionTitle}</h3>
			{balanceState === 'disconnected' ? <p>{liquidityCopy.disconnectedGuidance}</p> : null}
			{balanceState === 'loading' ? <p role='status'>{liquidityCopy.loadingBalancesStatus}</p> : null}
			{balanceState === 'error' ? <BalanceLoadError message={liquidityCopy.balancesUnavailable(balanceError ?? liquidityCopy.balanceRefreshFallback)} retry={retryBalances} disabled={workflowLocked} /> : null}
			<div class='segmented' aria-label={liquidityCopy.operationLabel}>
				<button aria-pressed={operation === 'initialize'} disabled={market.lpTotalSupply > 0n || closedForAdding || workflowLocked} onClick={() => selectOperation('initialize')}>
					{liquidityCopy.initializeAction}
				</button>
				<button aria-pressed={operation === 'add'} disabled={market.lpTotalSupply === 0n || closedForAdding || workflowLocked} onClick={() => selectOperation('add')}>
					{liquidityCopy.addAction}
				</button>
				<button aria-pressed={operation === 'remove'} disabled={market.lpTotalSupply === 0n || workflowLocked} onClick={() => selectOperation('remove')}>
					{liquidityCopy.removeAction}
				</button>
			</div>
			<label class='field'>
				<span>{operation === 'remove' ? liquidityCopy.lpTokenAmount : liquidityCopy.ethAmount}</span>
				<div class='amount-input'>
					<input value={amount} disabled={workflowLocked} inputMode='decimal' onInput={event => updateAmount(event.currentTarget.value)} />
					<span>{operation === 'remove' ? liquidityCopy.lp : liquidityCopy.eth}</span>
				</div>
			</label>
			{operation === 'initialize' ? (
				<label class='field'>
					<span>{liquidityCopy.conditionalYesPrice}</span>
					<div class='amount-input'>
						<input value={probability} disabled={workflowLocked} inputMode='numeric' onInput={event => updateProbability(event.currentTarget.value)} />
						<span>{liquidityCopy.percent}</span>
					</div>
				</label>
			) : null}
			{operation === 'initialize' && conditionalBps === undefined ? (
				<p class='error' role='alert'>
					{liquidityCopy.conditionalYesPriceValidation}
				</p>
			) : null}
			<ExecutionProtectionFields slippage={slippage} validityMinutes={transactionValidityMinutes} disabled={workflowLocked} onSlippageInput={updateSlippage} onValidityInput={updateValidity} />
			{operation === 'remove' ? <p>{liquidityCopy.removalGuidance}</p> : <p>{liquidityCopy.additionGuidance}</p>}
			{quote === undefined ? null : (
				<>
					<p class='quote'>{liquidityCopy.simulationBlock(quote.blockNumber)}</p>
					<dl class='metrics'>
						<div>
							<dt>{liquidityCopy.slippageTolerance}</dt>
							<dd>{formatUnits(quote.slippageBps, 2, 2)}%</dd>
						</div>
						<div>
							<dt>{liquidityCopy.deadline}</dt>
							<dd>{formatTimestamp(quote.deadline)}</dd>
						</div>
						{quote.operation === 'remove' ? (
							<>
								<div>
									<dt>{liquidityCopy.rawYesReturned}</dt>
									<dd>{formatOutcomeValue(quote.expectedYes, liquidityCopy.yes, market)}</dd>
								</div>
								<div>
									<dt>{liquidityCopy.rawNoReturned}</dt>
									<dd>{formatOutcomeValue(quote.expectedNo, liquidityCopy.no, market)}</dd>
								</div>
							</>
						) : (
							<>
								<div>
									<dt>{liquidityCopy.completeSetSharesCreated}</dt>
									<dd>{formatCompleteSetValue(quote.result.completeSetShares, market)}</dd>
								</div>
								<div>
									<dt>{liquidityCopy.sharesDeposited}</dt>
									<dd>
										{formatOutcomeValue(quote.result.yesUsed, liquidityCopy.yes, market)} / {formatOutcomeValue(quote.result.noUsed, liquidityCopy.no, market)}
									</dd>
								</div>
								<div>
									<dt>{liquidityCopy.unusedSharesReturned}</dt>
									<dd>
										{formatOutcomeValue(quote.result.yesReturned, liquidityCopy.yes, market)} / {formatOutcomeValue(quote.result.noReturned, liquidityCopy.no, market)}
									</dd>
								</div>
								<div>
									<dt>{liquidityCopy.invalidRetained}</dt>
									<dd>{formatOutcomeValue(quote.result.invalidInsurance, liquidityCopy.invalid, market)}</dd>
								</div>
								<div>
									<dt>{liquidityCopy.lpTokensExpected}</dt>
									<dd>{formatLpValue(quote.expectedLiquidity, market)}</dd>
								</div>
							</>
						)}
					</dl>
				</>
			)}
			{transactionHash === undefined ? null : <TradingTransactionHash hash={transactionHash} />}
			<ErrorNotice message={receiptWarning} />
			<ErrorNotice message={error} />
			<p role='status' aria-live='polite'>
				{stateLabel(state, workflowCopy.liquidityTransaction)}
			</p>
			{quote === undefined ? (
				<TransactionActionButton
					disabled={balanceState !== 'ready' || account === undefined || parsed === undefined || slippageBps === undefined || validityMinutes === undefined || (operation === 'initialize' && conditionalBps === undefined) || (operation !== 'remove' && closedForAdding) || workflowLocked}
					idleLabel={workflowCopy.simulateLiquidity}
					pending={state === 'simulating'}
					pendingLabel={workflowCopy.simulatingLiquidity}
					onClick={simulateCurrent}
				/>
			) : null}
			{quote !== undefined ? (
				<TransactionActionButton
					disabled={workflowLocked || state !== 'ready' || !liquidityOperationAvailable(quote.operation, quote.market, nowSeconds)}
					idleLabel={workflowCopy.submitLiquidity}
					pending={state === 'preparing' || state === 'submitting' || state === 'pending'}
					pendingLabel={workflowCopy.submittingLiquidity}
					onClick={submit}
				/>
			) : null}
		</div>
	)
}
