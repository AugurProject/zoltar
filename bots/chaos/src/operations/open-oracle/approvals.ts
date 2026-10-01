import { erc20Abi } from '@zoltar/bot-shared/contracts/abi'
import { getAddress, zeroAddress } from '@zoltar/bot-shared/ethereum'
import { allowance, encodeStep, erc20AllowanceEvidence, planBase, tokenInventory } from '../planning.ts'
import type { EcosystemSnapshot, OperationContinuationContext, OperationPlan } from '../types.ts'

// Exact OpenOracle token approvals, their continuation checks, and the cleanup plans that revoke them.

export function approveToken(snapshot: EcosystemSnapshot, tokenAddress: `0x${string}`, required: bigint) {
	if (required === 0n || tokenAddress === zeroAddress) return []
	const inventory = tokenInventory(snapshot, tokenAddress)
	if (allowance(inventory, snapshot.deployments.openOracle) >= required) return []
	return [openOracleApprovalStep(snapshot, tokenAddress, snapshot.deployments.openOracle, required)]
}

type OpenOracleApprovalRequirement = {
	id: string
	required: bigint
	spender: `0x${string}`
	token: `0x${string}`
}

function openOracleApprovalStep(snapshot: EcosystemSnapshot, token: `0x${string}`, spender: `0x${string}`, required: bigint, id = `approve-${token}`, label = 'Approve token for OpenOracle') {
	return encodeStep({ abi: erc20Abi, args: [spender, required], evidence: [erc20AllowanceEvidence(token, snapshot.wallet.address, spender, required)], functionName: 'approve', id, label, to: token })
}

export function requiredMetadataString(metadata: OperationPlan['metadata'], key: string) {
	const value = metadata[key]
	if (typeof value !== 'string' || value.length === 0) throw new Error(`OpenOracle continuation metadata ${key} is missing`)
	return value
}

export function requiredMetadataAmount(metadata: OperationPlan['metadata'], key: string) {
	const value = requiredMetadataString(metadata, key)
	if (!/^(?:0|[1-9][0-9]*)$/.test(value)) throw new Error(`OpenOracle continuation metadata ${key} is not canonical`)
	return BigInt(value)
}

export function requiredMetadataAddress(metadata: OperationPlan['metadata'], key: string) {
	return getAddress(requiredMetadataString(metadata, key))
}

export function requiredMetadataBoolean(metadata: OperationPlan['metadata'], key: string) {
	const value = metadata[key]
	if (typeof value !== 'boolean') throw new Error(`OpenOracle continuation metadata ${key} is missing`)
	return value
}

function exactPreviousApproval(previousPlan: OperationPlan, snapshot: EcosystemSnapshot, requirement: OpenOracleApprovalRequirement) {
	const previous = previousPlan.steps.find(step => step.id === requirement.id)
	if (previous === undefined) return undefined
	const expected = openOracleApprovalStep(snapshot, requirement.token, requirement.spender, requirement.required, requirement.id)
	return previous.to.toLowerCase() === expected.to.toLowerCase() && previous.data === expected.data ? previous : undefined
}

export function preparedApprovalState(snapshot: EcosystemSnapshot, context: OperationContinuationContext, requirements: readonly OpenOracleApprovalRequirement[]) {
	for (const requirement of requirements) {
		const previous = exactPreviousApproval(context.previousPlan, snapshot, requirement)
		if (context.previousPlan.steps.some(step => step.id === requirement.id) && previous === undefined) return false
		if (previous !== undefined && context.confirmedStepIds.includes(requirement.id)) {
			if (allowance(tokenInventory(snapshot, requirement.token), requirement.spender) < requirement.required) return false
		} else if (previous === undefined && allowance(tokenInventory(snapshot, requirement.token), requirement.spender) < requirement.required) {
			return false
		}
	}
	return true
}

export function remainingApprovalSteps(snapshot: EcosystemSnapshot, context: OperationContinuationContext, requirements: readonly OpenOracleApprovalRequirement[]) {
	return requirements.flatMap(requirement => {
		const previous = exactPreviousApproval(context.previousPlan, snapshot, requirement)
		if (previous === undefined || context.confirmedStepIds.includes(requirement.id) || allowance(tokenInventory(snapshot, requirement.token), requirement.spender) >= requirement.required) return []
		return [openOracleApprovalStep(snapshot, requirement.token, requirement.spender, requirement.required, requirement.id)]
	})
}

export function cleanupApprovalRequirements(snapshot: EcosystemSnapshot, context: OperationContinuationContext, requirements: readonly OpenOracleApprovalRequirement[]) {
	return requirements.filter(requirement => context.confirmedStepIds.includes(requirement.id) && exactPreviousApproval(context.previousPlan, snapshot, requirement) !== undefined)
}

export function openOracleCleanupPlan(snapshot: EcosystemSnapshot, context: OperationContinuationContext, requirements: readonly OpenOracleApprovalRequirement[], label: string, risk: OperationPlan['risk']) {
	const cleanup = cleanupApprovalRequirements(snapshot, context, requirements)
	if (cleanup.length === 0) return undefined
	return planBase({
		continuationDisposition: 'cleanup-only',
		definitionId: context.previousPlan.definitionId,
		ecosystem: 'open-oracle',
		label,
		metadata: context.previousPlan.metadata,
		postconditions: ['Every confirmed workflow-created OpenOracle token allowance is zero'],
		risk,
		snapshot,
		steps: cleanup.map(requirement => openOracleApprovalStep(snapshot, requirement.token, requirement.spender, 0n, `revoke-${requirement.id}`, 'Revoke workflow-created OpenOracle approval')),
	})
}

export function maximumCleanupCount(previousPlan: OperationPlan, snapshot: EcosystemSnapshot, requirements: readonly OpenOracleApprovalRequirement[]) {
	const count = requirements.filter(requirement => exactPreviousApproval(previousPlan, snapshot, requirement) !== undefined).length
	return count === 0 ? undefined : count
}
