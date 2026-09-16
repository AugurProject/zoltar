import * as payoutCopy from '../copy/payout.js'
import type { ComponentChildren } from 'preact'
import { useId } from 'preact/hooks'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js'
import type { Hash } from '@zoltar/core-shared/evm/ethereum'
import { bigintToSafeNumber, formatRoundedUnits, formatUnits } from '../lib/format.js'
import { formatCollateralEth, formatOutcomeQuantity, type ShareValueRate } from '../lib/shareValue.js'
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
					{ label: workflowCopy.tradingFee, value: `${formatUnits(quote.value.market.feeBps, 2, 2)}%` },
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

/** Labelled form field: the label targets the control so validation text can follow the input. */
export function TradingField({ id, label, children }: { id: string; label: ComponentChildren; children: ComponentChildren }) {
	return (
		<div class='field'>
			<label for={id}>
				<span>{label}</span>
			</label>
			{children}
		</div>
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
				<TradingField id={slippageId} label={workflowCopy.slippageTolerance}>
					<FormInput id={slippageId} value={slippage} disabled={disabled} inputMode='decimal' adornment={workflowCopy.percent} error={slippageBps === undefined ? workflowCopy.slippageValidation : undefined} onInput={event => onSlippageInput(event.currentTarget.value)} />
				</TradingField>
				<TradingField id={validityId} label={workflowCopy.transactionValidFor}>
					<FormInput id={validityId} value={validityMinutes} disabled={disabled} inputMode='numeric' adornment={workflowCopy.minutes} error={parsedValidityMinutes === undefined ? workflowCopy.validityValidation : undefined} onInput={event => onValidityInput(event.currentTarget.value)} />
				</TradingField>
			</DataGrid>
			<p class='detail'>{workflowCopy.transactionProtectionGuidance}</p>
		</WorkflowSubsection>
	)
}

export function BalanceLoadError({ message, retry, disabled = false }: { message: string; retry(): Promise<void>; disabled?: boolean }) {
	return (
		<div class='balance-recovery'>
			<ErrorNotice message={message} />
			<div class='actions'>
				<button class='secondary' type='button' disabled={disabled} onClick={() => void retry()}>
					{workflowCopy.retryBalances}
				</button>
			</div>
		</div>
	)
}
