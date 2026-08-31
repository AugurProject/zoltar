import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { Address, Hash, PublicClient, WalletClient } from '@zoltar/shared/ethereum'
import { formatUnits, parseUnitsOrUndefined } from '../lib/format.js'
import { createExclusiveWorkflowGuard, createLatestRequestGuard } from '@zoltar/ui-core-shared/lib/requestGuard.js'
import { waitForSubmittedTransactionReceipt } from '@zoltar/ui-core-shared/lib/transactionReceipt.js'
import { ForkMigrationTargets } from './ForkMigrationTargets.js'
import type { DeploymentConfiguration } from '../protocol/config.js'
import { loadForkMigrationContext, type ForkMigrationContext, type ForkTarget } from '../protocol/forks.js'
import { approveRouter, createTradingPublicClient, publicErrorMessage, settlementAvailability, simulateSettlement, submitFreshSettlement, type LiveBalances, type LiveMarket, type SettlementOperation, type ShareOutcome } from '../protocol/live.js'
import * as workflowCopy from '../copy/workflows.js'
import * as settlementCopy from '../copy/settlement.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { approvalFailureTransition, broadcastUncertainMessage, failedSubmissionTransition, parseSlippageBps, parseTransactionValidityMinutes, positionControlsWorkflowLocked, type GuardedWalletWrite } from './liveTradingControllerHelpers.js'
import type { BalanceState, TransactionState } from './live/liveTradingTypes.js'
import { BalanceLoadError, DEFAULT_SLIPPAGE_PERCENT, DEFAULT_TRANSACTION_VALIDITY_MINUTES, ExecutionProtectionFields, formatTimestamp, TradingTransactionHash } from './LiveTradingTransactionUi.js'
import { forkMigrationBatchBlocker, forkMigrationBatchWarning, migrationSimulationSummary, settlementBalanceLabel, settlementInputBlocker } from './LiveSettlementModel.js'

export type LiveSettlementServices = Readonly<{
	approveRouter: typeof approveRouter
	createPublicClient(configuration: DeploymentConfiguration): PublicClient
	loadForkContext: typeof loadForkMigrationContext
	simulate: typeof simulateSettlement
	submit: typeof submitFreshSettlement
}>

export const liveSettlementServices: LiveSettlementServices = {
	approveRouter,
	createPublicClient: createTradingPublicClient,
	loadForkContext: loadForkMigrationContext,
	simulate: simulateSettlement,
	submit: submitFreshSettlement,
}

type SettlementQuote = Awaited<ReturnType<typeof simulateSettlement>> & Readonly<{ account: Address; walletClient: WalletClient; inputRevision: number }>

function resolvedQuestionOutcome(outcome: number): ShareOutcome | undefined {
	if (outcome === 0) return settlementCopy.invalid
	if (outcome === 1) return settlementCopy.yes
	if (outcome === 2) return settlementCopy.no
	return undefined
}

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
				return await services.approveRouter(walletClient, market, configuration, account)
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
					<span class='section-kicker'>{settlementCopy.sectionKicker}</span>
					<h3>{settlementCopy.sectionTitle}</h3>
				</div>
			</div>
			<div class='segmented' aria-label={settlementCopy.operationLabel}>
				<button
					aria-pressed={operation === 'redeem-complete-set'}
					disabled={workflowLocked}
					onClick={() => {
						invalidateSettlementInputs()
						setOperation('redeem-complete-set')
					}}
				>
					{settlementCopy.completeSetAction}
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
						{settlementCopy.redeemOutcomeAction(winningOutcome)}
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
					{settlementCopy.forkMigrationAction}
				</button>
			</div>
			{(() => {
				if (operation === 'redeem-complete-set')
					return (
						<>
							<p>
								{settlementCopy.completeSetRedemptionPrefix} {settlementBalanceLabel(balanceState, availability.completeSets)}.
							</p>
							<label class='field'>
								<span>{settlementCopy.completeSetSharesToRedeem}</span>
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
									<span>{settlementCopy.shares}</span>
								</div>
							</label>
						</>
					)
				if (operation === 'redeem-winning-shares') return winningOutcome === undefined ? <p>{settlementCopy.winningRedemptionUnavailable}</p> : <p>{settlementCopy.winningRedemptionGuidance(winningOutcome, settlementBalanceLabel(balanceState, availability.winningBalance, winningOutcome))}</p>
				return (
					<>
						<p>{settlementCopy.migrationGuidance}</p>
						<label class='field'>
							<span>{settlementCopy.sourceShare}</span>
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
								<option value='INVALID'>{settlementCopy.invalid}</option>
								<option value='YES'>{settlementCopy.yes}</option>
								<option value='NO'>{settlementCopy.no}</option>
							</select>
						</label>
						<p>
							{settlementCopy.selectedSourceBalance} {settlementBalanceLabel(balanceState, sourceBalance, sourceOutcome)}
						</p>
						{forkContextState === 'loading' || forkContextState === 'idle' ? <p role='status'>{settlementCopy.loadingForkDetails}</p> : null}
						{forkContextState === 'error' ? (
							<div class='error' role='alert'>
								<p>{forkContextError ?? settlementCopy.forkDetailsUnavailable}</p>
								<button type='button' class='secondary-action' disabled={workflowLocked} onClick={() => setForkContextNonce(current => current + 1)}>
									{settlementCopy.retryForkDetails}
								</button>
							</div>
						) : null}
						{forkContext === undefined ? null : <ForkMigrationTargets context={forkContext} selectedTargets={selectedForkTargets} disabled={workflowLocked} onChange={updateForkTargets} />}
						{forkMigrationBatchWarning(selectedForkTargets) === undefined ? null : <p class='warning'>{forkMigrationBatchWarning(selectedForkTargets)}</p>}
					</>
				)
			})()}
			{transactionHash === undefined ? null : <TradingTransactionHash hash={transactionHash} />}
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
			<ErrorNotice message={receiptWarning} />
			{balanceState === 'error' ? <BalanceLoadError message={balanceError ?? settlementCopy.walletBalancesUnavailable} retry={retryBalances} disabled={workflowLocked} /> : null}
			<ErrorNotice message={state === 'error' ? error : undefined} />
			{!(state === 'error' && error !== undefined) && (balanceState !== 'error' || state === 'confirmed' || state === 'approval-confirmed') && receiptWarning === undefined && !suppressRedundantProtectionStatus ? (
				<p class={state === 'error' ? 'error' : undefined} role={state === 'error' ? 'alert' : 'status'} aria-live={state === 'error' ? 'assertive' : 'polite'}>
					{settlementStatus}
				</p>
			) : null}
			{approvalRequired ? (
				<>
					<p>{workflowCopy.erc1155ApprovalScopeWarning}</p>
					<TransactionActionButton
						disabled={workflowLocked || balanceState !== 'ready' || walletClient === undefined || account === undefined}
						idleLabel={workflowCopy.approveSettlement}
						pending={state === 'preparing' || state === 'approval' || state === 'approval-pending'}
						pendingLabel={workflowCopy.approvingRouter}
						onClick={() => void approveCompleteSetRouter()}
					/>
				</>
			) : null}
			{!approvalRequired && actionableQuote === undefined ? (
				<TransactionActionButton
					disabled={inputBlocker !== undefined || balanceState !== 'ready' || walletClient === undefined || account === undefined || workflowLocked}
					idleLabel={workflowCopy.simulateSettlement}
					pending={state === 'simulating'}
					pendingLabel={workflowCopy.simulatingSettlement}
					onClick={() => void simulateCurrent()}
				/>
			) : null}
			{!approvalRequired && actionableQuote !== undefined ? (
				<TransactionActionButton
					disabled={workflowLocked || state !== 'ready'}
					idleLabel={actionableQuote.operation === 'migrate-shares' ? workflowCopy.migrationSubmission(actionableQuote.targetOutcomeIndexes.length) : workflowCopy.submitSettlement}
					pending={state === 'preparing' || state === 'submitting' || state === 'pending'}
					pendingLabel={workflowCopy.submittingSettlement}
					onClick={() => void submitCurrent()}
				/>
			) : null}
		</div>
	)
}
