import { useEffect, useMemo, useState } from 'preact/hooks'
import { ApprovedAmountValue } from './ApprovedAmountValue.js'
import { CurrencyValue } from './CurrencyValue.js'
import { ErrorNotice } from './ErrorNotice.js'
import { FormInput } from './FormInput.js'
import { LoadingText } from './LoadingText.js'
import { MetricGrid } from './MetricGrid.js'
import { MetricField } from './MetricField.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import type { ActionSafetyId } from '../lib/actionSafety/ids.js'
import { formatCurrencyBalance } from '../lib/formatters.js'
import { deriveTokenApprovalRequirement, formatTokenApprovalUnavailableMessage, parseTokenApprovalAmountInput, resolveTokenApprovalStatusMessage } from '../lib/tokenApproval.js'
type TokenApprovalControlProps = {
	actionLabel: string
	allowanceError: string | undefined
	allowanceLoading: boolean
	approvedAmount: bigint | undefined
	disabled?: boolean | undefined
	guardMessage: string | undefined
	onApprove: (amount?: bigint) => void
	pending: boolean
	pendingLabel: string
	requiredAmount: bigint | undefined
	resetKey: string
	safetyId: ActionSafetyId
	tokenSymbol: string
	tokenUnits: number
}
function resolveApprovalButtonLabel({
	guardMessage,
	isCustomAmount,
	isMaxAmount,
	nextApprovalAmount,
	pending,
	pendingLabel,
	requirementSatisfied,
	tokenSymbol,
	tokenUnits,
}: {
	guardMessage: string | undefined
	isCustomAmount: boolean
	isMaxAmount: boolean
	nextApprovalAmount: bigint | undefined
	pending: boolean
	pendingLabel: string
	requirementSatisfied: boolean
	tokenSymbol: string
	tokenUnits: number
}) {
	if (pending) return <LoadingText>{pendingLabel}</LoadingText>
	if (guardMessage !== undefined || nextApprovalAmount === undefined) return `Approve ${tokenSymbol}`
	if (requirementSatisfied && !isCustomAmount && !isMaxAmount) return 'Approval Satisfied'
	if (isMaxAmount) return `Approve Max ${tokenSymbol}`
	return `Approve ${formatCurrencyBalance(nextApprovalAmount, tokenUnits)} ${tokenSymbol}`
}
export function TokenApprovalControl({ actionLabel, allowanceError, allowanceLoading, approvedAmount, disabled = false, guardMessage, onApprove, pending, pendingLabel, requiredAmount, resetKey, safetyId, tokenSymbol, tokenUnits }: TokenApprovalControlProps) {
	const [draftAmount, setDraftAmount] = useState('')
	const requirement = useMemo(() => deriveTokenApprovalRequirement(requiredAmount, approvedAmount), [approvedAmount, requiredAmount])
	useEffect(() => {
		setDraftAmount('')
	}, [resetKey])
	const parsedAmount = useMemo(() => {
		try {
			return parseTokenApprovalAmountInput(draftAmount, 'Approval amount', tokenUnits)
		} catch (error) {
			return {
				error: error instanceof Error ? error.message : 'Approval amount must be a decimal number',
				kind: 'invalid' as const,
			}
		}
	}, [draftAmount, tokenUnits])
	const nextApprovalAmount = (() => {
		if (parsedAmount.kind === 'default') return requirement.targetAmount
		if (parsedAmount.kind === 'invalid') return undefined

		return parsedAmount.amount
	})()
	const hasNonIncreasingCustomApproval = parsedAmount.kind === 'custom' && approvedAmount !== undefined && parsedAmount.amount <= approvedAmount
	const amountValidationMessage = parsedAmount.kind === 'invalid' ? parsedAmount.error : undefined
	const statusMessage = resolveTokenApprovalStatusMessage({
		actionLabel,
		amountValidationMessage,
		draftAmount,
		guardMessage,
		nextApprovalAmount,
		requiredAmount,
		requirement,
		tokenLabel: tokenSymbol,
		tokenUnits,
	})
	const visibleStatusMessage = disabled || hasNonIncreasingCustomApproval ? undefined : statusMessage
	const allowanceMessage = allowanceError === undefined ? undefined : formatTokenApprovalUnavailableMessage({ actionLabel, reason: allowanceError, tokenLabel: tokenSymbol })
	const controlsDisabled = pending || disabled
	const canApprove =
		!pending &&
		!disabled &&
		guardMessage === undefined &&
		allowanceMessage === undefined &&
		!allowanceLoading &&
		requiredAmount !== undefined &&
		amountValidationMessage === undefined &&
		!hasNonIncreasingCustomApproval &&
		nextApprovalAmount !== undefined &&
		(parsedAmount.kind !== 'default' || !requirement.hasSufficientApproval)
	const buttonLabel = resolveApprovalButtonLabel({
		guardMessage,
		isCustomAmount: parsedAmount.kind === 'custom',
		isMaxAmount: parsedAmount.kind === 'max',
		nextApprovalAmount,
		pending,
		pendingLabel,
		requirementSatisfied: requirement.hasSufficientApproval,
		tokenSymbol,
		tokenUnits,
	})
	return (
		<div className='form-grid'>
			<MetricGrid>
				<MetricField label={`Required ${tokenSymbol}`}>
					<CurrencyValue value={requiredAmount} units={tokenUnits} suffix={tokenSymbol} copyable={false} />
				</MetricField>
				<MetricField label={`Approved ${tokenSymbol}`}>
					<ApprovedAmountValue loading={allowanceLoading} value={approvedAmount} requiredAmount={requiredAmount} units={tokenUnits} suffix={tokenSymbol} copyable={false} />
				</MetricField>
			</MetricGrid>

			<label className='field approval-amount-field'>
				<span className='approval-amount-label'>{`${tokenSymbol} Approval Amount`}</span>
				<div className='field-inline approval-amount-controls'>
					<FormInput className='field-inline-input' value={draftAmount} onInput={event => setDraftAmount(event.currentTarget.value)} placeholder='Leave blank for required total' invalid={amountValidationMessage !== undefined} disabled={controlsDisabled} />
					<button className='quiet field-inline-action' type='button' onClick={() => setDraftAmount('max')} disabled={controlsDisabled}>
						Max
					</button>
				</div>
			</label>

			<div className='actions'>
				<TransactionActionButton safetyId={safetyId} idleLabel={buttonLabel} pendingLabel={pendingLabel} onClick={() => onApprove(nextApprovalAmount)} pending={pending} tone='secondary' availability={{ disabled: !canApprove, reason: visibleStatusMessage ?? allowanceMessage ?? guardMessage }} />
			</div>

			{allowanceMessage === undefined ? undefined : <ErrorNotice message={allowanceMessage} />}
			{allowanceMessage !== undefined || visibleStatusMessage === undefined || !canApprove ? undefined : <p className='detail'>{visibleStatusMessage}</p>}
		</div>
	)
}
