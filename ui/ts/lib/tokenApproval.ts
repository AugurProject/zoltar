import { maxUint256 } from 'viem'
import { parseDecimalInput } from './decimal.js'
import { formatCurrencyBalance } from './formatters.js'

export const maxUint200 = 2n ** 200n - 1n

export type TokenApprovalState = {
	error: string | undefined
	loading: boolean
	value: bigint | undefined
}

export type TokenApprovalRequirement = {
	approvedAmount: bigint | undefined
	hasSufficientApproval: boolean
	neededAmount: bigint | undefined
	requiredAmount: bigint | undefined
	targetAmount: bigint | undefined
}

type ParsedTokenApprovalAmount = { kind: 'custom'; amount: bigint } | { kind: 'default' } | { kind: 'max'; amount: typeof maxUint256 }

function sanitizeApprovalFailureReason(reason: string | undefined) {
	if (reason === undefined) return undefined

	let sanitized = reason.trim().replace(/\s+/g, ' ')
	if (sanitized === '') return undefined

	sanitized = sanitized.replace(/^(failed to [^:.]+[:.]\s*)+/i, '')
	sanitized = sanitized.replace(/\.$/, '')
	return sanitized === '' ? undefined : sanitized
}

export function deriveTokenApprovalRequirement(requiredAmount: bigint | undefined, approvedAmount: bigint | undefined): TokenApprovalRequirement {
	if (requiredAmount === undefined) {
		return {
			approvedAmount,
			hasSufficientApproval: false,
			neededAmount: undefined,
			requiredAmount,
			targetAmount: undefined,
		}
	}

	if (requiredAmount <= 0n) {
		return {
			approvedAmount,
			hasSufficientApproval: true,
			neededAmount: 0n,
			requiredAmount,
			targetAmount: undefined,
		}
	}

	const hasSufficientApproval = approvedAmount !== undefined && approvedAmount >= requiredAmount
	const neededAmount = approvedAmount === undefined ? undefined : approvedAmount >= requiredAmount ? 0n : requiredAmount - approvedAmount

	return {
		approvedAmount,
		hasSufficientApproval,
		neededAmount,
		requiredAmount,
		targetAmount: hasSufficientApproval ? undefined : requiredAmount,
	}
}

export function parseTokenApprovalAmountInput(value: string, label: string, units: number): ParsedTokenApprovalAmount {
	const trimmed = value.trim()
	if (trimmed === '') return { kind: 'default' }
	if (trimmed.toLowerCase() === 'max') return { kind: 'max', amount: maxUint256 }
	return {
		kind: 'custom',
		amount: parseDecimalInput(trimmed, label, units),
	}
}

export function shouldDisplayMaxTokenApprovalAmount(amount: bigint | undefined) {
	return amount !== undefined && amount > maxUint200
}

export function formatTokenApprovalUnavailableMessage({ actionLabel, reason, tokenLabel }: { actionLabel?: string | undefined; reason: string | undefined; tokenLabel: string | undefined }) {
	const resolvedTokenLabel = tokenLabel?.trim() || 'token'
	const sanitizedReason = sanitizeApprovalFailureReason(reason)
	const segments = [`Unable to verify ${resolvedTokenLabel} approval${actionLabel === undefined ? '' : ` before ${actionLabel}`}.`]

	if (sanitizedReason !== undefined) {
		segments.push(`Reason: ${sanitizedReason}.`)
	}
	segments.push('Retry loading the approval status before continuing.')

	return segments.join(' ')
}

export function formatTokenApprovalNeededMessage({ actionLabel, requirement, tokenLabel, tokenUnits }: { actionLabel: string; requirement: TokenApprovalRequirement; tokenLabel: string; tokenUnits: number }) {
	if (requirement.neededAmount === undefined || requirement.neededAmount <= 0n) return undefined
	const targetAmount = requirement.targetAmount ?? requirement.requiredAmount
	if (targetAmount === undefined) return undefined
	return `Need ${formatCurrencyBalance(requirement.neededAmount, tokenUnits)} more ${tokenLabel} approved before ${actionLabel}. Approving will set the allowance to ${formatCurrencyBalance(targetAmount, tokenUnits)} ${tokenLabel}.`
}

export function formatTokenApprovalPartialMessage({ actionLabel, nextApprovedAmount, requiredAmount, tokenLabel, tokenUnits }: { actionLabel: string; nextApprovedAmount: bigint; requiredAmount: bigint; tokenLabel: string; tokenUnits: number }) {
	if (nextApprovedAmount >= requiredAmount) return undefined
	return `Approving ${formatCurrencyBalance(nextApprovedAmount, tokenUnits)} ${tokenLabel} will still leave ${formatCurrencyBalance(requiredAmount - nextApprovedAmount, tokenUnits)} more ${tokenLabel} needed before ${actionLabel}.`
}
