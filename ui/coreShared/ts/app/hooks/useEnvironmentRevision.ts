import { batch, useSignal } from '@preact/signals'
import { useCallback, useRef } from 'preact/hooks'

export function useEnvironmentRevision(onReset?: () => void) {
	const revision = useSignal(0)
	const reset = useRef(onReset)
	reset.current = onReset
	const setRevision = useCallback(
		(update: number | ((current: number) => number)) => {
			batch(() => {
				reset.current?.()
				revision.value = typeof update === 'function' ? update(revision.peek()) : update
			})
		},
		[revision],
	)
	return { revision, setRevision }
}
