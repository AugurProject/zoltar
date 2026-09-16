import { useEffect, useRef } from 'preact/hooks'

/**
 * Moves focus to the referenced element when `key` changes to a new defined value after mount.
 * With `focusOnFirstKey` false the first defined key (for example the initially discovered market) is not focused.
 */
export function useFocusOnKeyChange<T extends HTMLElement>(key: string | undefined, focusOnFirstKey = true) {
	const ref = useRef<T>(null)
	const previousKey = useRef(key)
	useEffect(() => {
		const previous = previousKey.current
		previousKey.current = key
		if (key === undefined || key === previous) return
		if (previous === undefined && !focusOnFirstKey) return
		ref.current?.focus({ preventScroll: true })
	}, [focusOnFirstKey, key])
	return ref
}
