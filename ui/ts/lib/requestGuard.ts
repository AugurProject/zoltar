import { useSignal } from '@preact/signals'

/**
 * Returns a function that, when called, marks a new request as current
 * and returns an `isCurrent` predicate. Use this to discard stale async results.
 *
 * const nextLoad = useRequestGuard()
 * const load = async () => {
 *   const isCurrent = nextLoad()
 *   const data = await fetch()
 *   if (!isCurrent()) return
 *   state.value = data
 * }
 */
export function useRequestGuard() {
	const requestId = useSignal(0)
	return () => {
		const id = requestId.value + 1
		requestId.value = id
		return () => requestId.value === id
	}
}
