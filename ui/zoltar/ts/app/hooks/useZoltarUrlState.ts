import { useSignal } from '@preact/signals'
import { useCallback, useEffect } from 'preact/hooks'
import { buildRouteHref, getCurrentRouteHash, getRouteHashSearch, getTopLevelRouteSearch } from '@zoltar/ui-core-shared/lib/routing.js'
import { readUniverseQueryParam, readZoltarViewQueryParam, writeUniverseQueryParam, writeZoltarViewQueryParam } from '@zoltar/ui-core-shared/lib/urlParams.js'

type ZoltarUrlState = {
	activeUniverseId: bigint
	zoltarView: string
}

function readZoltarUrlState(search: string): ZoltarUrlState {
	return {
		activeUniverseId: readUniverseQueryParam(search) ?? 0n,
		zoltarView: readZoltarViewQueryParam(search) ?? '',
	}
}

function getZoltarSearch(search = getRouteHashSearch()) {
	const filteredSearch = getTopLevelRouteSearch('zoltar', search)
	const universeId = readUniverseQueryParam(search)
	const zoltarView = readZoltarViewQueryParam(search)
	return writeZoltarViewQueryParam(writeUniverseQueryParam(filteredSearch, universeId), zoltarView)
}

function readCurrentZoltarUrlState() {
	return readZoltarUrlState(getZoltarSearch())
}

export function useZoltarUrlState() {
	const urlState = useSignal<ZoltarUrlState>(readCurrentZoltarUrlState())

	useEffect(() => {
		const syncUrlState = () => {
			const zoltarSearch = getZoltarSearch()
			if (zoltarSearch !== getRouteHashSearch()) window.history.replaceState({}, '', buildRouteHref(getCurrentRouteHash(), zoltarSearch))
			urlState.value = readZoltarUrlState(zoltarSearch)
		}
		syncUrlState()
		window.addEventListener('hashchange', syncUrlState)
		window.addEventListener('popstate', syncUrlState)
		return () => {
			window.removeEventListener('hashchange', syncUrlState)
			window.removeEventListener('popstate', syncUrlState)
		}
	}, [])

	const applyUrlStateUpdate = useCallback((nextSearch: string, historyMode: 'push' | 'replace' = 'push') => {
		const currentSearch = getRouteHashSearch()
		if (nextSearch !== currentSearch) {
			const nextHref = buildRouteHref(getCurrentRouteHash(), nextSearch)
			if (historyMode === 'replace') window.history.replaceState({}, '', nextHref)
			else window.history.pushState({}, '', nextHref)
		}
		urlState.value = readZoltarUrlState(nextSearch)
	}, [])

	const setActiveUniverseId = useCallback(
		(universeId: bigint | undefined) => {
			applyUrlStateUpdate(writeUniverseQueryParam(getZoltarSearch(), universeId))
		},
		[applyUrlStateUpdate],
	)

	const setZoltarView = useCallback(
		(view: string | undefined) => {
			applyUrlStateUpdate(writeZoltarViewQueryParam(getZoltarSearch(), view === '' ? undefined : view))
		},
		[applyUrlStateUpdate],
	)
	const replaceZoltarView = useCallback(
		(view: string | undefined) => {
			applyUrlStateUpdate(writeZoltarViewQueryParam(getZoltarSearch(), view === '' ? undefined : view), 'replace')
		},
		[applyUrlStateUpdate],
	)

	return {
		activeUniverseId: urlState.value.activeUniverseId,
		zoltarView: urlState.value.zoltarView,
		replaceZoltarView,
		setActiveUniverseId,
		setZoltarView,
	}
}
