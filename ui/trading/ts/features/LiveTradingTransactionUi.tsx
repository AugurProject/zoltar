import { useId } from 'preact/hooks'
import type { Hash } from '@zoltar/shared/ethereum'
import { bigintToSafeNumber, formatOutcomeAmount, formatUnits } from '../lib/format.js'
import * as workflowCopy from '../copy/workflows.js'
import { TransactionHashLink } from '@zoltar/ui-core-shared/components/TransactionHashLink.js'
import { TransactionReview } from '@zoltar/ui-core-shared/components/TransactionReview.js'
import { parseSlippageBps, parseTransactionValidityMinutes } from './liveTradingControllerHelpers.js'
import type { Quote, TransactionState } from './live/liveTradingTypes.js'

export const DEFAULT_SLIPPAGE_PERCENT = '0.5'
export const DEFAULT_TRANSACTION_VALIDITY_MINUTES = '20'

export function formatTimestamp(timestamp: bigint) {
	const maximumDateSeconds = 8_640_000_000_000n
	if (timestamp < 0n || timestamp > maximumDateSeconds) return workflowCopy.unsupportedOnchainTimestamp
	const date = new Date(bigintToSafeNumber(timestamp * 1_000n, workflowCopy.timestamp))
	if (Number.isNaN(date.getTime())) return workflowCopy.unsupportedOnchainTimestamp
	try {
		return `${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: workflowCopy.utc }).format(date)} ${workflowCopy.utc}`
	} catch (error) {
		return error instanceof Error ? workflowCopy.timestampFormattingFailedDetail(error.message) : workflowCopy.timestampFormattingFailed
	}
}

export function stateLabel(state: TransactionState, action = workflowCopy.defaultTransactionAction) {
	if (state === 'simulating') return workflowCopy.simulatingRouterCall
	if (state === 'ready') return workflowCopy.authoritativeSimulationReady
	if (state === 'preparing') return workflowCopy.preparingAction(action)
	if (state === 'approval') return workflowCopy.actionApprovalPendingInWallet(action)
	if (state === 'approval-pending') return workflowCopy.actionApprovalPendingOnchain(action)
	if (state === 'approval-confirmed') return workflowCopy.actionApprovalConfirmedOnchain(action)
	if (state === 'submitting') return workflowCopy.actionPendingInWallet(action)
	if (state === 'pending') return workflowCopy.actionPendingOnchain(action)
	if (state === 'confirmed') return workflowCopy.actionConfirmedOnchain(action)
	if (state === 'error') return workflowCopy.transactionWorkflowNeedsAttention
	return workflowCopy.readyToSimulate
}

type EntrySummaryValue = Readonly<{
	amount: Extract<Quote, { kind: 'entry' }>['value']['amount']
	market: Pick<Extract<Quote, { kind: 'entry' }>['value']['market'], 'feeBps'>
	result: Pick<Extract<Quote, { kind: 'entry' }>['value']['result'], 'totalLongShares' | 'invalidInsurance'>
}>
type ExitSummaryValue = Readonly<{
	market: Pick<Extract<Quote, { kind: 'exit' }>['value']['market'], 'feeBps'>
	result: Pick<Extract<Quote, { kind: 'exit' }>['value']['result'], 'totalLongShares' | 'invalidInsurance' | 'ethOut'>
}>
type LiveTradeSummaryQuote = Readonly<{ kind: 'entry'; value: EntrySummaryValue }> | Readonly<{ kind: 'exit'; value: ExitSummaryValue }>

export function renderLiveTradeSummary(quote: LiveTradeSummaryQuote, side: 'YES' | 'NO') {
	const primary =
		quote.kind === 'entry'
			? [
					{ label: workflowCopy.youPay, value: `${formatUnits(quote.value.amount)} ETH` },
					{ label: workflowCopy.youReceive, value: formatOutcomeAmount(quote.value.result.totalLongShares, side) },
				]
			: [
					{ label: workflowCopy.youUse, value: formatOutcomeAmount(quote.value.result.totalLongShares, side) },
					{ label: workflowCopy.youReceive, value: `${formatUnits(quote.value.result.ethOut)} ETH` },
				]
	return (
		<div class='trade-summary trade-summary--review' aria-label={workflowCopy.tradeSummary}>
			<TransactionReview
				variant='inline'
				primary={primary}
				details={[
					{ label: quote.kind === 'entry' ? workflowCopy.invalidReceived : workflowCopy.invalidRequired, value: formatOutcomeAmount(quote.value.result.invalidInsurance, 'INVALID') },
					{ label: workflowCopy.tradingFee, value: `${formatUnits(quote.value.market.feeBps, 2, 2)}%` },
				]}
			/>
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
	const slippageErrorId = `${fieldId}-slippage-error`
	const validityErrorId = `${fieldId}-validity-error`
	return (
		<fieldset class='execution-settings'>
			<legend>{workflowCopy.transactionProtection}</legend>
			<div class='execution-settings__fields'>
				<label class='field'>
					<span>{workflowCopy.slippageTolerance}</span>
					<div class='amount-input'>
						<input value={slippage} disabled={disabled} inputMode='decimal' aria-invalid={slippageBps === undefined} aria-describedby={slippageBps === undefined ? slippageErrorId : undefined} onInput={event => onSlippageInput(event.currentTarget.value)} />
						<span>{workflowCopy.percent}</span>
					</div>
					{slippageBps === undefined ? (
						<small class='error' id={slippageErrorId} role='alert'>
							{workflowCopy.slippageValidation}
						</small>
					) : null}
				</label>
				<label class='field'>
					<span>{workflowCopy.transactionValidFor}</span>
					<div class='amount-input'>
						<input value={validityMinutes} disabled={disabled} inputMode='numeric' aria-invalid={parsedValidityMinutes === undefined} aria-describedby={parsedValidityMinutes === undefined ? validityErrorId : undefined} onInput={event => onValidityInput(event.currentTarget.value)} />
						<span>{workflowCopy.minutes}</span>
					</div>
					{parsedValidityMinutes === undefined ? (
						<small class='error' id={validityErrorId} role='alert'>
							{workflowCopy.validityValidation}
						</small>
					) : null}
				</label>
			</div>
			<small>{workflowCopy.transactionProtectionGuidance}</small>
		</fieldset>
	)
}

export function BalanceLoadError({ message, retry, disabled = false }: { message: string; retry(): Promise<void>; disabled?: boolean }) {
	return (
		<div class='balance-recovery'>
			<p class='error' role='alert'>
				{message}
			</p>
			<button class='secondary-action' disabled={disabled} onClick={() => void retry()}>
				{workflowCopy.retryBalances}
			</button>
		</div>
	)
}
