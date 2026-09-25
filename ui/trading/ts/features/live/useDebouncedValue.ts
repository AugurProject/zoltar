import { useEffect, useState } from 'preact/hooks'

/** The value once it has stopped changing for `delayMilliseconds`; an empty string settles immediately so a cleared field clears its estimate at once. */
export function useDebouncedValue(value: string, delayMilliseconds: number) {
	const [settled, setSettled] = useState(value)
	useEffect(() => {
		if (value === '') {
			setSettled(value)
			return
		}
		const timer = setTimeout(() => setSettled(value), delayMilliseconds)
		return () => clearTimeout(timer)
	}, [value, delayMilliseconds])
	return settled
}
