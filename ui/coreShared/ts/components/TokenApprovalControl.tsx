import type { ComponentChildren } from 'preact'
import * as commonCopy from '../copy/common.js'
import * as stepsCopy from '../copy/transactionSteps.js'
import { useEffect, useId, useMemo, useState } from 'preact/hooks'
import { ErrorNotice } from './ErrorNotice.js'
import { FormInput } from './FormInput.js'
import { LoadingText } from './LoadingText.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { formatCurrencyBalance } from '../lib/formatters.js'
import { deriveTokenApprovalRequirement, formatTokenApprovalUnavailableMessage, parseTokenApprovalAmountInput, resolveTokenApprovalStatusMessage } from '../transactions/tokenApproval.js'
type TokenApprovalControlProps = {
	compact?: boolean
	/** Keeps a finished approval in place, disabled, labelled with its result instead of removing the control. */
	completedLabel?: string | undefined
	showRequirementNotice?: boolean
	renderActions?: (approval: { button: ComponentChildren; notice: string | undefined; noticeId: string }) => ComponentChildren
	actionLabel: string
	allowanceError: string | undefined
	allowanceLoading: boolean
	approvedAmount: bigint | undefined
	disabled?: boolean | undefined
	guardMessage: string | undefined
	guardMessageElementId?: string | undefined
	onApprove: (amount?: bigint) => void
	pending: boolean
	pendingLabel: string
	requiredAmount: bigint | undefined
	resetKey: string
	tokenSymbol: string
	tokenUnits: number
}
function resolveApprovalButtonLabel({ guardMessage, isMaxAmount, nextApprovalAmount, pending, pendingLabel, tokenSymbol, tokenUnits }: { guardMessage: string | undefined; isMaxAmount: boolean; nextApprovalAmount: bigint | undefined; pending: boolean; pendingLabel: string; tokenSymbol: string; tokenUnits: number }) {
	if (pending) return <LoadingText>{pendingLabel}</LoadingText>
	if (guardMessage !== undefined || nextApprovalAmount === undefined) return commonCopy.formatApproveValue(tokenSymbol)
	if (isMaxAmount) return commonCopy.formatApproveMaxValue(tokenSymbol)
	return commonCopy.formatApproveTokenAmount(formatCurrencyBalance(nextApprovalAmount, tokenUnits), tokenSymbol)
}

/**
 * Approves exactly the required amount by default and shows a satisfied state once the allowance covers it.
 * Custom and unlimited amounts stay in a collapsed Advanced section because they widen what the spender can take.
 */
export function TokenApprovalControl({
	compact = false,
	completedLabel,
	showRequirementNotice = true,
	renderActions,
	guardMessageElementId,
	actionLabel,
	allowanceError,
	allowanceLoading,
	approvedAmount,
	disabled = false,
	guardMessage,
	onApprove,
	pending,
	pendingLabel,
	requiredAmount,
	resetKey,
	tokenSymbol,
	tokenUnits,
}: TokenApprovalControlProps) {
	const [draftAmount, setDraftAmount] = useState('')
	const [advancedOpen, setAdvancedOpen] = useState(false)
	const amountValidationMessageId = useId()
	const allowanceMessageId = useId()
	const noticeId = useId()
	const unlimitedWarningId = useId()
	const requirement = useMemo(() => deriveTokenApprovalRequirement(requiredAmount, approvedAmount), [approvedAmount, requiredAmount])
	useEffect(() => {
		setDraftAmount('')
		setAdvancedOpen(false)
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
	const unlimited = parsedAmount.kind === 'max'
	const hasNonIncreasingCustomApproval = parsedAmount.kind === 'custom' && approvedAmount !== undefined && parsedAmount.amount <= approvedAmount
	const amountValidationMessage = parsedAmount.kind === 'invalid' ? parsedAmount.error : undefined
	const statusMessage = resolveTokenApprovalStatusMessage({
		actionLabel,
		amountValidationMessage: undefined,
		draftAmount,
		guardMessage,
		nextApprovalAmount,
		requiredAmount,
		requirement,
		tokenLabel: tokenSymbol,
		tokenUnits,
	})
	const visibleStatusMessage = disabled || completedLabel !== undefined || hasNonIncreasingCustomApproval || amountValidationMessage !== undefined || (!showRequirementNotice && parsedAmount.kind === 'default' && guardMessage === undefined) ? undefined : statusMessage
	const allowanceMessage = allowanceError === undefined ? undefined : formatTokenApprovalUnavailableMessage({ actionLabel, reason: allowanceError, tokenLabel: tokenSymbol })
	const controlsDisabled = pending || disabled || completedLabel !== undefined
	// A guard (for example a missing amount) means the requirement is not known yet, so it cannot read as approved.
	const approved = completedLabel === undefined && !pending && !allowanceLoading && allowanceMessage === undefined && guardMessage === undefined && requiredAmount !== undefined && requirement.hasSufficientApproval && parsedAmount.kind === 'default'
	// An allowance that already covers the requirement reads like a finished review step: the button stays in place, disabled and labelled.
	const doneLabel = completedLabel ?? (approved ? stepsCopy.formatStepCompleted(stepsCopy.formatTokenApproved(tokenSymbol)) : undefined)
	const canApprove =
		!controlsDisabled &&
		guardMessage === undefined &&
		allowanceMessage === undefined &&
		!allowanceLoading &&
		requiredAmount !== undefined &&
		amountValidationMessage === undefined &&
		!hasNonIncreasingCustomApproval &&
		nextApprovalAmount !== undefined &&
		(parsedAmount.kind !== 'default' || !requirement.hasSufficientApproval)
	const buttonLabel =
		doneLabel ??
		resolveApprovalButtonLabel({
			guardMessage,
			isMaxAmount: unlimited,
			nextApprovalAmount,
			pending,
			pendingLabel,
			tokenSymbol,
			tokenUnits,
		})
	const disabledReasonElementId = (() => {
		if (allowanceMessage !== undefined) return renderActions === undefined ? allowanceMessageId : noticeId
		if (amountValidationMessage !== undefined) return amountValidationMessageId
		return guardMessageElementId
	})()
	const approvalButton = (
		<TransactionActionButton
			className={doneLabel === undefined ? '' : 'tx-action-completed'}
			idleLabel={buttonLabel}
			inlineHint={allowanceMessage === undefined && amountValidationMessage === undefined && canApprove ? visibleStatusMessage : undefined}
			pendingLabel={pendingLabel}
			onClick={() => onApprove(nextApprovalAmount)}
			pending={pending}
			tone='secondary'
			availability={{ disabled: !canApprove, reason: doneLabel ?? allowanceMessage ?? visibleStatusMessage ?? guardMessage }}
			disabledReasonElementId={disabledReasonElementId}
			showDisabledReason={doneLabel === undefined && allowanceMessage === undefined && amountValidationMessage === undefined && (guardMessage === undefined || guardMessageElementId === undefined)}
		/>
	)
	const showAdvanced = doneLabel === undefined && requiredAmount !== undefined && requiredAmount > 0n
	const advancedAmountValue = unlimited ? '' : draftAmount
	let customAmountPlaceholder: string | undefined = compact ? commonCopy.requiredTotalPlaceholder : commonCopy.leaveBlankForRequiredTotal
	if (unlimited) customAmountPlaceholder = undefined
	return (
		<div className='form-grid token-approval-control'>
			{renderActions === undefined ? <div className='actions'>{approvalButton}</div> : renderActions({ button: approvalButton, notice: allowanceMessage ?? visibleStatusMessage ?? guardMessage, noticeId })}

			{showAdvanced ? (
				<details className='approval-advanced' open={advancedOpen} onToggle={event => setAdvancedOpen(event.currentTarget.open)}>
					<summary>{commonCopy.advancedApproval}</summary>
					<div className='approval-advanced-body'>
						<label className='field approval-amount-field'>
							<span className='approval-amount-label'>{commonCopy.customApprovalAmount}</span>
							<FormInput
								aria-describedby={amountValidationMessage === undefined ? undefined : amountValidationMessageId}
								inputMode='decimal'
								value={advancedAmountValue}
								onInput={event => setDraftAmount(event.currentTarget.value)}
								placeholder={customAmountPlaceholder}
								invalid={amountValidationMessage !== undefined}
								disabled={controlsDisabled || unlimited}
								adornment={tokenSymbol}
							/>
						</label>
						{amountValidationMessage === undefined ? undefined : (
							<p className='field-error' id={amountValidationMessageId}>
								{amountValidationMessage}
							</p>
						)}
						<label className='approval-unlimited-option'>
							<input type='checkbox' checked={unlimited} disabled={controlsDisabled} aria-describedby={unlimitedWarningId} onChange={event => setDraftAmount(event.currentTarget.checked ? 'max' : '')} />
							<span>{commonCopy.unlimitedApproval}</span>
						</label>
						<p className={`approval-unlimited-warning${unlimited ? ' active' : ''}`} id={unlimitedWarningId}>
							{commonCopy.formatUnlimitedApprovalWarning(tokenSymbol)}
						</p>
					</div>
				</details>
			) : undefined}

			{renderActions !== undefined || allowanceMessage === undefined ? undefined : <ErrorNotice id={allowanceMessageId} message={allowanceMessage} />}
		</div>
	)
}
