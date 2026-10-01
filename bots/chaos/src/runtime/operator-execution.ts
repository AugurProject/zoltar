import { operationalFailureDisposition } from '@zoltar/bot-shared/monitoring/resilience'
import { executionProfileId } from '../config/execution-profile.ts'
import { saveSettings } from '../config/settings.ts'
import { reconcileIncludedTransactions } from '../execution/inclusion-journal.ts'
import { recordPreflightFailure } from '../execution/preflight-failure.ts'
import { recoverPendingTransactions } from '../execution/recovery.ts'
import { executeOperationPlan, TransactionAwaitingRecovery } from '../execution/transaction-executor.ts'
import { ChaosProtocolIndexReorgError } from '../monitoring/protocol-index-context.ts'
import type { OperationPlan } from '../operations/types.ts'
import { recordActivity, type RuntimeState } from '../state/operator-state.ts'
import { restartSafeSettings } from './configuration-candidates.ts'
import type { ConfigurationState } from './dashboard-controller.ts'
import { executionEnvironment } from './execution-environment.ts'
import { beginLifecycleObligation, completeLifecycleObligation, failLifecycleObligation, obligationForPlan, waitForCanonicalLifecycleConfirmation } from './obligations.ts'
import { configuredWallet, currentStatus, errorMessage, persistState, prepareSubmission, type RuntimeResources } from './operator-context.ts'
import { executeScheduledOperation, scheduleAfterRecoveredTransaction, schedulerFor } from './scheduled-operation.ts'
import { abandonRetryableSelectableFailure, rediscoverableExecutionFailure, repairDurableSelectableFailures, workflowForPlan } from './workflow-repair.ts'
import { blockInterruptedWorkflows, retryableOnChainWorkflowFailure, workflowNeedsContinuation } from './workflows.ts'

async function executePlan(configuration: ConfigurationState, state: RuntimeState, resources: RuntimeResources, plan: OperationPlan, executionCancelled: () => boolean) {
	await executeOperationPlan(
		executionEnvironment(configuration.settings, state, resources, undefined, async () => await prepareSubmission(state, resources, configuration.settings), executionCancelled),
		plan,
	)
}

export async function executeLifecyclePlan(configuration: ConfigurationState, state: RuntimeState, resources: RuntimeResources, plan: OperationPlan, executionCancelled: () => boolean) {
	const obligation = obligationForPlan(state, plan)
	if (obligation === undefined) throw new Error(`Lifecycle plan ${plan.id} has no durable obligation`)
	beginLifecycleObligation(obligation)
	await persistState(configuration, state)
	try {
		await executePlan(configuration, state, resources, plan, executionCancelled)
		if (!completeLifecycleObligation(state, obligation)) {
			const workflow = workflowForPlan(state, plan)
			if (workflow?.status !== 'waiting-obligation') {
				throw new Error(`Lifecycle workflow ${obligation.workflowId} did not complete every step`)
			}
			waitForCanonicalLifecycleConfirmation(obligation)
		}
		await persistState(configuration, state)
	} catch (error) {
		if (error instanceof TransactionAwaitingRecovery) {
			failLifecycleObligation(obligation, error, true)
			await persistState(configuration, state)
			throw error
		}
		if (rediscoverableExecutionFailure(state, plan, error)) {
			failLifecycleObligation(obligation, error, true)
			recordPreflightFailure(state, plan, error, `Lifecycle preflight changed before signing: ${plan.label}`)
			await persistState(configuration, state)
			return
		}
		if (operationalFailureDisposition(error) === 'connectivity-degraded') {
			failLifecycleObligation(obligation, error, true)
			await persistState(configuration, state)
			throw error
		}
		const failedWorkflow = workflowForPlan(state, plan)
		if (failedWorkflow !== undefined && retryableOnChainWorkflowFailure(failedWorkflow)) {
			failLifecycleObligation(obligation, error, false)
			recordActivity(state, {
				ecosystem: plan.ecosystem,
				message: `Finalized lifecycle revert retained for canonical reconciliation: ${plan.label}`,
				operationId: plan.definitionId,
				status: 'skipped',
				type: 'recovery',
			})
			await persistState(configuration, state)
			return
		}
		failLifecycleObligation(obligation, error, false)
		await persistState(configuration, state)
		throw error
	}
}

export async function executeRandomPlan(configuration: ConfigurationState, state: RuntimeState, resources: RuntimeResources, plan: OperationPlan, executionCancelled: () => boolean, trigger: 'scheduled' | 'manual' | 'retirement' = 'scheduled') {
	await executeScheduledOperation(
		configuration,
		state,
		plan,
		async () => await executePlan(configuration, state, resources, plan, executionCancelled),
		error => {
			if (rediscoverableExecutionFailure(state, plan, error)) {
				recordPreflightFailure(state, plan, error, `Operation requires fresh preflight: ${plan.label}`)
				return true
			}
			if (abandonRetryableSelectableFailure(state, plan)) {
				return true
			}
			return false
		},
		trigger,
	)
}

export async function executeRandomContinuation(configuration: ConfigurationState, state: RuntimeState, resources: RuntimeResources, plan: OperationPlan, executionCancelled: () => boolean) {
	const scheduler = schedulerFor(configuration, state)
	try {
		await executePlan(configuration, state, resources, plan, executionCancelled)
		await (state.retirement.status === 'inactive' ? scheduler.complete(plan.definitionId) : scheduler.pause())
	} catch (error) {
		if (error instanceof TransactionAwaitingRecovery) throw error
		if (rediscoverableExecutionFailure(state, plan, error)) {
			recordPreflightFailure(state, plan, error, `Continuation requires fresh canonical discovery: ${plan.label}`, 'recovery')
			await persistState(configuration, state)
			return
		}
		if (abandonRetryableSelectableFailure(state, plan)) {
			await (state.retirement.status === 'inactive' ? scheduler.complete(plan.definitionId) : scheduler.pause())
			return
		}
		throw error
	}
}

/** Settle lifecycle obligations and scheduling for the workflow whose pending transaction was just recovered. */
async function settleRecoveredWorkflow(configuration: ConfigurationState, state: RuntimeState, workflowId: string, operationId: string, recoveryFailure: unknown) {
	blockInterruptedWorkflows(state)
	const failureRepair = repairDurableSelectableFailures(state)
	const workflow = state.workflows.find(candidate => candidate.id === workflowId)
	if (workflow === undefined) throw new Error(`Recovered workflow ${workflowId} is unavailable`)
	const obligation = state.obligations.find(candidate => candidate.workflowId === workflowId)
	let retryableLifecycleFailure = false
	const retryableSelectableFailure = failureRepair.repairedWorkflowIds.includes(workflow.id)
	if (workflowNeedsContinuation(workflow)) {
		if (obligation !== undefined) {
			failLifecycleObligation(obligation, 'Recovered one workflow step; canonical continuation is required before novelty', true)
		}
	} else if (obligation !== undefined) {
		if (workflow.status === 'failed') {
			retryableLifecycleFailure = retryableOnChainWorkflowFailure(workflow)
			failLifecycleObligation(obligation, recoveryFailure ?? 'Recovered transaction failed on chain', false)
		} else if (workflow.status === 'waiting-obligation') {
			waitForCanonicalLifecycleConfirmation(obligation)
		} else if (!completeLifecycleObligation(state, obligation) && workflow.status === 'blocked') {
			failLifecycleObligation(obligation, 'Recovered a prerequisite; canonical rediscovery is required for the remaining lifecycle steps', true)
		}
	} else {
		await scheduleAfterRecoveredTransaction(configuration, state, operationId)
	}
	await persistState(configuration, state)
	if (recoveryFailure !== undefined && !retryableLifecycleFailure && !retryableSelectableFailure) {
		throw recoveryFailure
	}
}

export async function reconcilePendingWork(configuration: ConfigurationState, state: RuntimeState, resources: RuntimeResources, executionCancelled: () => boolean) {
	const included = state.includedTransactions[0]
	if (included !== undefined || state.rollbackQueue.length !== 0) await reconcileIncludedTransactions(executionEnvironment(configuration.settings, state, resources, included?.intent.sender ?? state.rollbackQueue[0]?.intent.sender, undefined, executionCancelled))
	if (state.pendingTransactions.length === 0) return false
	const settings = configuration.settings
	const wallet = configuredWallet(settings)
	const profileMatches = state.profileId === executionProfileId(settings)
	const pending = state.pendingTransactions[0]
	if (pending === undefined) throw new Error('Pending transaction journal changed during recovery')
	if (wallet !== undefined && pending.sender.toLowerCase() !== wallet.toLowerCase()) {
		throw new Error('The configured signer does not match the pending transaction recovery signer')
	}
	const { operationId, workflowId } = pending
	let recoveryFailure: unknown
	const refreshSubmissionPreflight = async () => {
		if (state.paused || configuration.settings.paused || !configuration.settings.runtime.execute) {
			throw new Error('Chaos bot paused before pending transaction resubmission')
		}
		await prepareSubmission(state, resources, settings)
	}
	try {
		await recoverPendingTransactions(executionEnvironment(settings, state, resources, pending.sender, refreshSubmissionPreflight, executionCancelled), {
			beforeResubmit: refreshSubmissionPreflight,
			resubmit: wallet !== undefined && profileMatches && settings.runtime.execute && !settings.paused && !state.paused,
		})
	} catch (error) {
		recoveryFailure = error
	}
	if (state.pendingTransactions.length !== 0) {
		if (!profileMatches) {
			state.error = 'The pending transaction belongs to the previous deployment profile and is being checked read-only; restore that exact profile or queue a verified replacement reconciliation'
			state.status = 'paused'
			await persistState(configuration, state)
		} else if (wallet === undefined) {
			state.error = 'The pending transaction was checked read-only and is waiting for the exact recovery signer before resubmission'
			state.status = 'paused'
			await persistState(configuration, state)
		}
		if (recoveryFailure !== undefined) throw recoveryFailure
		return true
	}
	await settleRecoveredWorkflow(configuration, state, workflowId, operationId, recoveryFailure)
	return true
}

export async function safetyPause(configuration: ConfigurationState, state: RuntimeState) {
	state.safetyPaused = true
	state.paused = true
	state.scheduler.status = 'paused'
	state.status = 'paused'
	const failures: unknown[] = []
	try {
		await persistState(configuration, state)
	} catch (error) {
		failures.push(error)
	}
	if (!configuration.settings.paused) {
		const candidate = { ...configuration.settings, paused: true }
		try {
			const revision = await saveSettings(configuration.path, restartSafeSettings(candidate, configuration.rememberSigner), configuration.revision)
			configuration.revision = revision
			configuration.settings = candidate
		} catch (error) {
			failures.push(error)
		}
	}
	if (failures.length !== 0) {
		throw new AggregateError(failures, 'Chaos bot entered an in-memory safety pause, but one or more durable pause records could not be saved')
	}
}

export async function handleCycleFailure(error: unknown, configuration: ConfigurationState, state: RuntimeState) {
	state.deploymentNotice = undefined
	if (error instanceof ChaosProtocolIndexReorgError) {
		state.protocolIndex = undefined
		state.error = 'A protocol-index reorganization was detected; canonical backfill will restart from the configured protocol start block'
		state.status = currentStatus(configuration.settings)
		recordActivity(state, {
			message: 'Canonical protocol index invalidated by a chain reorganization',
			status: 'info',
			type: 'recovery',
		})
		await persistState(configuration, state)
		return
	}
	if (error instanceof TransactionAwaitingRecovery && error.severity === 'pending') {
		state.error = undefined
		const message = errorMessage(error)
		if (state.activities[0]?.message !== message) {
			recordActivity(state, {
				hash: error.hash,
				message,
				status: 'pending',
				type: 'transaction',
			})
		}
		await persistState(configuration, state)
		return
	}
	const message = errorMessage(error)
	const changed = state.error !== message
	state.error = message
	if (changed) {
		recordActivity(state, {
			message: `Operator cycle stopped safely: ${message}`,
			status: 'failed',
			type: 'error',
		})
	}
	if (error instanceof TransactionAwaitingRecovery) {
		state.status = 'connectivity-degraded'
	} else if (operationalFailureDisposition(error) === 'connectivity-degraded') {
		state.status = 'connectivity-degraded'
	} else {
		await safetyPause(configuration, state)
		state.status = 'paused'
	}
	await persistState(configuration, state)
}
