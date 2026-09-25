import { useEffect, useRef, useState } from 'preact/hooks'
import { appBlockWatcher } from '../lib/dataRefresh.js'
import type { BlockWatcherEvent } from '../lib/blockWatcher.js'
import type { QueryState, QueryStore } from '../lib/queryCache.js'

function isPageHidden() {
	return typeof document !== 'undefined' && document.hidden
}

/** Tracks whether the page is visible, so clocks and polls can pause in a background tab. */
export function usePageVisible() {
	const [visible, setVisible] = useState(() => !isPageHidden())
	useEffect(() => {
		const update = () => setVisible(!isPageHidden())
		update()
		document.addEventListener('visibilitychange', update)
		return () => document.removeEventListener('visibilitychange', update)
	}, [])
	return visible
}

/** Runs the latest callback on every new block and every explicit invalidation while enabled. */
export function useBlockRefresh(onRefresh: (event: BlockWatcherEvent) => void, enabled = true) {
	const callback = useRef(onRefresh)
	callback.current = onRefresh
	useEffect(() => {
		if (!enabled) return
		return appBlockWatcher.subscribe(event => callback.current(event))
	}, [enabled])
}

/** Re-renders when the cached query for the key changes and returns its current state. */
export function useQueryState<T>(store: QueryStore<T>, key: string | undefined): QueryState<T> | undefined {
	const [, setVersion] = useState(0)
	useEffect(() => {
		if (key === undefined) return
		return store.subscribe(key, () => setVersion(version => version + 1))
	}, [store, key])
	return key === undefined ? undefined : store.get(key)
}
