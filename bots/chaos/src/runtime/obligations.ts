import { createHash } from 'node:crypto'
import type { CanonicalLifecyclePresence, EvaluatedOperation, OperationPlan } from '../operations/types.ts'
import { completeWorkflowFromCanonicalConfirmation, createDurableWorkflow, markWorkflowForRediscovery, markRetryableLifecycleWorkflowForRediscovery, refreshWorkflowContinuation, requireWorkflowStep, retryableOnChainWorkflowFailure } from './workflows.ts'
import { MAXIMUM_LIFECYCLE_PRESENCE_BLOCKER_COUNT, MAXIMUM_OBLIGATION_TOMBSTONE_COUNT, type DurableLifecyclePresenceBlocker, type DurableMetadata, type DurableObligation, type DurableObligationTombstone, type DurableWorkflow, type RuntimeState } from '../state/operator-state.ts'

export const OBLIGATION_TOMBSTONE_RETENTION_BLOCKS = 64n
export const MAXIMUM_ACTIVE_LIFECYCLE_OBLIGATIONS = 256
export const MAXIMUM_AUTOMATIC_LIFECYCLE_ATTEMPTS = 3
const AUTOMATIC_LIFECYCLE_RETRY_BASE_SECONDS = 60n
const AUTOMATIC_LIFECYCLE_RETRY_MAX_SECONDS = 3_600n

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

function uniqueCanonicalPresence(canonicalPresence: readonly CanonicalLifecyclePresence[]) {
	if (canonicalPresence.length > MAXIMUM_LIFECYCLE_PRESENCE_BLOCKER_COUNT) {
		throw new Error(`Canonical lifecycle presence exceeds the ${MAXIMUM_LIFECYCLE_PRESENCE_BLOCKER_COUNT.toString()}-identity safety limit`)
	}
	const unique = new Map<string, CanonicalLifecyclePresence>()
	for (const instance of canonicalPresence) {
		const id = operationInstanceId(instance)
		const existing = unique.get(id)
		if (existing !== undefined && (existing.blocksNovelty !== instance.blocksNovelty || existing.definitionId !== instance.definitionId || existing.ecosystem !== instance.ecosystem || canonicalMetadata(existing.metadata) !== canonicalMetadata(instance.metadata))) {
			throw new Error(`Canonical lifecycle identities collide at ${id}`)
		}
		unique.set(id, instance)
		if (unique.size > MAXIMUM_LIFECYCLE_PRESENCE_BLOCKER_COUNT) {
			throw new Error(`Canonical lifecycle presence exceeds the ${MAXIMUM_LIFECYCLE_PRESENCE_BLOCKER_COUNT.toString()}-identity safety limit`)
		}
	}
	return unique
}

function lifecyclePresenceBlocker(instances: ReadonlyMap<string, CanonicalLifecyclePresence>, currentBlock: bigint, presenceComplete: boolean, reason: DurableLifecyclePresenceBlocker['reason']): DurableLifecyclePresenceBlocker | undefined {
	const sorted = [...instances.entries()].sort(([left], [right]) => left.localeCompare(right))
	const first = sorted[0]
	if (first === undefined) return undefined
	const digest = createHash('sha256')
		.update('chaos-bot:unplanned-lifecycle-presence:v1\0')
		.update(sorted.map(([id]) => `${id.length.toString()}:${id}`).join('\0'))
		.digest('hex')
	return {
		count: sorted.length,
		digest: `0x${digest}`,
		firstDefinitionId: first[1].definitionId,
		firstEcosystem: first[1].ecosystem,
		observedAtBlock: currentBlock.toString(),
		presenceComplete,
		reason,
	}
}

export function lifecyclePresenceBlockerMessage(blocker: DurableLifecyclePresenceBlocker) {
	const noun = blocker.count === 1 ? 'identity' : 'identities'
	if (blocker.reason === 'completed-identity-returned') {
		const observation = blocker.presenceComplete ? `Complete canonical lifecycle discovery at block ${blocker.observedAtBlock} found ${blocker.count.toString()}` : `Incomplete canonical lifecycle discovery at block ${blocker.observedAtBlock} exposed at least ${blocker.count.toString()}`
		return `${observation} previously completed due ${noun}, beginning with ${blocker.firstDefinitionId} (${blocker.firstEcosystem}), after complete discovery had confirmed absence; random novelty remains blocked until the canonical reorganization is reconciled manually or complete discovery proves the identities absent again`
	}
	const observation = blocker.presenceComplete ? `Complete canonical lifecycle discovery at block ${blocker.observedAtBlock} contained ${blocker.count.toString()}` : `Incomplete canonical lifecycle discovery at block ${blocker.observedAtBlock} exposed at least ${blocker.count.toString()}`
	return `${observation} unplanned due ${noun}, beginning with ${blocker.firstDefinitionId} (${blocker.firstEcosystem}); random novelty remains blocked until complete discovery proves every due identity is represented by a durable obligation or terminal tombstone, or has left its obstructing protocol phase`
}

function timestampFromSeconds(value: string | undefined) {
	if (value === undefined) return undefined
	if (!/^(?:0|[1-9]\d*)$/.test(value)) throw new Error('Lifecycle obligation deadline is invalid')
	const milliseconds = BigInt(value) * 1_000n
	if (milliseconds > BigInt(8_640_000_000_000_000)) throw new Error('Lifecycle obligation deadline is outside the supported date range')
	return new Date(Number(milliseconds)).toISOString()
}

function automaticLifecycleRetryDelaySeconds(automaticRetryCount: number) {
	if (!Number.isSafeInteger(automaticRetryCount) || automaticRetryCount < 1) throw new Error('Automatic lifecycle retry requires a positive finalized-failure count')
	const exponent = Math.min(automaticRetryCount - 1, 20)
	const delay = AUTOMATIC_LIFECYCLE_RETRY_BASE_SECONDS * 2n ** BigInt(exponent)
	return delay < AUTOMATIC_LIFECYCLE_RETRY_MAX_SECONDS ? delay : AUTOMATIC_LIFECYCLE_RETRY_MAX_SECONDS
}

function accountAutomaticLifecycleFailure(obligation: DurableObligation, currentTimestamp: bigint) {
	// notBefore is persisted with the first accounting pass for a failure episode.
	// Subsequent canonical scans must retain the same budget slot and deadline.
	const existing = obligation.notBefore
	if (existing !== undefined) return existing
	if (obligation.automaticRetryCount >= MAXIMUM_AUTOMATIC_LIFECYCLE_ATTEMPTS) return undefined
	const automaticRetryCount = obligation.automaticRetryCount + 1
	if (automaticRetryCount >= MAXIMUM_AUTOMATIC_LIFECYCLE_ATTEMPTS) {
		obligation.automaticRetryCount = automaticRetryCount
		return undefined
	}
	const retryAt = timestampFromSeconds((currentTimestamp + automaticLifecycleRetryDelaySeconds(automaticRetryCount)).toString())
	if (retryAt === undefined) throw new Error('Automatic lifecycle retry timestamp is unavailable')
	// Commit the count and its durable marker together after every fallible calculation.
	obligation.automaticRetryCount = automaticRetryCount
	obligation.notBefore = retryAt
	return retryAt
}

function retryTimestampSeconds(value: string) {
	const milliseconds = Date.parse(value)
	if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || milliseconds % 1_000 !== 0) throw new Error('Automatic lifecycle retry timestamp is invalid')
	return BigInt(milliseconds / 1_000)
}

function retainAutomaticLifecycleRetry(obligation: DurableObligation, retryAt: string, reason: string) {
	obligation.blockers = [`${reason}; automatic retry is scheduled for ${retryAt}`]
	obligation.status = 'deferred'
	obligation.updatedAt = now()
}

function retainExhaustedLifecycleRetry(obligation: DurableObligation) {
	delete obligation.notBefore
	obligation.blockers = [`The automatic retry limit of ${MAXIMUM_AUTOMATIC_LIFECYCLE_ATTEMPTS.toString()} canonically finalized lifecycle failures is exhausted; explicit operator reconciliation is required`]
	obligation.status = 'failed'
	obligation.updatedAt = now()
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
		automaticRetryCount: 0,
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

export function synchronizeLifecycleObligations(
	state: Pick<RuntimeState, 'lifecyclePresenceBlocker' | 'obligationTombstones' | 'obligations' | 'pendingTransactions' | 'workflows'>,
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
	const canonicalById = uniqueCanonicalPresence(canonicalPresence)
	const present = new Set(canonicalById.keys())
	const obstructing = new Set([...canonicalById].flatMap(([id, instance]) => (instance.blocksNovelty ? [id] : [])))
	const actionable = new Set(plans.map(plan => operationInstanceId(plan)))
	for (const id of actionable) {
		if (!present.has(id)) throw new Error(`Actionable lifecycle identity ${id} is missing from canonical presence`)
		if (!obstructing.has(id)) throw new Error(`Actionable lifecycle identity ${id} is missing from obstructing canonical presence`)
	}
	const terminalIds = new Set(state.obligationTombstones.map(tombstone => tombstone.id))
	const obligationsById = new Map(state.obligations.map(obligation => [obligation.id, obligation]))
	const workflowsById = new Map(state.workflows.map(workflow => [workflow.id, workflow]))
	let activeObligationCount = state.obligations.filter(obligation => obligation.status !== 'abandoned' && obligation.status !== 'completed').length
	let reservedTombstoneCount = terminalIds.size + state.obligations.filter(obligation => obligation.status !== 'abandoned' && obligation.status !== 'completed' && !terminalIds.has(obligation.id)).length
	if (reservedTombstoneCount > MAXIMUM_OBLIGATION_TOMBSTONE_COUNT) {
		throw new Error(`Lifecycle obligations reserve more than the ${MAXIMUM_OBLIGATION_TOMBSTONE_COUNT.toString()}-tombstone durable safety limit`)
	}
	for (const plan of plans) {
		const id = operationInstanceId(plan)
		if (terminalIds.has(id)) {
			continue
		}
		let obligation = obligationsById.get(id)
		if (obligation === undefined) {
			if (activeObligationCount >= MAXIMUM_ACTIVE_LIFECYCLE_OBLIGATIONS || reservedTombstoneCount >= MAXIMUM_OBLIGATION_TOMBSTONE_COUNT) continue
			const workflow = createDurableWorkflow(plan)
			state.workflows.unshift(workflow)
			obligation = newObligation(plan, workflow)
			state.obligations.unshift(obligation)
			obligationsById.set(id, obligation)
			workflowsById.set(workflow.id, workflow)
			activeObligationCount += 1
			reservedTombstoneCount += 1
			continue
		}
		const workflow = workflowsById.get(obligation.workflowId)
		if (workflow === undefined) throw new Error(`Lifecycle obligation ${id} references a missing workflow`)
		if ((obligation.status === 'failed' || obligation.status === 'deferred') && retryableOnChainWorkflowFailure(workflow)) {
			const retryAt = accountAutomaticLifecycleFailure(obligation, currentTimestamp)
			if (obligation.automaticRetryCount >= MAXIMUM_AUTOMATIC_LIFECYCLE_ATTEMPTS) {
				retainExhaustedLifecycleRetry(obligation)
				continue
			}
			if (retryAt === undefined) throw new Error(`Lifecycle obligation ${id} is missing its automatic retry deadline`)
			if (currentTimestamp < retryTimestampSeconds(retryAt)) {
				retainAutomaticLifecycleRetry(obligation, retryAt, 'A canonically finalized lifecycle attempt reverted or was nonce-cancelled')
				continue
			}
			markRetryableLifecycleWorkflowForRediscovery(workflow, 'Automatic retry after a canonically finalized revert or verified nonce cancellation')
			refreshPlannedWorkflow(workflow, plan)
			delete obligation.notBefore
			obligation.blockers = []
			obligation.label = plan.label
			obligation.metadata = plan.metadata
			obligation.status = 'pending'
			obligation.updatedAt = now()
			continue
		}
		// A completed lifecycle item may remain visible for a few anchored scans while
		// RPC nodes converge. Its stable identity must stay terminal; recreating it
		// here could repeat an irreversible operation against the same protocol item.
		if (obligation.status === 'abandoned' || obligation.status === 'completed' || obligation.status === 'failed') {
			continue
		}
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
		const workflow = workflowsById.get(obligation.workflowId)
		if (workflow === undefined) throw new Error(`Lifecycle obligation ${obligation.id} references a missing workflow`)
		if (workflow.status === 'completed') {
			recoverCompletedObligation(state, obligation, workflow, currentBlock)
			continue
		}
		const hasPendingIntent = state.pendingTransactions.some(intent => intent.workflowId === obligation.workflowId)
		if (presenceComplete && !present.has(obligation.id) && !hasPendingIntent && !hasSemanticFailure(workflow)) {
			if (workflow.status === 'waiting-obligation') {
				completeWorkflowFromCanonicalConfirmation(workflow)
				recoverCompletedObligation(state, obligation, workflow, currentBlock)
			} else {
				recoverTerminalObligation(state, obligation, workflow, currentBlock, 'Complete canonical lifecycle discovery no longer contains this outstanding identity; it was terminally superseded without claiming semantic success')
			}
			continue
		}
		if (retryableOnChainWorkflowFailure(workflow)) {
			const retryAt = accountAutomaticLifecycleFailure(obligation, currentTimestamp)
			if (obligation.automaticRetryCount >= MAXIMUM_AUTOMATIC_LIFECYCLE_ATTEMPTS) retainExhaustedLifecycleRetry(obligation)
			else {
				if (retryAt === undefined) throw new Error(`Lifecycle obligation ${obligation.id} is missing its automatic retry deadline`)
				retainAutomaticLifecycleRetry(obligation, retryAt, 'The lifecycle item is awaiting a fresh canonical action plan')
			}
			continue
		}
		if (obligation.status !== 'failed') {
			const canonical = canonicalById.get(obligation.id)
			const canDefer = presenceComplete && canonical?.blocksNovelty === false && !hasPendingIntent && workflow.status !== 'waiting-obligation' && !hasSemanticFailure(workflow)
			obligation.blockers = [canDefer ? 'The lifecycle item is tracked but not currently actionable; unrelated random work may continue' : 'The lifecycle item is not currently eligible at the canonical snapshot']
			obligation.status = canDefer ? 'deferred' : 'pending'
			obligation.updatedAt = now()
		}
	}
	for (const tombstone of state.obligationTombstones) {
		if (present.has(tombstone.id)) {
			tombstone.lastSeenBlock = currentBlock.toString()
		} else if (presenceComplete) {
			const lastSeenBlock = tombstone.lastSeenBlock === undefined ? undefined : BigInt(tombstone.lastSeenBlock)
			const observedAbsentAtBlock = tombstone.observedAbsentAtBlock === undefined ? undefined : BigInt(tombstone.observedAbsentAtBlock)
			if (observedAbsentAtBlock === undefined || (lastSeenBlock !== undefined && lastSeenBlock >= observedAbsentAtBlock)) {
				tombstone.observedAbsentAtBlock = currentBlock.toString()
			}
		}
	}
	const retiredIds = new Set(
		state.obligationTombstones.flatMap(tombstone => {
			if (!presenceComplete || present.has(tombstone.id)) return []
			if (tombstone.observedAbsentAtBlock === undefined) return []
			const retainedThrough = BigInt(tombstone.observedAbsentAtBlock)
			return currentBlock > retainedThrough + OBLIGATION_TOMBSTONE_RETENTION_BLOCKS ? [tombstone.id] : []
		}),
	)
	if (retiredIds.size !== 0) {
		const retiredWorkflowIds = new Set(state.obligations.filter(obligation => retiredIds.has(obligation.id)).map(obligation => obligation.workflowId))
		state.obligationTombstones = state.obligationTombstones.filter(tombstone => !retiredIds.has(tombstone.id))
		state.obligations = state.obligations.filter(obligation => !retiredIds.has(obligation.id))
		state.workflows = state.workflows.filter(workflow => !retiredWorkflowIds.has(workflow.id))
	}
	const tombstonesById = new Map(state.obligationTombstones.map(tombstone => [tombstone.id, tombstone]))
	const completedIdentityReturned = new Map(
		[...canonicalById].filter(([id, instance]) => {
			const tombstone = tombstonesById.get(id)
			return instance.blocksNovelty && tombstone?.resolution === 'completed' && tombstone.observedAbsentAtBlock !== undefined
		}),
	)
	const returnedIds = new Set(completedIdentityReturned.keys())
	const represented = new Set([...state.obligations.flatMap(obligation => (returnedIds.has(obligation.id) ? [] : [obligation.id])), ...state.obligationTombstones.flatMap(tombstone => (returnedIds.has(tombstone.id) ? [] : [tombstone.id]))])
	const uncovered = new Map([...canonicalById].filter(([id, instance]) => instance.blocksNovelty && !represented.has(id)))
	const blockerInstances = completedIdentityReturned.size === 0 ? uncovered : completedIdentityReturned
	const blockerReason = completedIdentityReturned.size === 0 ? 'unplanned-due-identity' : 'completed-identity-returned'
	if (presenceComplete) {
		state.lifecyclePresenceBlocker = lifecyclePresenceBlocker(blockerInstances, currentBlock, true, blockerReason)
	} else if (state.lifecyclePresenceBlocker === undefined && blockerInstances.size !== 0) {
		state.lifecyclePresenceBlocker = lifecyclePresenceBlocker(blockerInstances, currentBlock, false, blockerReason)
	}
	return plans
}

export function obligationForPlan(state: Pick<RuntimeState, 'obligations' | 'workflows'>, plan: OperationPlan) {
	const obligation = state.obligations.find(candidate => candidate.id === operationInstanceId(plan) && candidate.status === 'pending')
	if (obligation === undefined) return undefined
	const workflow = state.workflows.find(candidate => candidate.id === obligation.workflowId)
	return workflow?.status === 'waiting-obligation' ? undefined : obligation
}

export function beginLifecycleObligation(obligation: DurableObligation) {
	const timestamp = now()
	obligation.attemptCount += 1
	obligation.blockers = []
	obligation.lastAttemptAt = timestamp
	delete obligation.lastError
	delete obligation.notBefore
	obligation.status = 'executing'
	obligation.updatedAt = timestamp
}

export function waitForCanonicalLifecycleConfirmation(obligation: DurableObligation) {
	const timestamp = now()
	obligation.blockers = ['A finalized transaction is waiting for complete canonical lifecycle confirmation']
	delete obligation.lastError
	obligation.status = 'pending'
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
		markRetryableLifecycleWorkflowForRediscovery(workflow, 'Explicit operator retry requested after a finalized revert or verified nonce cancellation')
	} else {
		markWorkflowForRediscovery(workflow, 'Explicit operator retry requested after an unsigned failure')
	}
	const timestamp = now()
	obligation.blockers = []
	delete obligation.notBefore
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
