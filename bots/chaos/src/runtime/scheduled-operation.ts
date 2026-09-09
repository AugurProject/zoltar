import { createChaosScheduler } from '../core/scheduler.ts'
import { TransactionAwaitingRecovery } from '../execution/transaction-executor.ts'
import type { OperationPlan } from '../operations/types.ts'
import { recordActivity, saveDurableState, type RuntimeState } from '../state/operator-state.ts'
import type { ConfigurationState } from './dashboard-controller.ts'

export function schedulerFor(configuration: ConfigurationState, state: RuntimeState) {
	return createChaosScheduler({
		persist: async candidate => {
			await saveDurableState(configuration.settings.runtime.stateFile, {
				...state,
				scheduler: candidate,
			})
		},
		settings: configuration.settings.scheduler,
		state: state.scheduler,
	})
}

export function recordDryRun(state: RuntimeState, plan: OperationPlan) {
	recordActivity(state, {
		ecosystem: plan.ecosystem,
		message: `Dry-run selection: ${plan.label}`,
		operationId: plan.definitionId,
		status: 'dry-run',
		summary: `${plan.steps.length.toString()} step${plan.steps.length === 1 ? '' : 's'}; ${plan.risk} risk; no transaction signed`,
		type: 'operation',
	})
}

export async function executeScheduledOperation(configuration: ConfigurationState, state: RuntimeState, plan: OperationPlan, execute: () => Promise<void>, recover: (error: unknown) => boolean, trigger: 'scheduled' | 'manual' = 'scheduled') {
	if (trigger === 'manual' && (state.paused || configuration.settings.paused)) throw new Error('Chaos bot is paused')
	const scheduler = schedulerFor(configuration, state)
	await scheduler.begin(plan.definitionId, trigger)
	if (!configuration.settings.runtime.execute) {
		recordDryRun(state, plan)
		await scheduler.complete(plan.definitionId)
		return
	}
	try {
		await execute()
		await scheduler.complete(plan.definitionId)
	} catch (error) {
		if (error instanceof TransactionAwaitingRecovery) throw error
		const recovered = recover(error)
		await scheduler.complete(plan.definitionId)
		if (!recovered) throw error
	}
}
