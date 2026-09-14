/** Walk object causes once, stopping at primitives or cycles. */
export function* errorChain(error: unknown): Generator<object, void, unknown> {
	const seen = new Set<object>()
	let current = error
	while (typeof current === 'object' && current !== null && !seen.has(current)) {
		seen.add(current)
		yield current
		current = 'cause' in current ? current.cause : undefined
	}
}
