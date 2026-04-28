import { useEffect, useMemo, useState } from 'preact/hooks'
import { ApprovedAmountValue } from './ApprovedAmountValue.js'
import { CurrencyValue } from './CurrencyValue.js'
import { ErrorNotice } from './ErrorNotice.js'
import { FormInput } from './FormInput.js'
import { LoadingText } from './LoadingText.js'
import { MetricField } from './MetricField.js'
import { formatCurrencyBalance } from '../lib/formatters.js'
import { deriveTokenApprovalRequirement, formatTokenApprovalUnavailableMessage, parseTokenApprovalAmountInput, resolveTokenApprovalStatusMessage } from '../lib/tokenApproval.js'

type TokenApprovalControlProps = {
	actionLabel: string
	allowanceError: string | undefined
	allowanceLoading: boolean
	approvedAmount: bigint | undefined
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
	if (guardMessage !== undefined || nextApprovalAmount === undefined) return `Approve ${tokenSymbol}`
	if (requirementSatisfied && !isCustomAmount && !isMaxAmount) return 'Approval Satisfied'
	if (isMaxAmount) return `Approve Max ${tokenSymbol}`
	return `Approve ${formatCurrencyBalance(nextApprovalAmount, tokenUnits)} ${tokenSymbol}`
}

export function TokenApprovalControl({ actionLabel, allowanceError, allowanceLoading, approvedAmount, guardMessage, onApprove, pending, pendingLabel, requiredAmount, resetKey, tokenSymbol, tokenUnits }: TokenApprovalControlProps) {
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

	const nextApprovalAmount = parsedAmount.kind === 'default' ? requirement.targetAmount : parsedAmount.kind === 'invalid' ? undefined : parsedAmount.amount

	const amountValidationMessage = parsedAmount.kind === 'invalid' ? parsedAmount.error : parsedAmount.kind === 'default' || approvedAmount === undefined || parsedAmount.amount > approvedAmount ? undefined : `Approval amount must be greater than the current approved ${tokenSymbol} amount.`
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

	const allowanceMessage = allowanceError === undefined ? undefined : formatTokenApprovalUnavailableMessage({ actionLabel, reason: allowanceError, tokenLabel: tokenSymbol })
	const canApprove = !pending && guardMessage === undefined && allowanceMessage === undefined && !allowanceLoading && requiredAmount !== undefined && amountValidationMessage === undefined && nextApprovalAmount !== undefined && (parsedAmount.kind !== 'default' || !requirement.hasSufficientApproval)
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
			<div className='workflow-metric-grid'>
				<MetricField label={`Required ${tokenSymbol}`}>
					<CurrencyValue value={requiredAmount} units={tokenUnits} suffix={tokenSymbol} copyable={false} />
				</MetricField>
				<MetricField label={`Approved ${tokenSymbol}`}>
					<ApprovedAmountValue loading={allowanceLoading} value={approvedAmount} units={tokenUnits} suffix={tokenSymbol} copyable={false} />
				</MetricField>
				<MetricField label={`Need More ${tokenSymbol} Approved`}>
					<CurrencyValue value={requirement.neededAmount} units={tokenUnits} suffix={tokenSymbol} copyable={false} />
				</MetricField>
			</div>

			<label className='field'>
				<span>{`${tokenSymbol} Approval Amount`}</span>
				<div className='field-inline'>
					<FormInput className='field-inline-input' value={draftAmount} onInput={event => setDraftAmount(event.currentTarget.value)} placeholder='Leave blank for required total' invalid={amountValidationMessage !== undefined} disabled={pending} />
					<button className='quiet field-inline-action' type='button' onClick={() => setDraftAmount('max')} disabled={pending}>
						Max
					</button>
				</div>
			</label>

			<div className='actions'>
				<button className='secondary' type='button' onClick={() => onApprove(nextApprovalAmount)} disabled={!canApprove}>
					{buttonLabel}
				</button>
			</div>

			{allowanceMessage === undefined ? undefined : <ErrorNotice message={allowanceMessage} />}
			{allowanceMessage !== undefined || statusMessage === undefined ? undefined : <p className='detail'>{statusMessage}</p>}
		</div>
	)
}
