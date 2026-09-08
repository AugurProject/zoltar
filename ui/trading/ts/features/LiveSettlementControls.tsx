import { useEffect, useMemo, useState } from 'preact/hooks'
import type { Address, PublicClient, WalletClient } from '@zoltar/core-shared/evm/ethereum'
import { formatUnits, parseUnitsOrUndefined } from '../lib/format.js'
import { ForkMigrationTargets } from './ForkMigrationTargets.js'
import type { DeploymentConfiguration } from '../protocol/config.js'
import { loadForkMigrationContext, type ForkMigrationContext, type ForkTarget } from '../protocol/forks.js'
import { createTradingPublicClient, publicErrorMessage, settlementAvailability, simulateSettlement, submitFreshSettlement, type LiveBalances, type LiveMarket, type SettlementOperation, type ShareOutcome } from '../protocol/live.js'
import * as workflowCopy from '../copy/workflows.js'
import * as settlementCopy from '../copy/settlement.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { parseSlippageBps, parseTransactionValidityMinutes, type GuardedWalletWrite } from './liveTradingControllerHelpers.js'
import type { BalanceState } from './live/liveTradingTypes.js'
import { BalanceLoadError, DEFAULT_SLIPPAGE_PERCENT, DEFAULT_TRANSACTION_VALIDITY_MINUTES, ExecutionProtectionFields, formatTimestamp, TradingTransactionHash } from './LiveTradingTransactionUi.js'
import { forkMigrationBatchBlocker, forkMigrationBatchWarning, migrationSimulationSummary, settlementBalanceLabel, settlementInputBlocker } from './LiveSettlementModel.js'
import { useSettlementWorkflowController } from './live/useSettlementWorkflowController.js'

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
	const parsedAmount = parseUnitsOrUndefined(amount)
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
	const contextKey = `${account ?? ''}\u0000${configuration.chainId.toString()}\u0000${market.pool}\u0000${market.systemState}\u0000${market.awaitingForkContinuation ? '1' : '0'}\u0000${market.universeForkTime.toString()}\u0000${market.questionOutcome.toString()}\u0000${operation}\u0000${amount}\u0000${slippage}\u0000${sourceOutcome}\u0000${transactionValidityMinutes}\u0000${targetOutcomeKey}`
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
	const suppressRedundantProtectionStatus = protectionInputBlocker !== undefined && balanceState === 'ready' && state !== 'error'
	let settlementStatus = 'Connect a wallet to load balances for settlement'
	if (state === 'confirmed') settlementStatus = 'Settlement transaction confirmed on-chain'
	else if (balanceState === 'loading') settlementStatus = 'Loading wallet balances for settlement…'
	else if (balanceState === 'ready') {
		if (account === undefined || walletClient === undefined) settlementStatus = 'Connect a wallet to load balances for settlement'
		else if (state === 'preparing') settlementStatus = 'Preparing settlement transaction…'
		else if (state === 'submitting') settlementStatus = 'Settlement transaction pending in wallet…'
		else if (state === 'pending') settlementStatus = error ?? 'Settlement transaction pending on-chain…'
		else if (state === 'error') settlementStatus = error ?? 'Settlement workflow needs attention'
		else if (inputBlocker !== undefined) settlementStatus = inputBlocker
		else if (state === 'simulating') settlementStatus = 'Simulating the authoritative settlement call…'
		else if (state === 'ready' && actionableQuote !== undefined) {
			if (actionableQuote.operation === 'migrate-shares') settlementStatus = migrationSimulationSummary(actionableQuote.blockNumber, actionableQuote.sourceOutcome, BigInt(actionableQuote.targetOutcomeIndexes.length))
			else if (actionableQuote.operation === 'redeem-complete-set')
				settlementStatus = `Authoritative redemption simulation at block ${actionableQuote.blockNumber.toString()}: ${formatUnits(actionableQuote.expectedAttoEth)} ETH expected, ${formatUnits(actionableQuote.minimumAttoEth)} ETH minimum at ${formatUnits(actionableQuote.slippageBps, 2, 2)}% slippage; valid until ${formatTimestamp(actionableQuote.deadline)}`
			else settlementStatus = `Authoritative settlement simulation ready at block ${actionableQuote.blockNumber.toString()}`
		} else settlementStatus = 'Ready to simulate an authoritative protocol action'
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
			{!(state === 'error' && error !== undefined) && (balanceState !== 'error' || state === 'confirmed') && receiptWarning === undefined && !suppressRedundantProtectionStatus ? (
				<p class={state === 'error' ? 'error' : undefined} role={state === 'error' ? 'alert' : 'status'} aria-live={state === 'error' ? 'assertive' : 'polite'}>
					{settlementStatus}
				</p>
			) : null}
			{actionableQuote === undefined ? (
				<TransactionActionButton
					disabled={inputBlocker !== undefined || balanceState !== 'ready' || walletClient === undefined || account === undefined || workflowLocked}
					idleLabel={workflowCopy.simulateSettlement}
					pending={state === 'simulating'}
					pendingLabel={workflowCopy.simulatingSettlement}
					onClick={() => void simulateCurrent()}
				/>
			) : null}
			{actionableQuote !== undefined ? (
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
