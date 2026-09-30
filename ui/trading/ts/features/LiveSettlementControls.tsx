import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { FormField } from '@zoltar/ui-core-shared/components/FormField.js'
import { useEffect, useId, useMemo, useState } from 'preact/hooks'
import type { PublicClient } from '@zoltar/core-shared/evm/ethereum'
import { formatTrimmedUnits } from '@zoltar/ui-core-shared/lib/formatters.js'
import { tryParseNonNegativeDecimalInput } from '@zoltar/ui-core-shared/forms/decimal.js'
import { collateralAttoEthToAttoShares } from '../lib/shareValue.js'
import { formatSlippagePercent } from '../lib/tradeSettings.js'
import * as settingsCopy from '../copy/tradeSettings.js'
import { TransactionReview } from '@zoltar/ui-core-shared/components/TransactionReview.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { ForkMigrationTargets } from './ForkMigrationTargets.js'
import type { DeploymentConfiguration } from '../protocol/config.js'
import { loadForkMigrationContext, type ForkMigrationContext, type ForkTarget } from '../protocol/forks.js'
import { createTradingPublicClient, publicErrorMessage, settlementAvailability, simulateSettlement, submitFreshSettlement, type SettlementOperation, type ShareOutcome } from '../protocol/live.js'
import * as settlementCopy from '../copy/settlement.js'
import * as workflowCopy from '../copy/workflows.js'
import { resolvedShareOutcome } from '../lib/marketLabels.js'
import { EnumDropdown } from '@zoltar/ui-core-shared/components/EnumDropdown.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import { WarningSurface } from '@zoltar/ui-core-shared/components/WarningSurface.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { ViewTabs } from '@zoltar/ui-core-shared/components/ViewTabs.js'
import type { LiveWorkflowPanelProps } from './live/liveTradingTypes.js'
import { BalanceLoadError } from './LiveTradingTransactionUi.js'
import { panelWalletStep, QuotedTransactionPanel } from './QuotedTransactionPanel.js'
import { forkMigrationBatchBlocker, forkMigrationBatchWarning, migrationSimulationSummary, settlementBalanceLabel, settlementInputBlocker } from './LiveSettlementModel.js'
import { useSettlementWorkflowController } from './live/useSettlementWorkflowController.js'
import { resolveSettlementAvailability } from './live/actionAvailability.js'

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

export function LiveSettlementControls({ balances, balanceError, networkMismatchReason, wallet, retryBalances, services = liveSettlementServices, ...context }: LiveWorkflowPanelProps & Readonly<{ services?: LiveSettlementServices }>) {
	const { configuration, market, balanceState, account, walletClient, settings } = context
	let initialOperation: SettlementOperation = 'redeem-complete-set'
	if (market.universeForkTime !== 0n) initialOperation = 'migrate-shares'
	else if (market.questionOutcome !== 3) initialOperation = 'redeem-winning-shares'
	const [operation, setOperation] = useState<SettlementOperation>(initialOperation)
	const [amount, setAmount] = useState('')
	const [sourceOutcome, setSourceOutcome] = useState<ShareOutcome>('YES')
	const [forkContext, setForkContext] = useState<ForkMigrationContext>()
	const [forkContextState, setForkContextState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
	const [forkContextError, setForkContextError] = useState<string>()
	const [forkContextNonce, setForkContextNonce] = useState(0)
	const [selectedForkTargets, setSelectedForkTargets] = useState<readonly ForkTarget[]>([])
	const forkClient = useMemo(() => services.createPublicClient(configuration), [configuration, services])
	const availability = settlementAvailability(market, balances)
	const winningOutcome = resolvedShareOutcome(market.questionOutcome)
	const parsedAmountAttoEth = tryParseNonNegativeDecimalInput(amount)
	const parsedAmount = parsedAmountAttoEth === undefined ? undefined : collateralAttoEthToAttoShares(parsedAmountAttoEth, market)
	const targetOutcomeIndexes = useMemo(() => selectedForkTargets.map(target => target.outcomeIndex), [selectedForkTargets])
	const targetOutcomeKey = targetOutcomeIndexes.map(target => target.toString()).join(',')
	let operationAvailable = availability.canMigrateShares
	if (operation === 'redeem-complete-set') operationAvailable = availability.canRedeemCompleteSets
	else if (operation === 'redeem-winning-shares') operationAvailable = availability.canRedeemWinningShares
	let sourceBalance = balances?.no
	if (sourceOutcome === 'INVALID') sourceBalance = balances?.invalid
	else if (sourceOutcome === 'YES') sourceBalance = balances?.yes
	let inputBlocker = settlementInputBlocker(operation, operationAvailable, availability.completeSets, parsedAmount, targetOutcomeIndexes, sourceOutcome, sourceBalance, market)
	if (operation === 'migrate-shares' && operationAvailable) {
		if (forkContextState === 'loading' || forkContextState === 'idle') inputBlocker = settlementCopy.loadingForkDetailsReason
		else if (forkContextState === 'error' || forkContext === undefined) inputBlocker = forkContextError ?? settlementCopy.forkDetailsUnavailableReason
		else inputBlocker ??= forkMigrationBatchBlocker(selectedForkTargets)
	}
	// The pool rate is part of the quote basis: a background refresh that moves it retires the quote deliberately.
	const contextKey = `${account ?? ''}\u0000${configuration.chainId.toString()}\u0000${market.pool}\u0000${market.settlementCollateralAttoEth.toString()}\u0000${market.shareTokenSupplyAttoShares.toString()}\u0000${market.systemState}\u0000${market.awaitingForkContinuation ? '1' : '0'}\u0000${market.universeForkTime.toString()}\u0000${market.questionOutcome.toString()}\u0000${operation}\u0000${amount}\u0000${sourceOutcome}\u0000${targetOutcomeKey}`
	const workflowController = useSettlementWorkflowController({
		...context,
		operation,
		parsedAmount,
		sourceOutcome,
		targetOutcomeIndexes,
		inputBlocker,
		contextKey,
		onRedemptionConfirmed: () => setAmount(''),
		onMigrationConfirmed: () => setForkContextNonce(current => current + 1),
		services,
	})
	const { transaction, invalidateInputs: invalidateSettlementInputs, submitCurrent } = workflowController
	const { quote, state, workflowLocked } = transaction
	const walletConnected = account !== undefined && walletClient !== undefined
	const actionAvailability = resolveSettlementAvailability({
		walletConnected,
		networkMismatchReason,
		balanceState,
		inputBlocker,
		inputBlockerLoading: operation === 'migrate-shares' && operationAvailable && (forkContextState === 'loading' || forkContextState === 'idle'),
		workflowLocked,
		quoteState: transaction.quoteState,
		quoteError: transaction.quoteError,
	})
	const walletStep = panelWalletStep(wallet, walletConnected && networkMismatchReason === undefined, workflowLocked)
	let actionLabel = settlementCopy.redeemCompleteSetsAction
	if (operation === 'redeem-winning-shares' && winningOutcome !== undefined) actionLabel = settlementCopy.redeemOutcomeAction(winningOutcome)
	else if (operation === 'migrate-shares') actionLabel = settlementCopy.migrationAction(selectedForkTargets.length)
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
	return (
		<div className='settlement-controls'>
			<ViewTabs ariaLabel={settlementCopy.operationLabel} semantics='switcher' variant='segmented' size='compact' value={operation} onChange={selectOperation} options={operationOptions} />
			{(() => {
				if (operation === 'redeem-complete-set')
					return (
						<>
							<UserMessage
								className='detail'
								detail={
									<>
										{settlementCopy.completeSetRedemptionPrefix} {settlementBalanceLabel(balanceState, availability.completeSets, market)}.
									</>
								}
							/>
							<FormField id={amountId} label={settlementCopy.completeSetValueToRedeem}>
								<FormInput
									id={amountId}
									name='amount'
									value={amount}
									placeholder={workflowCopy.amountPlaceholder}
									autoComplete='off'
									disabled={workflowLocked}
									inputMode='decimal'
									adornment={settlementCopy.eth}
									error={amount.trim() !== '' && operationAvailable ? inputBlocker : undefined}
									onInput={event => {
										invalidateSettlementInputs()
										setAmount(event.currentTarget.value)
									}}
								/>
							</FormField>
						</>
					)
				if (operation === 'redeem-winning-shares')
					return <UserMessage className='detail' detail={<>{winningOutcome === undefined ? settlementCopy.winningRedemptionUnavailable : settlementCopy.winningRedemptionGuidance(winningOutcome, settlementBalanceLabel(balanceState, availability.winningBalance, market, winningOutcome))}</>} />
				return (
					<>
						<UserMessage className='detail' detail={<>{settlementCopy.migrationGuidance}</>} />
						<div className='field'>
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
						<UserMessage
							className='detail'
							detail={
								<>
									{settlementCopy.selectedSourceBalance} {settlementBalanceLabel(balanceState, sourceBalance, market, sourceOutcome)}
								</>
							}
						/>
						{forkContextState === 'loading' || forkContextState === 'idle' ? <StateHint announcement='polite' presentation={{ key: 'loading', badgeLabel: commonCopy.loading, badgeTone: 'loading', detail: settlementCopy.loadingForkDetails, detailIsLoading: true }} /> : null}
						{forkContextState === 'error' ? (
							<>
								<ErrorNotice message={forkContextError ?? settlementCopy.forkDetailsUnavailable} />
								<div className='actions'>
									<button type='button' className='secondary' disabled={workflowLocked} onClick={() => setForkContextNonce(current => current + 1)}>
										{settlementCopy.retryForkDetails}
									</button>
								</div>
							</>
						) : null}
						{forkContext === undefined ? null : <ForkMigrationTargets context={forkContext} selectedTargets={selectedForkTargets} disabled={workflowLocked} onChange={updateForkTargets} />}
						{forkMigrationBatchWarning(selectedForkTargets) === undefined ? null : (
							<WarningSurface role='status' surface='flat' variant='compact'>
								<p>{forkMigrationBatchWarning(selectedForkTargets)}</p>
							</WarningSurface>
						)}
					</>
				)
			})()}
			{balanceState === 'error' && networkMismatchReason === undefined ? <BalanceLoadError message={balanceError ?? settlementCopy.walletBalancesUnavailable} retry={retryBalances} disabled={workflowLocked} /> : null}
			<QuotedTransactionPanel phase={state} actionLabel={actionLabel} availability={actionAvailability} transactionHash={transaction.transactionHash} receiptWarning={transaction.receiptWarning} error={transaction.error} walletStep={walletStep} onSubmit={() => void submitCurrent()}>
				{transaction.quoteState === 'loading' && quote === undefined ? <LoadingText>{settlementCopy.gettingQuote}</LoadingText> : null}
				{quote?.operation === 'redeem-complete-set' ? (
					<section className='trade-estimate' aria-label={settlementCopy.quoteHeading} aria-busy={transaction.quoteState === 'loading'}>
						<TransactionReview variant='inline' primary={[{ label: settlementCopy.youReceive, value: `${formatTrimmedUnits(quote.expectedAttoEth)} ${settlementCopy.eth}` }]} details={[{ label: settlementCopy.minimumReceived, value: `${formatTrimmedUnits(quote.minimumAttoEth)} ${settlementCopy.eth}` }]} />
						<UserMessage className='detail trade-estimate-note' detail={<>{settingsCopy.protectionSummary(formatSlippagePercent(settings.slippageBps), settings.validityMinutes)}</>} />
					</section>
				) : null}
				{quote?.operation === 'migrate-shares' ? <UserMessage className='detail' detail={<>{migrationSimulationSummary(quote.blockNumber, quote.sourceOutcome, BigInt(quote.targetOutcomeIndexes.length))}</>} /> : null}
			</QuotedTransactionPanel>
		</div>
	)
}
