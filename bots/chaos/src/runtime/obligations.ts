import { createHash } from 'node:crypto'
import type { CanonicalLifecyclePresence, EvaluatedOperation, OperationPlan } from '../operations/types.ts'
import { createDurableWorkflow, markWorkflowForRediscovery, markRetryableWorkflowForRediscovery, refreshWorkflowContinuation, requireWorkflowStep, retryableOnChainWorkflowFailure } from './workflows.ts'
import type { DurableMetadata, DurableObligation, DurableObligationTombstone, DurableWorkflow, RuntimeState } from '../state/operator-state.ts'

export const OBLIGATION_TOMBSTONE_RETENTION_BLOCKS = 64n

function now() {
	return new Date().toISOString()
}

function canonicalMetadata(metadata: DurableMetadata) {
	return JSON.stringify(Object.fromEntries(Object.entries(metadata).sort(([left], [right]) => left.localeCompare(right))))
}

function operationInstanceId(instance: Pick<OperationPlan, 'definitionId' | 'metadata'>) {
	const identity = createHash('sha256')
		.update(`${instance.definitionId}:${canonicalMetadata(instance.metadata)}`)
		.digest('hex')
		.slice(0, 24)
	return `obligation:${instance.definitionId}:${identity}`
}

function timestampFromSeconds(value: string | undefined) {
	if (value === undefined) return undefined
	if (!/^(?:0|[1-9]\d*)$/.test(value)) throw new Error('Lifecycle obligation deadline is invalid')
	const milliseconds = BigInt(value) * 1_000n
	if (milliseconds > BigInt(8_640_000_000_000_000)) throw new Error('Lifecycle obligation deadline is outside the supported date range')
	return new Date(Number(milliseconds)).toISOString()
}

function planSteps(plan: OperationPlan) {
	return createDurableWorkflow(plan).steps
}

function refreshPlannedWorkflow(workflow: DurableWorkflow, plan: OperationPlan) {
	if (workflow.status === 'waiting-continuation') {
		refreshWorkflowContinuation(workflow, plan)
		return
	}
	if (workflow.status !== 'planned' && workflow.status !== 'blocked') return
	if (workflow.steps.some(step => step.status === 'confirmed')) {
		refreshWorkflowContinuation(workflow, plan)
		return
	}
	workflow.classification = plan.classification
	workflow.createdAtBlock = plan.createdAtBlock
	if (plan.deadlineTimestamp === undefined) delete workflow.deadlineTimestamp
	else workflow.deadlineTimestamp = plan.deadlineTimestamp
	if (plan.lastValidBlockNumber === undefined) delete workflow.lastValidBlockNumber
	else workflow.lastValidBlockNumber = plan.lastValidBlockNumber
	if (plan.semanticDeadlineBlockNumber === undefined) {
		delete workflow.semanticDeadlineBlockNumber
	} else {
		workflow.semanticDeadlineBlockNumber = plan.semanticDeadlineBlockNumber
	}
	workflow.ecosystem = plan.ecosystem
	workflow.label = plan.label
	workflow.metadata = plan.metadata
	workflow.operationId = plan.definitionId
	workflow.obligation = plan.obligation
	workflow.planId = plan.id
	workflow.postconditions = [...plan.postconditions]
	workflow.priority = plan.priority
	workflow.risk = plan.risk
	workflow.status = 'planned'
	workflow.steps = planSteps(plan)
	workflow.updatedAt = now()
}

function newObligation(plan: OperationPlan, workflow: DurableWorkflow): DurableObligation {
	const createdAt = now()
	const expiresAt = timestampFromSeconds(plan.deadlineTimestamp)
	return {
		attemptCount: 0,
		blockers: [],
		createdAt,
		ecosystem: plan.ecosystem,
		...(expiresAt === undefined ? {} : { expiresAt }),
		id: operationInstanceId(plan),
		label: plan.label,
		metadata: plan.metadata,
		operationId: plan.definitionId,
		status: 'pending',
		updatedAt: createdAt,
		workflowId: workflow.id,
	}
}

function recoverCompletedObligation(state: Pick<RuntimeState, 'obligationTombstones'>, obligation: DurableObligation, workflow: DurableWorkflow, currentBlock: bigint) {
	const timestamp = workflow.completedAt ?? now()
	obligation.completedAt = timestamp
	obligation.status = 'completed'
	obligation.updatedAt = timestamp
	upsertObligationTombstone(state.obligationTombstones, {
		id: obligation.id,
		resolution: 'completed',
		resolvedAt: timestamp,
		resolvedAtBlock: currentBlock.toString(),
	})
}

function recoverTerminalObligation(state: Pick<RuntimeState, 'obligationTombstones'>, obligation: DurableObligation, workflow: DurableWorkflow, currentBlock: bigint, reason: string) {
	const timestamp = now()
	obligation.resolvedAt = timestamp
	obligation.resolutionReason = reason
	obligation.status = 'abandoned'
	obligation.updatedAt = timestamp
	workflow.completedAt = timestamp
	workflow.status = 'abandoned'
	workflow.updatedAt = timestamp
	upsertObligationTombstone(state.obligationTombstones, {
		id: obligation.id,
		resolution: 'abandoned',
		resolvedAt: timestamp,
		resolvedAtBlock: currentBlock.toString(),
		resolutionReason: reason,
	})
}

function hasSemanticFailure(workflow: DurableWorkflow) {
	return workflow.steps.some(step => step.failureKind === 'semantic-failure')
}

function deadlinePassed(workflow: DurableWorkflow, currentBlock: bigint, currentTimestamp: bigint) {
	return (workflow.deadlineTimestamp !== undefined && currentTimestamp > BigInt(workflow.deadlineTimestamp)) || (workflow.semanticDeadlineBlockNumber !== undefined && currentBlock > BigInt(workflow.semanticDeadlineBlockNumber))
}

export function synchronizeLifecycleObligations(
	state: Pick<RuntimeState, 'obligationTombstones' | 'obligations' | 'pendingTransactions' | 'workflows'>,
	evaluations: readonly EvaluatedOperation[],
	canonicalPresence: readonly CanonicalLifecyclePresence[],
	presenceComplete: boolean,
	currentBlock: bigint,
	currentTimestamp: bigint,
) {
	if (currentBlock < 0n) throw new Error('Lifecycle synchronization block cannot be negative')
	if (currentTimestamp < 0n) {
		throw new Error('Lifecycle synchronization timestamp cannot be negative')
	}
	const plans = evaluations.flatMap(evaluation => {
		if (!evaluation.eligibility.eligible || evaluation.plan === undefined || (!evaluation.plan.obligation && evaluation.plan.priority !== 'urgent')) {
			return []
		}
		return [evaluation.plan]
	})
	const present = new Set(canonicalPresence.map(instance => operationInstanceId(instance)))
	const actionable = new Set(plans.map(plan => operationInstanceId(plan)))
	const terminalIds = new Set(state.obligationTombstones.map(tombstone => tombstone.id))
	for (const tombstone of state.obligationTombstones) {
		if (present.has(tombstone.id)) {
			tombstone.lastSeenBlock = currentBlock.toString()
		}
	}
	for (const plan of plans) {
		const id = operationInstanceId(plan)
		if (terminalIds.has(id)) {
			continue
		}
		let obligation = state.obligations.find(candidate => candidate.id === id)
		if (obligation === undefined) {
			const workflow = createDurableWorkflow(plan)
			state.workflows.unshift(workflow)
			obligation = newObligation(plan, workflow)
			state.obligations.unshift(obligation)
			continue
		}
		// A completed lifecycle item may remain visible for a few anchored scans while
		// RPC nodes converge. Its stable identity must stay terminal; recreating it
		// here could repeat an irreversible operation against the same protocol item.
		if (obligation.status === 'abandoned' || obligation.status === 'completed' || obligation.status === 'failed') {
			continue
		}
		const workflow = state.workflows.find(candidate => candidate.id === obligation.workflowId)
		if (workflow === undefined) throw new Error(`Lifecycle obligation ${id} references a missing workflow`)
		refreshPlannedWorkflow(workflow, plan)
		obligation.blockers = []
		obligation.label = plan.label
		obligation.metadata = plan.metadata
		if (workflow.status === 'completed') {
			recoverCompletedObligation(state, obligation, workflow, currentBlock)
		} else {
			obligation.status = workflow.status === 'failed' ? 'failed' : 'pending'
			obligation.updatedAt = now()
		}
	}
	for (const obligation of state.obligations) {
		if (obligation.status === 'abandoned' || obligation.status === 'completed' || actionable.has(obligation.id)) {
			continue
		}
		const workflow = state.workflows.find(candidate => candidate.id === obligation.workflowId)
		if (workflow?.status === 'completed') {
			recoverCompletedObligation(state, obligation, workflow, currentBlock)
			continue
		}
		const hasPendingIntent = state.pendingTransactions.some(intent => intent.workflowId === obligation.workflowId)
		if (workflow !== undefined && !hasPendingIntent && !hasSemanticFailure(workflow) && deadlinePassed(workflow, currentBlock, currentTimestamp)) {
			recoverTerminalObligation(state, obligation, workflow, currentBlock, 'Canonical lifecycle deadline passed before this bot could complete the operation; the expired instance was superseded without claiming semantic success')
			continue
		}
		if (presenceComplete && !present.has(obligation.id) && workflow !== undefined && !hasPendingIntent && !hasSemanticFailure(workflow)) {
			recoverTerminalObligation(state, obligation, workflow, currentBlock, 'Complete canonical lifecycle discovery no longer contains this outstanding identity; it was terminally superseded without claiming semantic success')
			continue
		}
		if (obligation.status !== 'failed') {
			obligation.blockers = ['The lifecycle item is not currently eligible at the canonical snapshot']
			obligation.status = 'pending'
			obligation.updatedAt = now()
		}
	}
	const retiredIds = new Set(
		state.obligationTombstones.flatMap(tombstone => {
			if (!presenceComplete || present.has(tombstone.id)) return []
			const retainedThrough = BigInt(tombstone.lastSeenBlock ?? tombstone.resolvedAtBlock)
			return currentBlock > retainedThrough + OBLIGATION_TOMBSTONE_RETENTION_BLOCKS ? [tombstone.id] : []
		}),
	)
	if (retiredIds.size !== 0) {
		const retiredWorkflowIds = new Set(state.obligations.filter(obligation => retiredIds.has(obligation.id)).map(obligation => obligation.workflowId))
		state.obligationTombstones = state.obligationTombstones.filter(tombstone => !retiredIds.has(tombstone.id))
		state.obligations = state.obligations.filter(obligation => !retiredIds.has(obligation.id))
		state.workflows = state.workflows.filter(workflow => !retiredWorkflowIds.has(workflow.id))
	}
	return plans
}

export function obligationForPlan(state: Pick<RuntimeState, 'obligations'>, plan: OperationPlan) {
	return state.obligations.find(obligation => obligation.id === operationInstanceId(plan) && obligation.status === 'pending')
}

export function beginLifecycleObligation(obligation: DurableObligation) {
	const timestamp = now()
	obligation.attemptCount += 1
	obligation.blockers = []
	obligation.lastAttemptAt = timestamp
	delete obligation.lastError
	obligation.status = 'executing'
	obligation.updatedAt = timestamp
}

export function completeLifecycleObligation(state: Pick<RuntimeState, 'lastScannedBlock' | 'obligationTombstones' | 'workflows'>, obligation: DurableObligation) {
	const workflow = state.workflows.find(candidate => candidate.id === obligation.workflowId)
	if (workflow === undefined) throw new Error(`Lifecycle obligation ${obligation.id} references a missing workflow`)
	if (workflow.status !== 'completed') return false
	const timestamp = workflow.completedAt ?? now()
	obligation.completedAt = timestamp
	obligation.status = 'completed'
	obligation.updatedAt = timestamp
	upsertObligationTombstone(state.obligationTombstones, {
		id: obligation.id,
		resolution: 'completed',
		resolvedAt: timestamp,
		resolvedAtBlock: (state.lastScannedBlock ?? BigInt(workflow.createdAtBlock)).toString(),
	})
	return true
}

function upsertObligationTombstone(tombstones: DurableObligationTombstone[], tombstone: DurableObligationTombstone) {
	const existing = tombstones.find(candidate => candidate.id === tombstone.id)
	if (existing === undefined) {
		tombstones.push(tombstone)
		return
	}
	if (existing.resolution !== tombstone.resolution) {
		throw new Error(`Lifecycle obligation ${tombstone.id} already has a conflicting terminal resolution`)
	}
}

export function retryLifecycleObligation(state: Pick<RuntimeState, 'obligations' | 'pendingTransactions' | 'workflows'>, obligation: DurableObligation) {
	if (obligation.status !== 'blocked' && obligation.status !== 'failed') {
		throw new Error('Only blocked or failed lifecycle obligations can be retried')
	}
	if (state.pendingTransactions.some(intent => intent.workflowId === obligation.workflowId)) {
		throw new Error('A lifecycle obligation with a pending transaction cannot be retried')
	}
	const workflow = state.workflows.find(candidate => candidate.id === obligation.workflowId)
	if (workflow === undefined) {
		throw new Error(`Lifecycle obligation ${obligation.id} references a missing workflow`)
	}
	const retryableOnChainFailure = retryableOnChainWorkflowFailure(workflow)
	if (workflow.steps.some(step => step.transactionHash !== undefined) && !retryableOnChainFailure) {
		throw new Error('Lifecycle retry is unavailable after a semantically uncertain on-chain transaction; abandon only after manual reconciliation')
	}
	if (retryableOnChainFailure) {
		markRetryableWorkflowForRediscovery(workflow, 'Explicit operator retry requested after a finalized revert or verified nonce cancellation')
	} else {
		markWorkflowForRediscovery(workflow, 'Explicit operator retry requested after an unsigned failure')
	}
	const timestamp = now()
	obligation.blockers = []
	obligation.status = 'pending'
	obligation.updatedAt = timestamp
}

export function abandonLifecycleObligation(state: Pick<RuntimeState, 'lastScannedBlock' | 'obligationTombstones' | 'pendingTransactions' | 'workflows'>, obligation: DurableObligation, reason: string) {
	if (obligation.status === 'abandoned' || obligation.status === 'completed') {
		throw new Error('Lifecycle obligation is already terminal')
	}
	if (state.pendingTransactions.some(intent => intent.workflowId === obligation.workflowId)) {
		throw new Error('A lifecycle obligation with a pending transaction cannot be abandoned')
	}
	const normalizedReason = reason.trim()
	if (normalizedReason.length < 12 || normalizedReason.length > 2_048) {
		throw new Error('Lifecycle abandonment reason must contain 12 to 2048 characters')
	}
	const timestamp = now()
	obligation.resolutionReason = normalizedReason
	obligation.resolvedAt = timestamp
	obligation.status = 'abandoned'
	obligation.updatedAt = timestamp
	const workflow = state.workflows.find(candidate => candidate.id === obligation.workflowId)
	if (workflow === undefined) {
		throw new Error(`Lifecycle obligation ${obligation.id} references a missing workflow`)
	}
	if (workflow.status !== 'completed') {
		workflow.completedAt = timestamp
		workflow.status = 'abandoned'
		workflow.updatedAt = timestamp
	}
	upsertObligationTombstone(state.obligationTombstones, {
		id: obligation.id,
		resolution: 'abandoned',
		resolvedAt: timestamp,
		resolvedAtBlock: (state.lastScannedBlock ?? BigInt(workflow.createdAtBlock)).toString(),
		resolutionReason: normalizedReason,
	})
}

export function failLifecycleObligation(obligation: DurableObligation, error: unknown, recoverable: boolean) {
	const timestamp = now()
	obligation.lastError = error instanceof Error ? error.message : String(error)
	obligation.status = recoverable ? 'pending' : 'failed'
	obligation.updatedAt = timestamp
}

export function refreshObligationWorkflowForPlan(state: Pick<RuntimeState, 'obligations' | 'workflows'>, plan: OperationPlan) {
	const obligation = obligationForPlan(state, plan)
	if (obligation === undefined) return undefined
	const workflow = state.workflows.find(candidate => candidate.id === obligation.workflowId)
	if (workflow === undefined) throw new Error(`Lifecycle obligation ${obligation.id} references a missing workflow`)
	refreshPlannedWorkflow(workflow, plan)
	for (const step of workflow.steps) requireWorkflowStep(workflow, step.id)
	return workflow
}
