import * as commonCopy from '../copy/common.js'
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
	if (guardMessage !== undefined || nextApprovalAmount === undefined) return commonCopy.formatApproveValue(tokenSymbol)
	if (requirementSatisfied && !isCustomAmount && !isMaxAmount) return commonCopy.approvalSatisfied
	if (isMaxAmount) return commonCopy.formatApproveMaxValue(tokenSymbol)
	return commonCopy.formatApproveTokenAmount(formatCurrencyBalance(nextApprovalAmount, tokenUnits), tokenSymbol)
}
export function TokenApprovalControl({ actionLabel, allowanceError, allowanceLoading, approvedAmount, disabled = false, guardMessage, onApprove, pending, pendingLabel, requiredAmount, resetKey, tokenSymbol, tokenUnits }: TokenApprovalControlProps) {
	const [draftAmount, setDraftAmount] = useState('')
	const requirement = useMemo(() => deriveTokenApprovalRequirement(requiredAmount, approvedAmount), [approvedAmount, requiredAmount])
	useEffect(() => {
		setDraftAmount('')
	}, [resetKey])
	const parsedAmount = useMemo(() => {
		try {
			return parseTokenApprovalAmountInput(draftAmount, commonCopy.approvalAmount, tokenUnits)
		} catch (error) {
			return {
				error: error instanceof Error ? error.message : commonCopy.approvalAmountInvalidError,
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
				<MetricField label={commonCopy.formatRequiredValue(tokenSymbol)}>
					<CurrencyValue value={requiredAmount} units={tokenUnits} suffix={tokenSymbol} copyable={false} />
				</MetricField>
				<MetricField label={commonCopy.formatApprovedValue(tokenSymbol)}>
					<ApprovedAmountValue loading={allowanceLoading} value={approvedAmount} requiredAmount={requiredAmount} units={tokenUnits} suffix={tokenSymbol} copyable={false} />
				</MetricField>
			</MetricGrid>

			<label className='field approval-amount-field'>
				<span className='approval-amount-label'>{commonCopy.formatValueApprovalAmount(tokenSymbol)}</span>
				<div className='field-inline approval-amount-controls'>
					<FormInput className='field-inline-input' value={draftAmount} onInput={event => setDraftAmount(event.currentTarget.value)} placeholder={commonCopy.leaveBlankForRequiredTotal} invalid={amountValidationMessage !== undefined} disabled={controlsDisabled} />
					<button className='quiet field-inline-action' type='button' onClick={() => setDraftAmount('max')} disabled={controlsDisabled}>
						{commonCopy.max}
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
