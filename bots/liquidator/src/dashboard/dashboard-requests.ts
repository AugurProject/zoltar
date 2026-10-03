import { requestJson, requestWithTimeout } from '@zoltar/bot-shared/dashboard/polling'

/** Name of the error `api` throws when the bot answered with a failure status. */
export const REQUEST_REJECTED = 'DashboardRequestRejected'
/** Name of the error `api` throws when the bot answered with a body that is not the JSON the dashboard expects. */
export const INVALID_RESPONSE = 'DashboardInvalidResponse'

/** Sends the request and decodes its JSON body; with a timeout the shared helper bounds the body read as well as the headers. */
async function send(path: string, options: RequestInit | undefined, timeoutMilliseconds: number | undefined) {
	try {
		if (timeoutMilliseconds !== undefined) return await requestJson(path, timeoutMilliseconds, options)
		const response = await fetch(path, options)
		const value: unknown = await response.json()
		return { response, value }
	} catch (error) {
		if (error instanceof SyntaxError) throw Object.assign(new Error('The bot answered without a JSON body'), { name: INVALID_RESPONSE })
		throw error
	}
}

/**
 * Sends a dashboard API request and returns the decoded JSON body; a rejected request throws the bot's public error
 * message. The timeout covers reading the body as well as the response headers.
 */
export async function api(path: string, options?: RequestInit, timeoutMilliseconds?: number): Promise<unknown> {
	const { response, value } = await send(path, options, timeoutMilliseconds)
	if (!response.ok) {
		const error = typeof value === 'object' && value !== null ? Reflect.get(value, 'error') : undefined
		const message = typeof error === 'string' ? error : `Request failed with HTTP ${response.status.toString()}`
		throw Object.assign(new Error(message), { name: REQUEST_REJECTED })
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
