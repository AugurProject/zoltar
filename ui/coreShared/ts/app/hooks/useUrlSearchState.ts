import { useSignal } from '@preact/signals'
import { useCallback, useEffect, useRef } from 'preact/hooks'
import { buildRouteHref, getCurrentRouteHash, getRouteHashSearch } from '../../navigation/routing.js'

export type UrlHistoryMode = 'push' | 'replace'

const identitySearch = (search: string) => search

type UseUrlSearchStateOptions = {
	/** Narrows the route-hash search to the parameters this state owns; when it changes the URL, the URL is rewritten without a history entry. */
	normalizeSearch?: (search: string) => string
}

/**
 * Keeps a parsed view of the route-hash search in sync with browser navigation and exposes a single
 * writer that applications wrap with typed setters for their own query parameters.
 */
export function useUrlSearchState<TState>(readState: (search: string) => TState, { normalizeSearch = identitySearch }: UseUrlSearchStateOptions = {}) {
	// The readers are held in refs so inline callbacks cannot retrigger the navigation subscription on every render.
	const readStateRef = useRef(readState)
	readStateRef.current = readState
	const normalizeSearchRef = useRef(normalizeSearch)
	normalizeSearchRef.current = normalizeSearch
	const getOwnedSearch = useCallback(() => normalizeSearchRef.current(getRouteHashSearch()), [])
	const urlState = useSignal<TState>(readState(getOwnedSearch()))

	useEffect(() => {
		const syncUrlState = () => {
			const ownedSearch = getOwnedSearch()
			if (ownedSearch !== getRouteHashSearch()) window.history.replaceState({}, '', buildRouteHref(getCurrentRouteHash(), ownedSearch))
			urlState.value = readStateRef.current(ownedSearch)
		}
		syncUrlState()
		window.addEventListener('hashchange', syncUrlState)
		window.addEventListener('popstate', syncUrlState)
		return () => {
			window.removeEventListener('hashchange', syncUrlState)
			window.removeEventListener('popstate', syncUrlState)
		}
	}, [getOwnedSearch, urlState])

	const applyUrlStateUpdate = useCallback(
		(nextSearch: string, historyMode: UrlHistoryMode = 'push') => {
			if (nextSearch !== getRouteHashSearch()) {
				const nextHref = buildRouteHref(getCurrentRouteHash(), nextSearch)
				if (historyMode === 'replace') window.history.replaceState({}, '', nextHref)
				else window.history.pushState({}, '', nextHref)
			}
			urlState.value = readStateRef.current(nextSearch)
		},
		[urlState],
	)

	return { applyUrlStateUpdate, getOwnedSearch, state: urlState.value }
}
