import { FormField } from '@zoltar/ui-core-shared/components/FormField.js'
import * as payoutCopy from '../copy/payout.js'
import { useId } from 'preact/hooks'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js'
import type { Hash } from '@zoltar/core-shared/evm/ethereum'
import { formatTrimmedUnits } from '@zoltar/ui-core-shared/lib/formatters.js'
import { formatRoundedUnits } from '../lib/format.js'
import { formatCollateralEth, formatOutcomeQuantity, type ShareValueRate } from '../lib/shareValue.js'
import * as workflowCopy from '../copy/workflows.js'
import { TransactionHashLink } from '@zoltar/ui-core-shared/components/TransactionHashLink.js'
import { TransactionReview } from '@zoltar/ui-core-shared/components/TransactionReview.js'
import { parseSlippageBps, parseTransactionValidityMinutes } from './liveTradingControllerHelpers.js'
import type { Quote, TransactionState } from './live/liveTradingTypes.js'

export const DEFAULT_SLIPPAGE_PERCENT = '0.5'
export const DEFAULT_TRANSACTION_VALIDITY_MINUTES = '20'

export function stateLabel(state: TransactionState, action = workflowCopy.defaultTransactionAction) {
	if (state === 'simulating') return workflowCopy.simulatingRouterCall
	if (state === 'ready') return workflowCopy.authoritativeSimulationReady
	if (state === 'preparing') return workflowCopy.preparingAction(action)
	if (state === 'submitting') return workflowCopy.actionPendingInWallet(action)
	if (state === 'pending') return workflowCopy.actionPendingOnchain(action)
	if (state === 'confirmed') return workflowCopy.actionConfirmedOnchain(action)
	if (state === 'error') return workflowCopy.transactionWorkflowNeedsAttention
	return undefined
}

type SummaryMarket = Pick<Quote['value']['market'], 'feeBps'> & ShareValueRate
type EntrySummaryValue = Readonly<{
	amount: Extract<Quote, { kind: 'entry' }>['value']['amount']
	market: SummaryMarket
	result: Pick<Extract<Quote, { kind: 'entry' }>['value']['result'], 'totalLongShares' | 'invalidInsurance'>
}>
type ExitSummaryValue = Readonly<{
	market: SummaryMarket
	result: Pick<Extract<Quote, { kind: 'exit' }>['value']['result'], 'totalLongShares' | 'invalidInsurance' | 'ethOut'>
}>
type LiveTradeSummaryQuote = Readonly<{ kind: 'entry'; value: EntrySummaryValue }> | Readonly<{ kind: 'exit'; value: ExitSummaryValue }>

export function renderLiveTradeSummary(quote: LiveTradeSummaryQuote, side: 'YES' | 'NO') {
	const primary =
		quote.kind === 'entry'
			? [
					{ label: workflowCopy.youPay, value: `${formatRoundedUnits(quote.value.amount)} ETH` },
					{ label: workflowCopy.youReceive, value: formatOutcomeQuantity(quote.value.result.totalLongShares, side) },
				]
			: [
					{ label: workflowCopy.youUse, value: formatOutcomeQuantity(quote.value.result.totalLongShares, side) },
					{ label: workflowCopy.youReceive, value: `${formatRoundedUnits(quote.value.result.ethOut)} ETH` },
				]
	return (
		<div class='trade-summary trade-summary--review' aria-label={workflowCopy.tradeSummary}>
			<TransactionReview
				variant='inline'
				primary={primary}
				details={[
					{ label: quote.kind === 'entry' ? workflowCopy.invalidReceived : workflowCopy.invalidRequired, value: formatOutcomeQuantity(quote.value.result.invalidInsurance, 'INVALID') },
					{ label: workflowCopy.tradingFee, value: `${formatTrimmedUnits(quote.value.market.feeBps, 2, 2)}%` },
				]}
			/>
			{quote.kind === 'entry' ? (
				<p class='detail payout-note'>
					<strong>{payoutCopy.conditionalPayout(formatCollateralEth(quote.value.result.totalLongShares, quote.value.market), side)}</strong>
					{' · '}
					{payoutCopy.currentBacking}
					{' · '}
					{payoutCopy.otherwiseZero}
					<br />
					{payoutCopy.holdingFeeNote}
				</p>
			) : null}
		</div>
	)
}

export function TradingTransactionHash({ hash }: { hash: Hash }) {
	return (
		<p class='transaction-hash'>
			<span>{workflowCopy.transaction}</span>
			<TransactionHashLink hash={hash} />
		</p>
	)
}

export function ExecutionProtectionFields({ slippage, validityMinutes, disabled, onSlippageInput, onValidityInput }: { slippage: string; validityMinutes: string; disabled: boolean; onSlippageInput(value: string): void; onValidityInput(value: string): void }) {
	const slippageBps = parseSlippageBps(slippage)
	const parsedValidityMinutes = parseTransactionValidityMinutes(validityMinutes)
	const fieldId = useId()
	const slippageId = `${fieldId}-slippage`
	const validityId = `${fieldId}-validity`
	return (
		<WorkflowSubsection className='execution-protection' title={workflowCopy.transactionProtection}>
			<DataGrid columns={2}>
				<FormField id={slippageId} label={workflowCopy.slippageTolerance}>
					<FormInput id={slippageId} value={slippage} disabled={disabled} inputMode='decimal' adornment={workflowCopy.percent} error={slippageBps === undefined ? workflowCopy.slippageValidation : undefined} onInput={event => onSlippageInput(event.currentTarget.value)} />
				</FormField>
				<FormField id={validityId} label={workflowCopy.transactionValidFor}>
					<FormInput id={validityId} value={validityMinutes} disabled={disabled} inputMode='numeric' adornment={workflowCopy.minutes} error={parsedValidityMinutes === undefined ? workflowCopy.validityValidation : undefined} onInput={event => onValidityInput(event.currentTarget.value)} />
				</FormField>
			</DataGrid>
			<p class='detail'>{workflowCopy.transactionProtectionGuidance}</p>
		</WorkflowSubsection>
	)
}

export function BalanceLoadError({ message, retry, disabled = false }: { message: string; retry(): Promise<void>; disabled?: boolean }) {
	return (
		<div class='balance-recovery'>
			<RetryableNotice message={message} retryLabel={workflowCopy.retryBalances} disabled={disabled} onRetry={() => void retry()} />
		</div>
	)
}
