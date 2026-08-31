import { DEFAULT_TRANSACTION_VALIDITY_BLOCKS } from '@zoltar/bot-shared/execution/transaction-submission'
import type { PlanningOptions } from './types.ts'

/** Ethereum finalizes checkpoints by epoch; three epochs leave one full epoch beyond the normal two-epoch path. */
export const ETHEREUM_SLOTS_PER_EPOCH = 32n
export const CONSERVATIVE_FINALITY_EPOCHS = 3n
/** Planning horizon only. Receipt disposition uses the RPC consensus `finalized` checkpoint directly. */
export const CONSENSUS_FINALITY_HORIZON_BLOCKS = ETHEREUM_SLOTS_PER_EPOCH * CONSERVATIVE_FINALITY_EPOCHS
/** Retained as the execution timing name consumed by workflow planners and local confirmation-depth fixtures. */
export const EXECUTOR_FINALITY_BLOCKS = CONSENSUS_FINALITY_HORIZON_BLOCKS
export const MINIMUM_TIMESTAMP_SAFETY_SECONDS = 60n
export const MAXIMUM_WORKFLOW_PREREQUISITE_COUNT = 2
/** Leaves one block after every supported prerequisite consumes its full transport and finality horizon. */
export const MINIMUM_WORKFLOW_VALIDITY_BLOCKS = Number(BigInt(MAXIMUM_WORKFLOW_PREREQUISITE_COUNT) * (DEFAULT_TRANSACTION_VALIDITY_BLOCKS + EXECUTOR_FINALITY_BLOCKS) + 1n)

export function assertWorkflowPrerequisiteLimit(plan: { id: string; steps: readonly unknown[] }) {
	const prerequisiteCount = Math.max(0, plan.steps.length - 1)
	if (prerequisiteCount > MAXIMUM_WORKFLOW_PREREQUISITE_COUNT) {
		throw new Error(`${plan.id} has ${prerequisiteCount.toString()} pre-terminal steps; the configured workflow validity floor supports at most ${MAXIMUM_WORKFLOW_PREREQUISITE_COUNT.toString()} pre-terminal steps`)
	}
	return prerequisiteCount
}

function maximumBlockIntervalSeconds(options: PlanningOptions) {
	const configured = options.maximumBlockIntervalSeconds
	if (!Number.isSafeInteger(configured) || configured <= 0) throw new Error('maximumBlockIntervalSeconds must be a positive safe integer')
	return BigInt(configured)
}

export function requiredWorkflowSafetyBlocks(prerequisiteCount = 0) {
	if (!Number.isSafeInteger(prerequisiteCount) || prerequisiteCount < 0) throw new Error('Prerequisite count must be a non-negative safe integer')
	return DEFAULT_TRANSACTION_VALIDITY_BLOCKS + BigInt(prerequisiteCount) * (DEFAULT_TRANSACTION_VALIDITY_BLOCKS + EXECUTOR_FINALITY_BLOCKS)
}

export function requiredTimestampSubmissionSafetySeconds(maximumIntervalSeconds: number) {
	if (!Number.isSafeInteger(maximumIntervalSeconds) || maximumIntervalSeconds <= 0) throw new Error('maximumBlockIntervalSeconds must be a positive safe integer')
	const interval = BigInt(maximumIntervalSeconds)
	return interval > MINIMUM_TIMESTAMP_SAFETY_SECONDS ? interval : MINIMUM_TIMESTAMP_SAFETY_SECONDS
}

export function requiredTimestampSafetySeconds(options: PlanningOptions, prerequisiteCount = 0) {
	if (!Number.isSafeInteger(prerequisiteCount) || prerequisiteCount < 0) throw new Error('Prerequisite count must be a non-negative safe integer')
	const interval = maximumBlockIntervalSeconds(options)
	const terminalSafety = interval > MINIMUM_TIMESTAMP_SAFETY_SECONDS ? interval : MINIMUM_TIMESTAMP_SAFETY_SECONDS
	return BigInt(prerequisiteCount) * (1n + EXECUTOR_FINALITY_BLOCKS) * interval + terminalSafety
}

export function timestampDeadlineHasRequiredSafety(currentTimestamp: bigint, deadlineTimestamp: bigint, options: PlanningOptions, prerequisiteCount = 0) {
	return currentTimestamp + requiredTimestampSafetySeconds(options, prerequisiteCount) < deadlineTimestamp
}
