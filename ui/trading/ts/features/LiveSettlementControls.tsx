import { useEffect, useId, useMemo, useState } from 'preact/hooks'
import type { Address, PublicClient, WalletClient } from '@zoltar/core-shared/evm/ethereum'
import { formatUnits, parseUnitsOrUndefined } from '../lib/format.js'
import { collateralAttoEthToAttoShares } from '../lib/shareValue.js'
import { ForkMigrationTargets } from './ForkMigrationTargets.js'
import type { DeploymentConfiguration } from '../protocol/config.js'
import { loadForkMigrationContext, type ForkMigrationContext, type ForkTarget } from '../protocol/forks.js'
import { createTradingPublicClient, publicErrorMessage, settlementAvailability, simulateSettlement, submitFreshSettlement, type LiveBalances, type LiveMarket, type SettlementOperation, type ShareOutcome } from '../protocol/live.js'
import * as workflowCopy from '../copy/workflows.js'
import * as settlementCopy from '../copy/settlement.js'
import { EnumDropdown } from '@zoltar/ui-core-shared/components/EnumDropdown.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { TransactionActionButton, TransactionActionGroup } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { ViewTabs } from '@zoltar/ui-core-shared/components/ViewTabs.js'
import { parseSlippageBps, parseTransactionValidityMinutes, type GuardedWalletWrite } from './liveTradingControllerHelpers.js'
import type { BalanceState } from './live/liveTradingTypes.js'
import { BalanceLoadError, DEFAULT_SLIPPAGE_PERCENT, DEFAULT_TRANSACTION_VALIDITY_MINUTES, ExecutionProtectionFields, formatTimestamp, stateLabel, TradingField, TradingTransactionHash } from './LiveTradingTransactionUi.js'
import { forkMigrationBatchBlocker, forkMigrationBatchWarning, migrationSimulationSummary, settlementBalanceLabel, settlementInputBlocker } from './LiveSettlementModel.js'
import { useSettlementWorkflowController } from './live/useSettlementWorkflowController.js'
import { resolveSettlementSimulateAvailability, resolveSettlementSubmitAvailability, resolveActionGroupMessage } from './live/actionAvailability.js'
import { useFocusOnKeyChange } from './live/useFocusOnKeyChange.js'

export type LiveSettlementServices = Readonly<{
	createPublicClient(configuration: DeploymentConfiguration): PublicClient
	loadForkContext: typeof loadForkMigrationContext
	simulate: typeof simulateSettlement
	submit: typeof submitFreshSettlement
}>

export const liveSettlementServices: LiveSettlementServices = {
	createPublicClient: createTradingPublicClient,
	loadForkContext: loadForkMigrationContext,
	simulate: simulateSettlement,
	submit: submitFreshSettlement,
}

function resolvedQuestionOutcome(outcome: number): ShareOutcome | undefined {
	if (outcome === 0) return settlementCopy.invalid
	if (outcome === 1) return settlementCopy.yes
	if (outcome === 2) return settlementCopy.no
	return undefined
}

export function LiveSettlementControls({
	configuration,
	market,
	balances,
	balanceState,
	balanceError,
	account,
	walletClient,
	networkMismatchReason,
	externallyLocked,
	refresh,
	onKnownReceipt,
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
	networkMismatchReason: string | undefined
	externallyLocked: boolean
	refresh(): Promise<void>
	onKnownReceipt(): void
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
	const forkClient = useMemo(() => services.createPublicClient(configuration), [configuration, services])
	const availability = settlementAvailability(market, balances)
	const winningOutcome = resolvedQuestionOutcome(market.questionOutcome)
	const parsedAmountAttoEth = parseUnitsOrUndefined(amount)
	const parsedAmount = parsedAmountAttoEth === undefined ? undefined : collateralAttoEthToAttoShares(parsedAmountAttoEth, market)
	const targetOutcomeIndexes = useMemo(() => selectedForkTargets.map(target => target.outcomeIndex), [selectedForkTargets])
	const targetOutcomeKey = targetOutcomeIndexes.map(target => target.toString()).join(',')
	let operationAvailable = availability.canMigrateShares
	if (operation === 'redeem-complete-set') operationAvailable = availability.canRedeemCompleteSets
	else if (operation === 'redeem-winning-shares') operationAvailable = availability.canRedeemWinningShares
	let sourceBalance = balances?.no
	if (sourceOutcome === 'INVALID') sourceBalance = balances?.invalid
	else if (sourceOutcome === 'YES') sourceBalance = balances?.yes
	const slippageBps = parseSlippageBps(slippage)
	const validityMinutes = parseTransactionValidityMinutes(transactionValidityMinutes)
	let inputBlocker = settlementInputBlocker(operation, operationAvailable, availability.completeSets, parsedAmount, targetOutcomeIndexes, sourceOutcome, sourceBalance, market)
	if (operation === 'migrate-shares' && operationAvailable) {
		if (forkContextState === 'loading' || forkContextState === 'idle') inputBlocker = settlementCopy.loadingForkDetailsReason
		else if (forkContextState === 'error' || forkContext === undefined) inputBlocker = forkContextError ?? settlementCopy.forkDetailsUnavailableReason
		else inputBlocker ??= forkMigrationBatchBlocker(selectedForkTargets)
	}
	let protectionInputBlocker: string | undefined
	if (operation === 'redeem-complete-set' && slippageBps === undefined) protectionInputBlocker = settlementCopy.slippageRangeReason
	else if (operation === 'redeem-complete-set' && validityMinutes === undefined) protectionInputBlocker = settlementCopy.validityRangeReason
	if (protectionInputBlocker !== undefined) inputBlocker = protectionInputBlocker
	// The pool rate is part of the quote basis: a background refresh that moves it retires the quote deliberately.
	const contextKey = `${account ?? ''}\u0000${configuration.chainId.toString()}\u0000${market.pool}\u0000${market.settlementCollateralAttoEth.toString()}\u0000${market.shareTokenSupplyAttoShares.toString()}\u0000${market.systemState}\u0000${market.awaitingForkContinuation ? '1' : '0'}\u0000${market.universeForkTime.toString()}\u0000${market.questionOutcome.toString()}\u0000${operation}\u0000${amount}\u0000${slippage}\u0000${sourceOutcome}\u0000${transactionValidityMinutes}\u0000${targetOutcomeKey}`
	const workflowController = useSettlementWorkflowController({
		configuration,
		market,
		account,
		walletClient,
		externallyLocked,
		balanceState,
		operation,
		parsedAmount,
		sourceOutcome,
		targetOutcomeIndexes,
		inputBlocker,
		contextKey,
		refresh,
		onKnownReceipt,
		executeWithCurrentWalletContext,
		createGuardedWalletWrite,
		onWorkflowLockChange,
		onMigrationConfirmed: () => setForkContextNonce(current => current + 1),
		services,
	})
	const { state, transactionHash, error, receiptWarning, actionableQuote, workflowLocked, invalidateInputs: invalidateSettlementInputs, submitCurrent } = workflowController
	const simulateCurrent = () => workflowController.simulateCurrent({ validityMinutes, slippageBps })
	const availabilityInputs = {
		walletConnected: account !== undefined && walletClient !== undefined,
		networkMismatchReason,
		balanceState,
		// Settlement names the exact protection field that is out of range, so the generic protection reason is never needed here.
		inputBlocker,
		inputBlockerLoading: operation === 'migrate-shares' && operationAvailable && (forkContextState === 'loading' || forkContextState === 'idle'),
		protectionValid: true,
		workflowLocked,
	}
	const simulateAvailability = resolveSettlementSimulateAvailability(availabilityInputs)
	const submitAvailability = resolveSettlementSubmitAvailability({ ...availabilityInputs, quoteReady: state === 'ready' })
	const actionAvailability = actionableQuote === undefined ? simulateAvailability : submitAvailability
	// Idle with valid inputs shows nothing, matching the position controls; the action button already says what comes next.
	let statusText = state === 'error' ? undefined : stateLabel(state, settlementCopy.settlementTransaction)
	if (state === 'ready' && actionableQuote !== undefined) {
		if (actionableQuote.operation === 'migrate-shares') statusText = migrationSimulationSummary(actionableQuote.blockNumber, actionableQuote.sourceOutcome, BigInt(actionableQuote.targetOutcomeIndexes.length))
		else if (actionableQuote.operation === 'redeem-complete-set')
			statusText = settlementCopy.redemptionSimulationSummary(actionableQuote.blockNumber, formatUnits(actionableQuote.expectedAttoEth), formatUnits(actionableQuote.minimumAttoEth), formatUnits(actionableQuote.slippageBps, 2, 2), formatTimestamp(actionableQuote.deadline))
		else statusText = settlementCopy.settlementSimulationSummary(actionableQuote.blockNumber)
	}
	const outcomeRef = useFocusOnKeyChange<HTMLDivElement>(state === 'confirmed' ? transactionHash : undefined)
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
				setForkContextError(publicErrorMessage(caught, settlementCopy.forkDetailsLoadFailed))
			})
		return () => {
			active = false
		}
	}, [forkClient, forkContextNonce, market.pool, market.shareToken, market.universeForkTime, market.universeId, services])

	const amountId = useId()
	const selectOperation = (next: SettlementOperation) => {
		invalidateSettlementInputs()
		setOperation(next)
	}
	const operationOptions = [
		{ value: 'redeem-complete-set' as const, label: settlementCopy.completeSetAction, disabled: workflowLocked },
		...(winningOutcome === undefined ? [] : [{ value: 'redeem-winning-shares' as const, label: settlementCopy.redeemOutcomeAction(winningOutcome), disabled: workflowLocked }]),
		{ value: 'migrate-shares' as const, label: settlementCopy.forkMigrationAction, disabled: workflowLocked },
	]
	const groupMessage = resolveActionGroupMessage(state, actionAvailability, statusText)
	return (
		<div class='settlement-controls'>
			<ViewTabs ariaLabel={settlementCopy.operationLabel} semantics='switcher' variant='segmented' size='compact' value={operation} onChange={selectOperation} options={operationOptions} />
			{(() => {
				if (operation === 'redeem-complete-set')
					return (
						<>
							<p class='detail'>
								{settlementCopy.completeSetRedemptionPrefix} {settlementBalanceLabel(balanceState, availability.completeSets, market)}.
							</p>
							<TradingField id={amountId} label={settlementCopy.completeSetValueToRedeem}>
								<FormInput
									id={amountId}
									name='amount'
									value={amount}
									disabled={workflowLocked}
									inputMode='decimal'
									adornment={settlementCopy.eth}
									onInput={event => {
										invalidateSettlementInputs()
										setAmount(event.currentTarget.value)
									}}
								/>
							</TradingField>
						</>
					)
				if (operation === 'redeem-winning-shares') return <p class='detail'>{winningOutcome === undefined ? settlementCopy.winningRedemptionUnavailable : settlementCopy.winningRedemptionGuidance(winningOutcome, settlementBalanceLabel(balanceState, availability.winningBalance, market, winningOutcome))}</p>
				return (
					<>
						<p class='detail'>{settlementCopy.migrationGuidance}</p>
						<div class='field'>
							<span>{settlementCopy.sourceShare}</span>
							<EnumDropdown
								ariaLabel={settlementCopy.sourceShare}
								value={sourceOutcome}
								disabled={workflowLocked}
								options={[
									{ value: 'INVALID', label: settlementCopy.invalid },
									{ value: 'YES', label: settlementCopy.yes },
									{ value: 'NO', label: settlementCopy.no },
								]}
								onChange={value => {
									invalidateSettlementInputs()
									setSourceOutcome(value)
								}}
							/>
						</div>
						<p class='detail'>
							{settlementCopy.selectedSourceBalance} {settlementBalanceLabel(balanceState, sourceBalance, market, sourceOutcome)}
						</p>
						{forkContextState === 'loading' || forkContextState === 'idle' ? (
							<p class='detail' role='status'>
								{settlementCopy.loadingForkDetails}
							</p>
						) : null}
						{forkContextState === 'error' ? (
							<>
								<ErrorNotice message={forkContextError ?? settlementCopy.forkDetailsUnavailable} />
								<div class='actions'>
									<button type='button' class='secondary' disabled={workflowLocked} onClick={() => setForkContextNonce(current => current + 1)}>
										{settlementCopy.retryForkDetails}
									</button>
								</div>
							</>
						) : null}
						{forkContext === undefined ? null : <ForkMigrationTargets context={forkContext} selectedTargets={selectedForkTargets} disabled={workflowLocked} onChange={updateForkTargets} />}
						{forkMigrationBatchWarning(selectedForkTargets) === undefined ? null : <p class='warning'>{forkMigrationBatchWarning(selectedForkTargets)}</p>}
					</>
				)
			})()}
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
			{balanceState === 'error' ? <BalanceLoadError message={balanceError ?? settlementCopy.walletBalancesUnavailable} retry={retryBalances} disabled={workflowLocked} /> : null}
			<div class='transaction-outcome' ref={outcomeRef} tabIndex={-1}>
				{transactionHash === undefined ? null : <TradingTransactionHash hash={transactionHash} />}
				<ErrorNotice message={receiptWarning} />
				<ErrorNotice message={state === 'error' ? error : undefined} />
				<TransactionActionGroup loading={actionAvailability.loading === true} message={groupMessage}>
					{actionableQuote === undefined ? <TransactionActionButton availability={simulateAvailability} idleLabel={workflowCopy.simulateSettlement} pending={state === 'simulating'} pendingLabel={workflowCopy.simulatingSettlement} onClick={() => void simulateCurrent()} /> : null}
					{actionableQuote !== undefined ? (
						<TransactionActionButton
							availability={submitAvailability}
							idleLabel={actionableQuote.operation === 'migrate-shares' ? workflowCopy.migrationSubmission(actionableQuote.targetOutcomeIndexes.length) : workflowCopy.submitSettlement}
							pending={state === 'preparing' || state === 'submitting' || state === 'pending'}
							pendingLabel={workflowCopy.submittingSettlement}
							onClick={() => void submitCurrent()}
						/>
					) : null}
				</TransactionActionGroup>
			</div>
		</div>
	)
}
