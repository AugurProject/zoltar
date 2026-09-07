export async function requestWithTimeout<T>(request: (signal: AbortSignal) => Promise<T>, timeoutMilliseconds: number, timeoutMessage = 'Dashboard state request timed out') {
	const controller = new AbortController()
	let timeout: ReturnType<typeof setTimeout> | undefined
	const deadline = new Promise<never>((_resolve, reject) => {
		timeout = setTimeout(() => {
			reject(new Error(timeoutMessage))
			controller.abort()
		}, timeoutMilliseconds)
	})
	try {
		return await Promise.race([request(controller.signal), deadline])
	} finally {
		if (timeout !== undefined) clearTimeout(timeout)
	}
}

// An optional transport deadline covers response headers only. Wrap fetchJson in
// requestWithTimeout at call sites that also need to bound JSON body consumption.
export async function fetchJson(path: string, init?: RequestInit, timeoutMilliseconds?: number) {
	const response = await (timeoutMilliseconds === undefined ? fetch(path, init) : requestWithTimeout(signal => fetch(path, { ...init, signal }), timeoutMilliseconds))
	const value: unknown = await response.json()
	return { response, value }
}

export function responseError(value: unknown) {
	const error = typeof value === 'object' && value !== null ? Reflect.get(value, 'error') : undefined
	return typeof error === 'string' ? error : undefined
}
