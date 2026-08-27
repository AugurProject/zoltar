import { randomUUID } from 'node:crypto'
import type { Hex } from '@zoltar/bot-shared/ethereum'
import type { OperationPlan } from '../operations/types.ts'
import type { DurableWorkflow, DurableWorkflowFailureKind, DurableWorkflowStep, PendingTransactionIntent, RuntimeState } from '../state/operator-state.ts'

function now() {
	return new Date().toISOString()
}

function workflowStep(planStep: OperationPlan['steps'][number]): DurableWorkflowStep {
	return {
		data: planStep.data,
		evidence: planStep.evidence,
		gasLimit: planStep.gasLimit,
		id: planStep.id,
		label: planStep.label,
		preflightCalls: [...planStep.preflightCalls],
		status: 'planned',
		to: planStep.to,
		value: planStep.value ?? '0',
		walletAssetDebits: planStep.walletAssetDebits,
	}
}

function canonicalMetadata(metadata: OperationPlan['metadata']) {
	return JSON.stringify(Object.fromEntries(Object.entries(metadata).sort(([left], [right]) => left.localeCompare(right))))
}

function stepRequiresCanonicalLifecycleConfirmation(step: Pick<DurableWorkflowStep, 'evidence'>) {
	return step.evidence.some(evidence => evidence.kind === 'decoded-event-field' && evidence.canonicalLifecycleConfirmation === true)
}

export function assertCanonicalLifecycleConfirmationBoundary(plan: Pick<OperationPlan, 'classification' | 'id' | 'obligation' | 'steps'>) {
	if (!plan.steps.some(stepRequiresCanonicalLifecycleConfirmation)) return
	if (plan.classification !== 'lifecycle-obligation' || !plan.obligation) {
		throw new Error(`Plan ${plan.id} uses canonical lifecycle confirmation outside a lifecycle obligation`)
	}
	const terminalStep = plan.steps.at(-1)
	if (terminalStep === undefined || !stepRequiresCanonicalLifecycleConfirmation(terminalStep) || plan.steps.slice(0, -1).some(stepRequiresCanonicalLifecycleConfirmation)) {
		throw new Error(`Plan ${plan.id} must reserve canonical lifecycle confirmation for its terminal step`)
	}
}

export function workflowMatchesContinuationPlan(workflow: DurableWorkflow, plan: OperationPlan) {
	return workflow.ecosystem === plan.ecosystem && workflow.operationId === plan.definitionId && canonicalMetadata(workflow.metadata) === canonicalMetadata(plan.metadata)
}

export function workflowNeedsContinuation(workflow: DurableWorkflow) {
	return (workflow.status === 'blocked' || workflow.status === 'waiting-continuation') && workflow.steps.some(step => step.status === 'confirmed') && workflow.steps.some(step => step.status !== 'confirmed')
}

function sameConfirmedStep(existing: DurableWorkflowStep, fresh: DurableWorkflowStep) {
	return existing.to.toLowerCase() === fresh.to.toLowerCase() && existing.data.toLowerCase() === fresh.data.toLowerCase() && existing.value === fresh.value
}

export function refreshWorkflowContinuation(workflow: DurableWorkflow, plan: OperationPlan) {
	assertCanonicalLifecycleConfirmationBoundary(plan)
	if (!workflowMatchesContinuationPlan(workflow, plan)) {
		throw new Error(`Workflow ${workflow.id} does not match the canonical continuation plan`)
	}
	const freshSteps = plan.steps.map(workflowStep)
	const freshIds = new Set(freshSteps.map(step => step.id))
	const retainedHistoricalSteps = workflow.steps.filter(step => step.status === 'confirmed' && !freshIds.has(step.id))
	const mergedFreshSteps = freshSteps.map(fresh => {
		const existing = workflow.steps.find(step => step.id === fresh.id)
		if (existing?.status !== 'confirmed') return fresh
		if (!sameConfirmedStep(existing, fresh)) {
			throw new Error(`Confirmed workflow step ${fresh.id} changed destination, calldata, or value during canonical rediscovery`)
		}
		return existing
	})
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
	workflow.label = plan.label
	workflow.metadata = { ...plan.metadata }
	workflow.obligation = plan.obligation
	workflow.planId = plan.id
	workflow.planningSeed = plan.planningSeed
	workflow.postconditions = [...plan.postconditions]
	workflow.priority = plan.priority
	workflow.risk = plan.risk
	workflow.steps = [...retainedHistoricalSteps, ...mergedFreshSteps]
	delete workflow.completedAt
	workflow.status = 'waiting-continuation'
	workflow.updatedAt = now()
	return workflow
}

export function durableWorkflowPlan(workflow: DurableWorkflow): OperationPlan {
	return {
		classification: workflow.classification,
		createdAtBlock: workflow.createdAtBlock,
		definitionId: workflow.operationId,
		...(workflow.deadlineTimestamp === undefined ? {} : { deadlineTimestamp: workflow.deadlineTimestamp }),
		ecosystem: workflow.ecosystem,
		id: workflow.planId,
		label: workflow.label,
		...(workflow.lastValidBlockNumber === undefined ? {} : { lastValidBlockNumber: workflow.lastValidBlockNumber }),
		...(workflow.semanticDeadlineBlockNumber === undefined
			? {}
			: {
					semanticDeadlineBlockNumber: workflow.semanticDeadlineBlockNumber,
				}),
		metadata: { ...workflow.metadata },
		obligation: workflow.obligation,
		postconditions: [...workflow.postconditions],
		priority: workflow.priority,
		planningSeed: workflow.planningSeed,
		risk: workflow.risk,
		steps: workflow.steps.map(step => ({
			data: step.data,
			evidence: [...step.evidence],
			gasLimit: step.gasLimit,
			id: step.id,
			label: step.label,
			preflightCalls: [...step.preflightCalls],
			to: step.to,
			...(step.value === '0' ? {} : { value: step.value }),
			walletAssetDebits: [...step.walletAssetDebits],
		})),
	}
}

export function createDurableWorkflow(plan: OperationPlan): DurableWorkflow {
	assertCanonicalLifecycleConfirmationBoundary(plan)
	const createdAt = now()
	return {
		classification: plan.classification,
		createdAtBlock: plan.createdAtBlock,
		createdAt,
		...(plan.deadlineTimestamp === undefined ? {} : { deadlineTimestamp: plan.deadlineTimestamp }),
		ecosystem: plan.ecosystem,
		id: `workflow:${randomUUID()}`,
		label: plan.label,
		...(plan.lastValidBlockNumber === undefined ? {} : { lastValidBlockNumber: plan.lastValidBlockNumber }),
		...(plan.semanticDeadlineBlockNumber === undefined
			? {}
			: {
					semanticDeadlineBlockNumber: plan.semanticDeadlineBlockNumber,
				}),
		metadata: plan.metadata,
		obligation: plan.obligation,
		operationId: plan.definitionId,
		planId: plan.id,
		planningSeed: plan.planningSeed,
		postconditions: [...plan.postconditions],
		priority: plan.priority,
		risk: plan.risk,
		status: 'planned',
		steps: plan.steps.map(workflowStep),
		updatedAt: createdAt,
	}
}

export function retainWorkflow(state: Pick<RuntimeState, 'workflows'>, plan: OperationPlan) {
	const existing = state.workflows.find(workflow => workflow.planId === plan.id && workflow.status !== 'abandoned' && workflow.status !== 'completed' && workflow.status !== 'failed' && workflow.status !== 'blocked')
	if (existing !== undefined) return existing
	const workflow = createDurableWorkflow(plan)
	state.workflows.unshift(workflow)
	return workflow
}

export function requireWorkflowStep(workflow: DurableWorkflow, stepId: string) {
	const step = workflow.steps.find(candidate => candidate.id === stepId)
	if (step === undefined) throw new Error(`Workflow ${workflow.id} does not contain step ${stepId}`)
	return step
}

export function startWorkflow(workflow: DurableWorkflow) {
	const timestamp = now()
	workflow.startedAt ??= timestamp
	workflow.status = 'running'
	workflow.updatedAt = timestamp
}

export function markWorkflowStepSigned(workflow: DurableWorkflow, stepId: string, intentId: string, hash: Hex) {
	const timestamp = now()
	const step = requireWorkflowStep(workflow, stepId)
	step.startedAt ??= timestamp
	step.status = 'signed'
	step.transactionHash = hash
	step.transactionIntentId = intentId
	workflow.status = 'waiting-transaction'
	workflow.updatedAt = timestamp
}

export function markWorkflowStepSubmitted(workflow: DurableWorkflow, stepId: string) {
	const step = requireWorkflowStep(workflow, stepId)
	step.status = 'submitted'
	workflow.status = 'waiting-transaction'
	workflow.updatedAt = now()
}

export function markWorkflowIntentBroadcastAttempt(workflow: DurableWorkflow, intent: Pick<PendingTransactionIntent, 'status' | 'stepId' | 'submissionBlock' | 'submittedAt'>, submissionBlock: bigint) {
	if (submissionBlock < 0n) throw new Error('Transaction submission block cannot be negative')
	intent.status = 'confirmation-unknown'
	intent.submissionBlock ??= submissionBlock
	intent.submittedAt ??= now()
	markWorkflowStepSubmitted(workflow, intent.stepId)
}

export type WorkflowIntentSubmissionJournal = {
	intentStatus: PendingTransactionIntent['status']
	stepStatus: DurableWorkflowStep['status']
	submissionBlock: bigint | undefined
	submittedAt: string | undefined
	workflowStatus: DurableWorkflow['status']
	workflowUpdatedAt: string
}

export function captureWorkflowIntentSubmissionJournal(workflow: DurableWorkflow, intent: Pick<PendingTransactionIntent, 'status' | 'stepId' | 'submissionBlock' | 'submittedAt'>): WorkflowIntentSubmissionJournal {
	const step = requireWorkflowStep(workflow, intent.stepId)
	return {
		intentStatus: intent.status,
		stepStatus: step.status,
		submissionBlock: intent.submissionBlock,
		submittedAt: intent.submittedAt,
		workflowStatus: workflow.status,
		workflowUpdatedAt: workflow.updatedAt,
	}
}

/** Restore an exact prior journal only after proving no network submission was attempted. */
export function restoreWorkflowIntentSubmissionJournal(workflow: DurableWorkflow, intent: Pick<PendingTransactionIntent, 'status' | 'stepId' | 'submissionBlock' | 'submittedAt'>, journal: WorkflowIntentSubmissionJournal) {
	const step = requireWorkflowStep(workflow, intent.stepId)
	intent.status = journal.intentStatus
	if (journal.submissionBlock === undefined) delete intent.submissionBlock
	else intent.submissionBlock = journal.submissionBlock
	if (journal.submittedAt === undefined) delete intent.submittedAt
	else intent.submittedAt = journal.submittedAt
	step.status = journal.stepStatus
	workflow.status = journal.workflowStatus
	workflow.updatedAt = journal.workflowUpdatedAt
}

export function markWorkflowStepConfirmed(workflow: DurableWorkflow, stepId: string, hash: Hex) {
	const timestamp = now()
	const step = requireWorkflowStep(workflow, stepId)
	delete step.failure
	delete step.failureKind
	step.confirmedAt = timestamp
	step.status = 'confirmed'
	step.transactionHash = hash
	workflow.updatedAt = timestamp
	if (workflow.steps.every(candidate => candidate.status === 'confirmed')) {
		workflow.completedAt = timestamp
		workflow.status = 'completed'
	} else {
		workflow.status = 'running'
	}
}

export function markWorkflowStepWaitingCanonical(workflow: DurableWorkflow, stepId: string, hash: Hex) {
	const timestamp = now()
	const step = requireWorkflowStep(workflow, stepId)
	const terminalStep = workflow.steps.at(-1)
	if (workflow.classification !== 'lifecycle-obligation' || !workflow.obligation) {
		throw new Error(`Workflow ${workflow.id} cannot wait for canonical confirmation outside a lifecycle obligation`)
	}
	if (terminalStep !== step || !stepRequiresCanonicalLifecycleConfirmation(step) || workflow.steps.slice(0, -1).some(stepRequiresCanonicalLifecycleConfirmation)) {
		throw new Error(`Workflow ${workflow.id} can wait for canonical confirmation only on its declared terminal step`)
	}
	if (workflow.steps.some(candidate => candidate.id !== step.id && candidate.status !== 'confirmed')) {
		throw new Error(`Workflow ${workflow.id} cannot wait for canonical confirmation before every prerequisite is confirmed`)
	}
	delete step.failure
	delete step.failureKind
	step.confirmedAt = timestamp
	step.status = 'confirmed'
	step.transactionHash = hash
	delete workflow.completedAt
	workflow.status = 'waiting-obligation'
	workflow.updatedAt = timestamp
}

export function completeWorkflowFromCanonicalConfirmation(workflow: DurableWorkflow) {
	const terminalStep = workflow.steps.at(-1)
	if (
		workflow.classification !== 'lifecycle-obligation' ||
		!workflow.obligation ||
		workflow.status !== 'waiting-obligation' ||
		workflow.completedAt !== undefined ||
		workflow.steps.some(step => step.status !== 'confirmed') ||
		terminalStep === undefined ||
		!stepRequiresCanonicalLifecycleConfirmation(terminalStep) ||
		workflow.steps.slice(0, -1).some(stepRequiresCanonicalLifecycleConfirmation)
	) {
		throw new Error(`Workflow ${workflow.id} is not waiting for canonical lifecycle confirmation`)
	}
	const timestamp = now()
	workflow.completedAt = timestamp
	workflow.status = 'completed'
	workflow.updatedAt = timestamp
}

export function markWorkflowFailed(workflow: DurableWorkflow, stepId: string, error: unknown, failureKind: DurableWorkflowFailureKind) {
	const timestamp = now()
	const step = requireWorkflowStep(workflow, stepId)
	step.failure = error instanceof Error ? error.message : String(error)
	step.failureKind = failureKind
	step.status = 'failed'
	workflow.completedAt = timestamp
	workflow.status = 'failed'
	workflow.updatedAt = timestamp
}

export function retryableOnChainWorkflowFailure(workflow: DurableWorkflow) {
	return workflow.steps.some(step => step.status === 'failed' && (step.failureKind === 'receipt-reverted' || step.failureKind === 'nonce-cancelled'))
}

export function markRetryableWorkflowForRediscovery(workflow: DurableWorkflow, reason: string) {
	const step = workflow.steps.find(candidate => candidate.status === 'failed' && (candidate.failureKind === 'receipt-reverted' || candidate.failureKind === 'nonce-cancelled'))
	if (step === undefined) throw new Error(`Workflow ${workflow.id} has no retryable finalized failure`)
	delete step.failureKind
	delete step.transactionHash
	delete step.transactionIntentId
	delete step.confirmedAt
	step.failure = reason
	step.status = 'blocked'
	delete workflow.completedAt
	workflow.status = workflow.steps.some(candidate => candidate.status === 'confirmed') ? 'waiting-continuation' : 'blocked'
	workflow.updatedAt = now()
}

export function recoverableWorkflowForIntent(state: Pick<RuntimeState, 'workflows'>, workflowId: string) {
	const workflow = state.workflows.find(candidate => candidate.id === workflowId)
	if (workflow === undefined) throw new Error(`Pending transaction references missing workflow ${workflowId}`)
	return workflow
}

export function blockInterruptedWorkflows(state: { pendingTransactions: readonly Pick<PendingTransactionIntent, 'workflowId'>[]; workflows: DurableWorkflow[] }) {
	const pendingWorkflowIds = new Set(state.pendingTransactions.map(intent => intent.workflowId))
	const timestamp = now()
	for (const workflow of state.workflows) {
		if (workflow.status !== 'running' && workflow.status !== 'waiting-transaction') {
			continue
		}
		if (pendingWorkflowIds.has(workflow.id)) continue
		const incomplete = workflow.steps.find(step => step.status !== 'confirmed')
		const hasConfirmedStep = workflow.steps.some(step => step.status === 'confirmed')
		if (incomplete !== undefined && hasConfirmedStep && (incomplete.status === 'planned' || incomplete.status === 'blocked')) {
			delete workflow.completedAt
			workflow.status = 'waiting-continuation'
			workflow.updatedAt = timestamp
			continue
		}
		if (incomplete !== undefined) {
			incomplete.failure = 'The process stopped before a signed transaction intent was durably recorded; rediscovery is required.'
			incomplete.status = 'blocked'
		}
		if (workflow.classification === 'selectable') {
			workflow.completedAt = timestamp
			workflow.status = 'abandoned'
		} else {
			delete workflow.completedAt
			workflow.status = 'blocked'
		}
		workflow.updatedAt = timestamp
	}
}

export function workflowFailureHasTransaction(workflow: DurableWorkflow) {
	return workflow.steps.some(step => step.status === 'failed' && step.transactionHash !== undefined)
}

export function markWorkflowForRediscovery(workflow: DurableWorkflow, error: unknown) {
	if (workflowFailureHasTransaction(workflow)) {
		throw new Error(`Workflow ${workflow.id} has a failed on-chain transaction and cannot be reset for rediscovery`)
	}
	const timestamp = now()
	const incomplete = workflow.steps.find(step => step.status !== 'confirmed')
	if (incomplete !== undefined) {
		incomplete.failure = error instanceof Error ? error.message : String(error)
		incomplete.status = 'blocked'
	}
	if (workflow.steps.some(step => step.status === 'confirmed')) {
		delete workflow.completedAt
		workflow.status = 'waiting-continuation'
	} else if (workflow.classification === 'selectable') {
		workflow.completedAt = timestamp
		workflow.status = 'abandoned'
	} else {
		delete workflow.completedAt
		workflow.status = 'blocked'
	}
	workflow.updatedAt = timestamp
}
