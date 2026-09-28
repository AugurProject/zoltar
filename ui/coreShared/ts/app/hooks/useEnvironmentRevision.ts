import { batch, useSignal } from '@preact/signals'
import { useCallback, useRef } from 'preact/hooks'
import { appQueryCache } from '../../lib/dataRefresh.js'

export function useEnvironmentRevision(onReset?: () => void) {
	const revision = useSignal(0)
	const reset = useRef(onReset)
	reset.current = onReset
	const setRevision = useCallback(
		(update: number | ((current: number) => number)) => {
			batch(() => {
				reset.current?.()
				// Cached reads describe the replaced environment.
				appQueryCache.clear()
				revision.value = typeof update === 'function' ? update(revision.peek()) : update
			})
		},
		[revision],
	)
	return { revision, setRevision }
}
