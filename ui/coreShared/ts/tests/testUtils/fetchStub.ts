type FetchArguments = Parameters<typeof fetch>
type FetchHandler = (input: FetchArguments[0], init?: FetchArguments[1]) => Promise<Response>

// Replaces global fetch for one test and returns the restore function. The stub keeps the real preconnect
// so the replacement satisfies the full fetch type without a cast.
export function installFetchStub(handler: FetchHandler) {
	const originalFetch = globalThis.fetch
	globalThis.fetch = Object.assign(async (input: FetchArguments[0], init?: FetchArguments[1]) => handler(input, init), { preconnect: originalFetch.preconnect })
	return () => {
		globalThis.fetch = originalFetch
	}
}
