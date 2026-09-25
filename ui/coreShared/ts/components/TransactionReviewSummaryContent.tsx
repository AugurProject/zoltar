import * as reviewCopy from '../copy/transactionReview.js'
import { useId } from 'preact/hooks'
import { FormInput } from './FormInput.js'
import { TransactionReview } from './TransactionReview.js'
import type { TransactionReviewConfirmation, TransactionReviewSeverity, TransactionReviewSummary } from '../transactions/transactionReviewSummary.js'

const severityLabels: Record<TransactionReviewSeverity, string> = { danger: reviewCopy.severityDanger, caution: reviewCopy.severityCaution, info: reviewCopy.severityInfo }

function ReviewChangeValue({ change }: { change: TransactionReviewSummary['changes'][number] }) {
	if (change.direction === 'unknown') return <span className='transaction-review-change'>{change.delta}</span>
	return (
		<span className='transaction-review-change'>
			<span className='transaction-review-change-before'>{change.before}</span>
			<span aria-hidden='true'> {reviewCopy.changeArrow} </span>
			<span className='visually-hidden'> {reviewCopy.changeTo} </span>
			<span className={`transaction-review-change-after ${change.direction}`}>{change.after}</span>
		</span>
	)
}

/** Amounts, before → after balances, and severity-ranked warnings for the step under review. */
export function TransactionReviewSummaryContent({ summary }: { summary: TransactionReviewSummary }) {
	if (summary.amounts.length === 0 && summary.changes.length === 0 && summary.warnings.length === 0) return undefined
	return (
		<div className='transaction-review-summary'>
			<TransactionReview
				variant='inline'
				primary={summary.amounts.map(row => ({ label: row.label, value: row.value }))}
				details={summary.changes.map(change => ({ label: change.label, value: <ReviewChangeValue change={change} /> }))}
				risks={summary.warnings.map(warning => (
					<span className={`transaction-review-risk ${warning.severity}`}>
						<strong>{severityLabels[warning.severity]}</strong> {warning.message}
					</span>
				))}
			/>
		</div>
	)
}

export type TransactionReviewConfirmationInput = { acknowledged: boolean; typed: string }

/** Proportional confirmation for an irreversible step: a checkbox, or typing the amount for large burns. */
export function TransactionReviewConfirmationField({ confirmation, confirmed, disabled, input, onInput }: { confirmation: TransactionReviewConfirmation; confirmed: boolean; disabled: boolean; input: TransactionReviewConfirmationInput; onInput: (next: TransactionReviewConfirmationInput) => void }) {
	const mismatchId = useId()
	if (confirmation.kind === 'acknowledge')
		return (
			<label className='transaction-review-confirmation acknowledge'>
				<input type='checkbox' checked={input.acknowledged} disabled={disabled} onChange={event => onInput({ ...input, acknowledged: event.currentTarget.checked })} />
				<span>{confirmation.label}</span>
			</label>
		)
	const typedLength = input.typed.replaceAll(/[\s,]/g, '').length
	// Only flag a mismatch once the entry is as long as the amount, so partial typing stays quiet.
	const mismatch = !confirmed && typedLength > 0 && typedLength >= confirmation.expectedText.replaceAll(/[\s,]/g, '').length
	return (
		<div className='transaction-review-confirmation typed'>
			<label className='field'>
				<span>{confirmation.label}</span>
				<FormInput aria-describedby={mismatch ? mismatchId : undefined} autoComplete='off' disabled={disabled} inputMode='decimal' invalid={mismatch} placeholder={confirmation.expectedText} spellcheck={false} value={input.typed} onInput={event => onInput({ ...input, typed: event.currentTarget.value })} />
			</label>
			{mismatch ? (
				<p className='field-error' id={mismatchId}>
					{reviewCopy.typedAmountMismatch}
				</p>
			) : undefined}
		</div>
	)
}
