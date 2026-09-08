import type { SchedulerState } from './operator-state.ts'

export function serializedScheduler(scheduler: SchedulerState) {
	return {
		lastDelaySeconds: scheduler.lastDelaySeconds ?? null,
		lastRunAt: scheduler.lastRunAt ?? null,
		nextRunAt: scheduler.nextRunAt ?? null,
		selectedOperationId: scheduler.selectedOperationId ?? null,
		status: scheduler.status,
	}
}
