import { useCallback } from 'preact/hooks'
import { useUrlSearchState, type UrlHistoryMode } from '@zoltar/ui-core-shared/app/hooks/useUrlSearchState.js'
import { getTopLevelRouteSearch } from '@zoltar/ui-core-shared/navigation/routing.js'
import { readUniverseQueryParam, readZoltarViewQueryParam, writeUniverseQueryParam, writeZoltarViewQueryParam } from '@zoltar/ui-core-shared/navigation/urlParams.js'

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

/** Drops query parameters owned by other products while keeping the shared environment parameters. */
function getZoltarSearch(search: string) {
	const filteredSearch = getTopLevelRouteSearch('zoltar', search)
	const universeId = readUniverseQueryParam(search)
	const zoltarView = readZoltarViewQueryParam(search)
	return writeZoltarViewQueryParam(writeUniverseQueryParam(filteredSearch, universeId), zoltarView)
}

export function useZoltarUrlState() {
	const { applyUrlStateUpdate, getOwnedSearch, state } = useUrlSearchState(readZoltarUrlState, { normalizeSearch: getZoltarSearch })

	const setActiveUniverseId = useCallback(
		(universeId: bigint | undefined) => {
			applyUrlStateUpdate(writeUniverseQueryParam(getOwnedSearch(), universeId))
		},
		[applyUrlStateUpdate, getOwnedSearch],
	)
	const updateZoltarView = useCallback(
		(view: string | undefined, historyMode: UrlHistoryMode) => {
			applyUrlStateUpdate(writeZoltarViewQueryParam(getOwnedSearch(), view === '' ? undefined : view), historyMode)
		},
		[applyUrlStateUpdate, getOwnedSearch],
	)
	const setZoltarView = useCallback((view: string | undefined) => updateZoltarView(view, 'push'), [updateZoltarView])
	const replaceZoltarView = useCallback((view: string | undefined) => updateZoltarView(view, 'replace'), [updateZoltarView])

	return {
		activeUniverseId: state.activeUniverseId,
		zoltarView: state.zoltarView,
		replaceZoltarView,
		setActiveUniverseId,
		setZoltarView,
	}
}
