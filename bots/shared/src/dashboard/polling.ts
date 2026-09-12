export const STATE_REQUEST_TIMEOUT_MS = 1_000
export const CONFIGURATION_REQUEST_TIMEOUT_MS = 2_000
export const PROFILE_SWITCH_REQUEST_TIMEOUT_MS = 2_000
export const PROFILE_SWITCH_REQUEST_TIMEOUT_MESSAGE = 'Profile switch request timed out.'

export function singleFlight<T>(operation: () => Promise<T>) {
	let inFlight: Promise<T> | undefined
	let rerunRequested = false
	return () => {
		if (inFlight !== undefined) {
			rerunRequested = true
			return inFlight
		}
		inFlight = (async () => {
			rerunRequested = false
			let result = await operation()
			while (rerunRequested) {
				rerunRequested = false
				result = await operation()
			}
			return result
		})().finally(() => {
			inFlight = undefined
		})
		return inFlight
	}
}

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
