import { requestWithTimeout } from '@zoltar/bot-shared/dashboard/polling'
import { optionalRecord as record } from '@zoltar/bot-shared/infrastructure/json-validation'
import { stringValue } from './dashboard-data.ts'

/** Settings mutations validate and persist on the server, so they get longer than the shared read timeouts. */
const mutationRequestTimeoutMilliseconds = 5_000

export async function requestJson(path: string, timeoutMilliseconds: number, init?: RequestInit) {
	let response: Response
	let value: unknown
	try {
		const result = await requestWithTimeout(
			async signal => {
				const response = await fetch(path, { ...init, headers: { accept: 'application/json', ...init?.headers }, signal })
				const value: unknown = await response.json()
				return { response, value }
			},
			timeoutMilliseconds,
			'Dashboard request timed out',
		)
		response = result.response
		value = result.value
	} catch (error) {
		if (init?.method !== 'PUT') throw error
		const timedOut = error instanceof Error && (error.name === 'AbortError' || error.message === 'Dashboard request timed out')
		const unknown = new Error(timedOut ? 'The mutation timed out and may have committed.' : 'The mutation response was lost and the change may have committed.')
		unknown.name = 'MutationOutcomeUnknown'
		throw unknown
	}
	if (!response.ok) {
		const responseRecord = record(value)
		const message = stringValue(responseRecord?.['error'])
		const error = new Error(message ?? 'Dashboard request failed')
		if (response.status === 409 && responseRecord?.['code'] === 'configuration_revision_conflict') error.name = 'ConfigurationRevisionConflict'
		if (responseRecord?.['code'] === 'configuration_committed_safely_paused') error.name = 'MutationOutcomeUnknown'
		if (responseRecord?.['code'] === 'configuration_commit_indeterminate') error.name = 'ConfigurationCommitIndeterminate'
		throw error
	}
	return value
}

let mutationsInFlight = 0
let settledMutationCount = 0
let mutationWaiters: (() => void)[] = []

/** Longest a refresh waits for this page's mutations; past it the read goes out so a hung mutation still surfaces as stale state. */
const MUTATION_SETTLE_WAIT_MILLISECONDS = 30_000

/**
 * Resolves once none of this page's mutations is in flight, or after `maximumWaitMilliseconds`. The server answers state
 * and configuration reads only after its mutation queue drains, so a read sent during a long mutation would exceed the
 * short read timeout and report a healthy bot as unavailable. The wait is bounded so a mutation that never answers
 * cannot stop state polling.
 */
export function mutationsSettled(maximumWaitMilliseconds = MUTATION_SETTLE_WAIT_MILLISECONDS) {
	if (mutationsInFlight === 0) return Promise.resolve()
	let settle: () => void = () => undefined
	const settled = new Promise<void>(resolve => {
		settle = resolve
	})
	const timeout = setTimeout(settle, maximumWaitMilliseconds)
	mutationWaiters.push(() => {
		clearTimeout(timeout)
		settle()
	})
	return settled
}

/** Counts this page's settled mutations, so a refresh can tell that its read began before one of them finished. */
export function settledMutations() {
	return settledMutationCount
}

function sendPut(path: string, value: unknown, timeoutMilliseconds: number) {
	const body = JSON.stringify(value)
	if (body === undefined) throw new Error('Dashboard mutation body is not serializable')
	return requestJson(path, timeoutMilliseconds, {
		body,
		headers: { 'content-type': 'application/json' },
		method: 'PUT',
	})
}

export async function put(path: string, value: unknown, timeoutMilliseconds = mutationRequestTimeoutMilliseconds) {
	mutationsInFlight += 1
	try {
		return await sendPut(path, value, timeoutMilliseconds)
	} finally {
		mutationsInFlight -= 1
		settledMutationCount += 1
		if (mutationsInFlight === 0) {
			const waiters = mutationWaiters
			mutationWaiters = []
			for (const resolve of waiters) resolve()
		}
	}
}

/**
 * A request that changes nothing but travels as a PUT, such as the operation dialog's status poll. It is not counted as
 * a mutation, so it neither defers state refreshes nor makes one rerun.
 */
export async function readThroughPut(path: string, value: unknown, timeoutMilliseconds: number) {
	return await sendPut(path, value, timeoutMilliseconds)
}

export type DashboardPut = typeof put
