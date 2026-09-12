import type { DurableState } from './operator-state.ts'

export function isPristineBootstrapState(state: DurableState) {
	const schedulerIsPristine = (state.scheduler.status === 'idle' || state.scheduler.status === 'paused') && state.scheduler.lastDelaySeconds === undefined && state.scheduler.lastRunAt === undefined && state.scheduler.nextRunAt === undefined && state.scheduler.selectedOperationId === undefined
	return (
		state.signerAddress === undefined &&
		state.activities.length === 0 &&
		state.lifecyclePresenceBlocker === undefined &&
		state.obligationTombstones.length === 0 &&
		state.obligations.length === 0 &&
		state.pendingTransactions.length === 0 &&
		state.protocolIndex === undefined &&
		state.retirement.status === 'inactive' &&
		state.retirement.positions.length === 0 &&
		!state.safetyPaused &&
		schedulerIsPristine &&
		state.workflows.length === 0
	)
}
