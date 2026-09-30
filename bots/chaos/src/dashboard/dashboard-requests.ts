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

export async function put(path: string, value: unknown, timeoutMilliseconds = mutationRequestTimeoutMilliseconds) {
	const body = JSON.stringify(value)
	if (body === undefined) throw new Error('Dashboard mutation body is not serializable')
	return await requestJson(path, timeoutMilliseconds, {
		body,
		headers: { 'content-type': 'application/json' },
		method: 'PUT',
	})
}

export type DashboardPut = typeof put
