import { useSignal } from '@preact/signals'
import { useCallback, useEffect, useRef } from 'preact/hooks'
import { pushHistoryUrl, replaceHistoryUrl, subscribeToLocationChanges } from '../../navigation/historyEntries.js'
import { buildRouteHref, getCurrentRouteHash, getRouteHashSearch, parseRouteHash } from '../../navigation/routing.js'

export type UrlHistoryMode = 'push' | 'replace'

const identitySearch = (search: string) => search

type UseUrlSearchStateOptions = {
	/** Narrows the route-hash search to the parameters this state owns; when it changes the URL, the URL is rewritten without a history entry. */
	normalizeSearch?: (search: string) => string
	/** Maps an outdated route hash, such as a legacy link, to its current form; the URL is rewritten in place before it is read. */
	mapLegacyHash?: (hash: string) => string | undefined
}

/**
 * Keeps a parsed view of the route-hash search in sync with browser navigation and exposes a single
 * writer that applications wrap with typed setters for their own query parameters.
 */
export function useUrlSearchState<TState>(readState: (search: string, routeHash: string) => TState, { mapLegacyHash, normalizeSearch = identitySearch }: UseUrlSearchStateOptions = {}) {
	// The readers are held in refs so inline callbacks cannot retrigger the navigation subscription on every render.
	const readStateRef = useRef(readState)
	readStateRef.current = readState
	const normalizeSearchRef = useRef(normalizeSearch)
	normalizeSearchRef.current = normalizeSearch
	const mapLegacyHashRef = useRef(mapLegacyHash)
	mapLegacyHashRef.current = mapLegacyHash
	const getOwnedSearch = useCallback(() => normalizeSearchRef.current(getRouteHashSearch()), [])
	const readInitialState = () => {
		// Until the first sync rewrites a legacy URL, read the location it maps to.
		const legacyHash = mapLegacyHash?.(window.location.hash)
		if (legacyHash === undefined) return readState(getOwnedSearch(), getCurrentRouteHash())
		const { routeHash, search } = parseRouteHash(legacyHash)
		return readState(normalizeSearch(search), routeHash)
	}
	const urlState = useSignal<TState>(readInitialState())

	useEffect(() => {
		const syncUrlState = () => {
			const legacyHash = mapLegacyHashRef.current?.(window.location.hash)
			if (legacyHash !== undefined) replaceHistoryUrl(legacyHash)
			const ownedSearch = getOwnedSearch()
			if (ownedSearch !== getRouteHashSearch()) replaceHistoryUrl(buildRouteHref(getCurrentRouteHash(), ownedSearch))
			urlState.value = readStateRef.current(ownedSearch, getCurrentRouteHash())
		}
		syncUrlState()
		// The route follows the same notifications, so a change of both path and search renders once.
		return subscribeToLocationChanges(syncUrlState)
	}, [getOwnedSearch, urlState])

	const navigate = useCallback(
		(nextRouteHash: string, nextSearch: string, historyMode: UrlHistoryMode = 'push') => {
			const currentRouteHash = getCurrentRouteHash()
			if (nextRouteHash !== currentRouteHash || nextSearch !== getRouteHashSearch()) {
				const nextHref = buildRouteHref(nextRouteHash, nextSearch)
				if (historyMode === 'replace') replaceHistoryUrl(nextHref)
				else pushHistoryUrl(nextHref)
				// History writes do not fire hashchange; the route signal still has to observe a path change.
				if (nextRouteHash !== currentRouteHash) window.dispatchEvent(new Event('hashchange'))
			}
			urlState.value = readStateRef.current(nextSearch, nextRouteHash)
		},
		[urlState],
	)
	const applyUrlStateUpdate = useCallback((nextSearch: string, historyMode: UrlHistoryMode = 'push') => navigate(getCurrentRouteHash(), nextSearch, historyMode), [navigate])

	return { applyUrlStateUpdate, getOwnedSearch, navigate, state: urlState.value }
}
