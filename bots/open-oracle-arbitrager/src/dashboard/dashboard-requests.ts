/** Sends a dashboard API request and returns the decoded JSON body, surfacing the bot's error message on failure. */
export async function api(path: string, init?: RequestInit) {
	const response = await fetch(path, init)
	let value: unknown
	try {
		value = await response.json()
	} catch (error) {
		// A proxy error page or a plain-text refusal has no JSON body; the status is the only reliable detail.
		if (!response.ok) throw new Error(`Request failed with status ${response.status.toString()}`)
		throw error
	}
	if (!response.ok) {
		if (typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string') throw new Error(value.error)
		throw new Error(`Request failed with status ${response.status.toString()}`)
	}
	return value
}

/** Sends `body` as JSON with the given method. */
export async function sendJson(path: string, method: 'POST' | 'PUT', body: unknown) {
	return await api(path, { body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, method })
}
