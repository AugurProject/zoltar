import { useCallback, useEffect, useRef } from 'preact/hooks'

export type RequestIdentity = Readonly<{ request: symbol }>

export function createLatestRequestGuard() {
	let current = Symbol('initial request')
	return {
		begin(): RequestIdentity {
			current = Symbol('active request')
			return { request: current }
		},
		invalidate() {
			current = Symbol('invalidated request')
		},
		isCurrent(identity: RequestIdentity) {
			return identity.request === current
		},
	}
}

export function createExclusiveWorkflowGuard() {
	let active = false
	return {
		begin() {
			if (active) return false
			active = true
			return true
		},
		finish() {
			active = false
		},
		isActive() {
			return active
		},
	}
}

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
	const requestId = useRef(0)
	useEffect(
		() => () => {
			requestId.current += 1
		},
		[],
	)
	return useCallback(() => {
		const id = requestId.current + 1
		requestId.current = id
		return () => requestId.current === id
	}, [])
}
