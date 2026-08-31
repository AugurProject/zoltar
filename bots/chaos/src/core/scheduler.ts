import type { SchedulerSettings } from '#config/settings'
import { randomDelaySeconds, type RandomIntegerSource } from '#core/random'
import type { SchedulerState } from '#state/operator-state'

export type SchedulerClock = () => number
export type SchedulerPersistence = (state: SchedulerState) => Promise<void>

export type ChaosSchedulerOptions = {
	clock?: SchedulerClock | undefined
	persist: SchedulerPersistence
	random?: RandomIntegerSource | undefined
	settings: SchedulerSettings
	state: SchedulerState
}

function timestampMilliseconds(value: string | undefined, label: string) {
	if (value === undefined) return undefined
	const parsed = Date.parse(value)
	if (!Number.isFinite(parsed)) throw new Error(`${label} is not a valid timestamp`)
	return parsed
}

function currentMilliseconds(clock: SchedulerClock) {
	const value = clock()
	if (!Number.isSafeInteger(value) || value < 0) throw new Error('Scheduler clock must return non-negative integer milliseconds')
	return value
}

function cloneSchedulerState(state: SchedulerState): SchedulerState {
	return { ...state }
}

function replaceSchedulerState(target: SchedulerState, source: SchedulerState) {
	target.lastDelaySeconds = source.lastDelaySeconds
	target.lastRunAt = source.lastRunAt
	target.nextRunAt = source.nextRunAt
	target.selectedOperationId = source.selectedOperationId
	target.status = source.status
}

export function schedulerIsDue(state: Pick<SchedulerState, 'nextRunAt' | 'status'>, nowMilliseconds = Date.now()) {
	if (state.status === 'paused' || state.status === 'running' || state.nextRunAt === undefined) return false
	const nextRunAt = timestampMilliseconds(state.nextRunAt, 'Scheduler next run')
	return nextRunAt !== undefined && nextRunAt <= nowMilliseconds
}

export function schedulerWaitMilliseconds(state: Pick<SchedulerState, 'nextRunAt'>, nowMilliseconds = Date.now()) {
	const nextRunAt = timestampMilliseconds(state.nextRunAt, 'Scheduler next run')
	if (nextRunAt === undefined) return undefined
	return Math.max(0, nextRunAt - nowMilliseconds)
}

export function scheduledStateAfterRun(state: SchedulerState, settings: SchedulerSettings, nowMilliseconds: number, operationId: string | undefined, source?: RandomIntegerSource): SchedulerState {
	const delay = randomDelaySeconds(settings.minimumDelaySeconds, settings.maximumDelaySeconds, state.lastDelaySeconds, source)
	return {
		lastDelaySeconds: delay,
		lastRunAt: new Date(nowMilliseconds).toISOString(),
		nextRunAt: new Date(nowMilliseconds + delay * 1_000).toISOString(),
		selectedOperationId: operationId,
		status: 'scheduled',
	}
}

export function createChaosScheduler(options: ChaosSchedulerOptions) {
	const clock = options.clock ?? Date.now
	const persistAndCommit = async (next: SchedulerState) => {
		await options.persist(next)
		replaceSchedulerState(options.state, next)
		return cloneSchedulerState(next)
	}
	return {
		snapshot: () => cloneSchedulerState(options.state),
		isDue: () => schedulerIsDue(options.state, currentMilliseconds(clock)),
		waitMilliseconds: () => schedulerWaitMilliseconds(options.state, currentMilliseconds(clock)),
		async ensureScheduled() {
			if (options.state.nextRunAt !== undefined) {
				if (options.state.status === 'paused' || options.state.status === 'running') return cloneSchedulerState(options.state)
				const next = cloneSchedulerState(options.state)
				next.status = schedulerIsDue(next, currentMilliseconds(clock)) ? 'due' : 'scheduled'
				if (next.status === options.state.status) return next
				return await persistAndCommit(next)
			}
			const now = currentMilliseconds(clock)
			const next = scheduledStateAfterRun(options.state, options.settings, now, undefined, options.random)
			next.lastRunAt = options.state.lastRunAt
			return await persistAndCommit(next)
		},
		async markDue() {
			if (!schedulerIsDue(options.state, currentMilliseconds(clock))) return cloneSchedulerState(options.state)
			return await persistAndCommit({ ...options.state, status: 'due' })
		},
		async begin(operationId: string) {
			if (operationId.trim() === '') throw new Error('A scheduler operation ID is required')
			if (!schedulerIsDue(options.state, currentMilliseconds(clock)) && options.state.status !== 'due') throw new Error('Chaos scheduler is not due')
			return await persistAndCommit({ ...options.state, selectedOperationId: operationId, status: 'running' })
		},
		async complete(operationId?: string) {
			const selectedOperationId = operationId ?? options.state.selectedOperationId
			return await persistAndCommit(scheduledStateAfterRun(options.state, options.settings, currentMilliseconds(clock), selectedOperationId, options.random))
		},
		async pause() {
			return await persistAndCommit({ ...options.state, status: 'paused' })
		},
		async resume() {
			if (options.state.status !== 'paused') return cloneSchedulerState(options.state)
			if (options.state.nextRunAt === undefined) {
				const now = currentMilliseconds(clock)
				const next = scheduledStateAfterRun(options.state, options.settings, now, undefined, options.random)
				next.lastRunAt = options.state.lastRunAt
				return await persistAndCommit(next)
			}
			return await persistAndCommit({ ...options.state, status: schedulerIsDue({ ...options.state, status: 'scheduled' }, currentMilliseconds(clock)) ? 'due' : 'scheduled' })
		},
	}
}

export type ChaosScheduler = ReturnType<typeof createChaosScheduler>
