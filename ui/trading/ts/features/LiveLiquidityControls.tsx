import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { Address, Hash, WalletClient } from '@zoltar/shared/ethereum'
import { formatEthPerShare, formatOutcomeAmount, formatShareAmount, formatUnits, parseUnitsOrUndefined } from '../lib/format.js'
import { createExclusiveWorkflowGuard, createLatestRequestGuard } from '@zoltar/ui-core-shared/lib/requestGuard.js'
import { waitForSubmittedTransactionReceipt } from '@zoltar/ui-core-shared/lib/transactionReceipt.js'
import type { DeploymentConfiguration } from '../protocol/config.js'
import { approveLpRouter, marketAcceptsNewRisk, publicErrorMessage, simulateLiquidity, submitFreshLiquidity, type LiquidityOperation, type LiveBalances, type LiveMarket, type MarketLifecycle } from '../protocol/live.js'
import * as workflowCopy from '../copy/workflows.js'
import * as liquidityCopy from '../copy/liquidity.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { approvalFailureTransition, broadcastUncertainMessage, failedSubmissionTransition, parseSlippageBps, parseTransactionValidityMinutes, positionControlsWorkflowLocked, type GuardedWalletWrite } from './liveTradingControllerHelpers.js'
import type { BalanceState, QuoteContext, TransactionState } from './live/liveTradingTypes.js'
import { BalanceLoadError, DEFAULT_SLIPPAGE_PERCENT, DEFAULT_TRANSACTION_VALIDITY_MINUTES, ExecutionProtectionFields, formatTimestamp, stateLabel, TradingTransactionHash } from './LiveTradingTransactionUi.js'
type LiquidityQuote = Awaited<ReturnType<typeof simulateLiquidity>> & QuoteContext

export type LiveLiquidityServices = Readonly<{
	approveLpRouter: typeof approveLpRouter
	publicErrorMessage: typeof publicErrorMessage
	simulateLiquidity: typeof simulateLiquidity
	submitFreshLiquidity: typeof submitFreshLiquidity
}>

export const liveLiquidityServices: LiveLiquidityServices = {
	approveLpRouter,
	publicErrorMessage,
	simulateLiquidity,
	submitFreshLiquidity,
}

export function liquidityApprovalRequired(balanceState: BalanceState, operation: LiquidityOperation, amount: bigint | undefined, allowance: bigint | undefined) {
	return balanceState === 'ready' && operation === 'remove' && amount !== undefined && amount > 0n && allowance !== undefined && allowance < amount
}

export function liquidityOperationAvailable(operation: LiquidityOperation, market: MarketLifecycle, nowSeconds: bigint) {
	return operation === 'remove' || marketAcceptsNewRisk(market, nowSeconds)
}

export function LiveLiquidityControls({
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
	services = liveLiquidityServices,
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
	services?: LiveLiquidityServices
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
			const simulated = await services.simulateLiquidity(walletClient, configuration, market, account, operation, parsed, conditionalBps ?? 5_000n, validityMinutes, slippageBps)
			const nextQuote: LiquidityQuote = { ...simulated, account, configuration, walletClient }
			if (!simulationRequests.isCurrent(request)) return
			setQuote(nextQuote)
			setState('ready')
		} catch (caught) {
			if (!simulationRequests.isCurrent(request)) return
			setState('error')
			setError(services.publicErrorMessage(caught, 'Liquidity simulation failed'))
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
				return await services.approveLpRouter(walletClient, configuration, market, account, parsed)
			})
			setTransactionHash(broadcastHash)
			setState('approval-pending')
			const { receipt } = await waitForSubmittedTransactionReceipt(walletClient, broadcastHash, {
				allowRevertedReceipt: true,
				onKnownReceipt: () => {
					receiptKnown = true
					onKnownReceipt()
				},
				onTransactionReplaced: replacementHash => {
					broadcastHash = replacementHash
					setTransactionHash(replacementHash)
				},
			})
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
			broadcastHash = await services.submitFreshLiquidity(
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
			const { receipt } = await waitForSubmittedTransactionReceipt(walletClient, broadcastHash, {
				allowRevertedReceipt: true,
				onKnownReceipt: () => {
					receiptKnown = true
					onKnownReceipt()
				},
				onTransactionReplaced: replacementHash => {
					broadcastHash = replacementHash
					setTransactionHash(replacementHash)
				},
			})
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
			<h3>{liquidityCopy.sectionTitle}</h3>
			{balanceState === 'disconnected' ? <p>{liquidityCopy.disconnectedGuidance}</p> : null}
			{balanceState === 'loading' ? <p role='status'>{liquidityCopy.loadingBalancesStatus}</p> : null}
			{balanceState === 'error' ? <BalanceLoadError message={liquidityCopy.balancesUnavailable(balanceError ?? liquidityCopy.balanceRefreshFallback)} retry={retryBalances} disabled={workflowLocked} /> : null}
			<div class='segmented' aria-label={liquidityCopy.operationLabel}>
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
					{liquidityCopy.initializeAction}
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
					{liquidityCopy.addAction}
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
					{liquidityCopy.removeAction}
				</button>
			</div>
			<label class='field'>
				<span>{operation === 'remove' ? liquidityCopy.lpTokenAmount : liquidityCopy.ethAmount}</span>
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
					<span>{operation === 'remove' ? liquidityCopy.lp : liquidityCopy.eth}</span>
				</div>
			</label>
			{operation === 'initialize' ? (
				<label class='field'>
					<span>{liquidityCopy.conditionalYesPrice}</span>
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
						<span>{liquidityCopy.percent}</span>
					</div>
				</label>
			) : null}
			{operation === 'initialize' && conditionalBps === undefined ? (
				<p class='error' role='alert'>
					{liquidityCopy.conditionalYesPriceValidation}
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
									<dd>{formatOutcomeAmount(quote.expectedYes, liquidityCopy.yes)}</dd>
								</div>
								<div>
									<dt>{liquidityCopy.rawNoReturned}</dt>
									<dd>{formatOutcomeAmount(quote.expectedNo, liquidityCopy.no)}</dd>
								</div>
							</>
						) : (
							<>
								<div>
									<dt>{liquidityCopy.completeSetSharesCreated}</dt>
									<dd>{formatShareAmount(quote.result.completeSetShares)}</dd>
								</div>
								<div>
									<dt>{liquidityCopy.simulatedCompleteSetRate}</dt>
									<dd>{formatEthPerShare(quote.amount, quote.result.completeSetShares)}</dd>
								</div>
								<div>
									<dt>{liquidityCopy.sharesDeposited}</dt>
									<dd>
										{formatOutcomeAmount(quote.result.yesUsed, liquidityCopy.yes)} / {formatOutcomeAmount(quote.result.noUsed, liquidityCopy.no)}
									</dd>
								</div>
								<div>
									<dt>{liquidityCopy.unusedSharesReturned}</dt>
									<dd>
										{formatOutcomeAmount(quote.result.yesReturned, liquidityCopy.yes)} / {formatOutcomeAmount(quote.result.noReturned, liquidityCopy.no)}
									</dd>
								</div>
								<div>
									<dt>{liquidityCopy.invalidRetained}</dt>
									<dd>{formatOutcomeAmount(quote.result.invalidInsurance, liquidityCopy.invalid)}</dd>
								</div>
								<div>
									<dt>{liquidityCopy.lpTokensExpected}</dt>
									<dd>
										{formatUnits(quote.expectedLiquidity)} {liquidityCopy.lp}
									</dd>
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
			{needsLpApproval ? <TransactionActionButton disabled={workflowLocked} idleLabel={workflowCopy.approveExactLp} pending={state === 'preparing' || state === 'approval' || state === 'approval-pending'} pendingLabel={workflowCopy.approvingExactLp} onClick={approveLp} /> : null}
			{!needsLpApproval && quote === undefined ? (
				<TransactionActionButton
					disabled={balanceState !== 'ready' || account === undefined || parsed === undefined || slippageBps === undefined || validityMinutes === undefined || (operation === 'initialize' && conditionalBps === undefined) || (operation !== 'remove' && closedForAdding) || workflowLocked}
					idleLabel={workflowCopy.simulateLiquidity}
					pending={state === 'simulating'}
					pendingLabel={workflowCopy.simulatingLiquidity}
					onClick={simulateCurrent}
				/>
			) : null}
			{!needsLpApproval && quote !== undefined ? (
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
