import { requestWithTimeout } from '@zoltar/bot-shared/dashboard/polling'

/** Sends a dashboard API request and returns the decoded JSON body; a rejected request throws the bot's public error message. */
export async function api(path: string, options?: RequestInit, timeoutMilliseconds?: number): Promise<unknown> {
	const response = await (timeoutMilliseconds === undefined ? fetch(path, options) : requestWithTimeout(signal => fetch(path, { ...options, signal }), timeoutMilliseconds))
	const value: unknown = await response.json()
	if (!response.ok) {
		const error = typeof value === 'object' && value !== null ? Reflect.get(value, 'error') : undefined
		const message = typeof error === 'string' ? error : `Request failed with HTTP ${response.status.toString()}`
		throw Object.assign(new Error(message), { name: 'DashboardRequestRejected' })
	}
	return value
}

/** Sends `value` as a JSON PUT body, optionally bounded by a timeout that rejects with `timeoutMessage`. */
export function put(path: string, value: unknown, timeoutMilliseconds?: number, timeoutMessage?: string) {
	const body = JSON.stringify(value)
	if (body === undefined) throw new Error('Request body is not JSON serializable')
	const options = { body, headers: { 'content-type': 'application/json' }, method: 'PUT' }
	if (timeoutMilliseconds === undefined) return api(path, options)
	return requestWithTimeout(signal => api(path, { ...options, signal }), timeoutMilliseconds, timeoutMessage)
}

/** Shows a request outcome next to its control, touching the DOM only when the message or failure state changed. */
export function actionStatus(element: HTMLElement, message: string, failed = false) {
	if (element.textContent !== message) element.textContent = message
	if (element.classList.contains('error') !== failed) element.classList.toggle('error', failed)
}
