import { erc1155Abi } from '@zoltar/bot-shared/contracts/abi'
import { decodeFunctionData, getAddress, isAddress, type Address } from '@zoltar/bot-shared/ethereum'
import { sameAddress } from '@zoltar/core-shared/evm/address'
import { encodeStep, planBase } from '../planning.ts'
import type { EcosystemSnapshot, OperationContinuationContext, OperationPlanDraft, ShareInventory } from '../types.ts'
import { undefinedOnError } from './continuations.ts'

const IS_APPROVED_FOR_ALL_ABI = 'function isApprovedForAll(address account, address operator) view returns (bool)'

export function shareApproval(inventory: ShareInventory, operator: `0x${string}`, owner: `0x${string}`, stepId = `approve-shares-${operator}`) {
	const approved = Object.entries(inventory.isApprovedForAll).find(([address]) => sameAddress(address, operator))?.[1] ?? false
	if (approved) return []
	return [
		encodeStep({
			abi: erc1155Abi,
			args: [operator, true],
			evidence: [{ abi: IS_APPROVED_FOR_ALL_ABI, args: [owner, operator], contract: inventory.shareToken, expected: 'true', functionName: 'isApprovedForAll', kind: 'storage-postcondition', relation: 'equals' }],
			functionName: 'setApprovalForAll',
			id: stepId,
			label: 'Approve outcome shares',
			to: inventory.shareToken,
		}),
	]
}

const isShareApprovalStepId = (id: string) => id.startsWith('approve-shares-') || id.startsWith('reapprove-shares-')

function decodedShareApproval(step: OperationPlanDraft['steps'][number], expectedOperator: Address | undefined) {
	const idOperator = step.id.slice(-42)
	if (!isAddress(idOperator)) return undefined
	return undefinedOnError(() => {
		const call = decodeFunctionData({ abi: erc1155Abi, data: step.data })
		const calldataOperator = call.functionName === 'setApprovalForAll' ? call.args[0] : undefined
		const approved = call.functionName === 'setApprovalForAll' ? call.args[1] : undefined
		if (typeof calldataOperator !== 'string' || !isAddress(calldataOperator) || approved !== true) return undefined
		const normalized = getAddress(calldataOperator)
		if (!sameAddress(normalized, idOperator) || (expectedOperator !== undefined && !sameAddress(normalized, expectedOperator))) return undefined
		return { operator: normalized, token: step.to }
	})
}

function confirmedShareApproval(context: OperationContinuationContext, expectedOperator?: Address) {
	const confirmed = new Set(context.confirmedStepIds)
	const approvalSteps = context.previousPlan.steps.filter(step => confirmed.has(step.id) && isShareApprovalStepId(step.id))
	const approvals = approvalSteps.flatMap(step => {
		const approval = decodedShareApproval(step, expectedOperator)
		return approval === undefined ? [] : [approval]
	})
	if (approvals.length !== approvalSteps.length) return undefined
	const unique = [...new Map(approvals.map(approval => [`${approval.token.toLowerCase()}:${approval.operator.toLowerCase()}`, approval])).values()]
	return unique.length === 1 ? unique[0] : undefined
}

function hasConfirmedShareApprovalStep(context: OperationContinuationContext) {
	const confirmed = new Set(context.confirmedStepIds)
	return context.previousPlan.steps.some(step => confirmed.has(step.id) && isShareApprovalStepId(step.id))
}

function nextShareApprovalStepId(context: OperationContinuationContext, operator: Address) {
	const confirmed = new Set(context.confirmedStepIds)
	const reusable = context.previousPlan.steps.find(step => !confirmed.has(step.id) && step.id.startsWith('reapprove-shares-') && sameAddress(step.id.slice(-42), operator))
	if (reusable !== undefined) return reusable.id
	let ordinal = 1
	while (context.previousPlan.steps.some(step => step.id === `reapprove-shares-${ordinal}-${operator}`)) ordinal += 1
	return `reapprove-shares-${ordinal}-${operator}`
}

export function shareApprovalCleanup(snapshot: EcosystemSnapshot, context: OperationContinuationContext): OperationPlanDraft | undefined {
	const approval = confirmedShareApproval(context)
	if (approval === undefined) return undefined
	return planBase({
		continuationDisposition: 'cleanup-only',
		definitionId: context.previousPlan.definitionId,
		ecosystem: 'trading',
		label: `Clean up ${context.previousPlan.label}`,
		metadata: context.previousPlan.metadata,
		postconditions: ['The workflow-owned outcome-share operator approval is revoked'],
		risk: 'medium',
		snapshot,
		steps: [
			encodeStep({
				abi: erc1155Abi,
				args: [approval.operator, false],
				evidence: [
					{
						abi: IS_APPROVED_FOR_ALL_ABI,
						args: [snapshot.wallet.address, approval.operator],
						contract: approval.token,
						expected: 'false',
						functionName: 'isApprovedForAll',
						kind: 'storage-postcondition',
						relation: 'equals',
					},
				],
				functionName: 'setApprovalForAll',
				id: `revoke-shares-${approval.operator}`,
				label: 'Revoke outcome-share approval',
				to: approval.token,
			}),
		],
	})
}

/** Resolves the confirmed share approval a continuation may reuse, or reports that only cleanup remains. */
export function continuationShareApproval(context: OperationContinuationContext, operator: Address) {
	const approval = confirmedShareApproval(context, operator)
	if (approval === undefined && hasConfirmedShareApprovalStep(context)) return 'cleanup-only'
	return approval === undefined ? { approvalStepId: undefined, confirmedApproval: false } : { approvalStepId: nextShareApprovalStepId(context, operator), confirmedApproval: true }
}
