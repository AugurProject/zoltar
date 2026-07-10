import { useEffect, useMemo, useState } from 'preact/hooks'
import { ApprovedAmountValue } from './ApprovedAmountValue.js'
import { CurrencyValue } from './CurrencyValue.js'
import { ErrorNotice } from './ErrorNotice.js'
import { FormInput } from './FormInput.js'
import { LoadingText } from './LoadingText.js'
import { MetricGrid } from './MetricGrid.js'
import { MetricField } from './MetricField.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { formatCurrencyBalance } from '../lib/formatters.js'
import { deriveTokenApprovalRequirement, formatTokenApprovalUnavailableMessage, parseTokenApprovalAmountInput, resolveTokenApprovalStatusMessage } from '../lib/tokenApproval.js'
import {
	UI_STRING_APPROVAL_AMOUNT,
	UI_STRING_APPROVAL_AMOUNT_MUST_BE_A_DECIMAL_NUMBER,
	UI_STRING_APPROVAL_SATISFIED,
	UI_STRING_LEAVE_BLANK_FOR_REQUIRED_TOTAL,
	UI_STRING_MAX,
	UI_TEMPLATE_APPROVED_VALUE,
	UI_TEMPLATE_APPROVE_MAX_VALUE,
	UI_TEMPLATE_APPROVE_VALUE,
	UI_TEMPLATE_APPROVE_TOKEN_AMOUNT,
	UI_TEMPLATE_REQUIRED_VALUE,
	UI_TEMPLATE_VALUE_APPROVAL_AMOUNT,
} from '../lib/uiStrings.js'
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
	if (guardMessage !== undefined || nextApprovalAmount === undefined) return UI_TEMPLATE_APPROVE_VALUE(tokenSymbol)
	if (requirementSatisfied && !isCustomAmount && !isMaxAmount) return UI_STRING_APPROVAL_SATISFIED
	if (isMaxAmount) return UI_TEMPLATE_APPROVE_MAX_VALUE(tokenSymbol)
	return UI_TEMPLATE_APPROVE_TOKEN_AMOUNT(formatCurrencyBalance(nextApprovalAmount, tokenUnits), tokenSymbol)
}
export function TokenApprovalControl({ actionLabel, allowanceError, allowanceLoading, approvedAmount, disabled = false, guardMessage, onApprove, pending, pendingLabel, requiredAmount, resetKey, tokenSymbol, tokenUnits }: TokenApprovalControlProps) {
	const [draftAmount, setDraftAmount] = useState('')
	const requirement = useMemo(() => deriveTokenApprovalRequirement(requiredAmount, approvedAmount), [approvedAmount, requiredAmount])
	useEffect(() => {
		setDraftAmount('')
	}, [resetKey])
	const parsedAmount = useMemo(() => {
		try {
			return parseTokenApprovalAmountInput(draftAmount, UI_STRING_APPROVAL_AMOUNT, tokenUnits)
		} catch (error) {
			return {
				error: error instanceof Error ? error.message : UI_STRING_APPROVAL_AMOUNT_MUST_BE_A_DECIMAL_NUMBER,
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
				<MetricField label={UI_TEMPLATE_REQUIRED_VALUE(tokenSymbol)}>
					<CurrencyValue value={requiredAmount} units={tokenUnits} suffix={tokenSymbol} copyable={false} />
				</MetricField>
				<MetricField label={UI_TEMPLATE_APPROVED_VALUE(tokenSymbol)}>
					<ApprovedAmountValue loading={allowanceLoading} value={approvedAmount} requiredAmount={requiredAmount} units={tokenUnits} suffix={tokenSymbol} copyable={false} />
				</MetricField>
			</MetricGrid>

			<label className='field approval-amount-field'>
				<span className='approval-amount-label'>{UI_TEMPLATE_VALUE_APPROVAL_AMOUNT(tokenSymbol)}</span>
				<div className='field-inline approval-amount-controls'>
					<FormInput className='field-inline-input' value={draftAmount} onInput={event => setDraftAmount(event.currentTarget.value)} placeholder={UI_STRING_LEAVE_BLANK_FOR_REQUIRED_TOTAL} invalid={amountValidationMessage !== undefined} disabled={controlsDisabled} />
					<button className='quiet field-inline-action' type='button' onClick={() => setDraftAmount('max')} disabled={controlsDisabled}>
						{UI_STRING_MAX}
					</button>
				</div>
			</label>

			<div className='actions'>
				<TransactionActionButton
					idleLabel={buttonLabel}
					pendingLabel={pendingLabel}
					onClick={() => onApprove(nextApprovalAmount)}
					pending={pending}
					tone='secondary'
					availability={{ disabled: !canApprove, reason: allowanceMessage ?? visibleStatusMessage ?? guardMessage }}
					showDisabledReason={allowanceMessage === undefined}
				/>
			</div>

			{allowanceMessage === undefined ? undefined : <ErrorNotice message={allowanceMessage} />}
			{allowanceMessage !== undefined || visibleStatusMessage === undefined || !canApprove ? undefined : <p className='detail'>{visibleStatusMessage}</p>}
		</div>
	)
}
