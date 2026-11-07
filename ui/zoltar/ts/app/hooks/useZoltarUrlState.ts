import { useCallback } from 'preact/hooks'
import { useUrlSearchState, type UrlHistoryMode } from '@zoltar/ui-core-shared/app/hooks/useUrlSearchState.js'
import { getTopLevelRouteSearch } from '@zoltar/ui-core-shared/navigation/routing.js'
import { hasInvalidUniverseQueryParam, readStringQueryParam, readUniverseQueryParam, readZoltarViewQueryParam, setOrDeleteSearchParam, updateSearchParams, writeUniverseQueryParam, writeZoltarViewQueryParam } from '@zoltar/ui-core-shared/navigation/urlParams.js'

/** The question chosen to fork the selected universe, kept as typed so the fork page can explain an invalid ID. */
const FORK_QUESTION_QUERY_PARAM = 'forkQuestion'

type ZoltarUrlState = {
	activeUniverseId: bigint
	forkQuestionId: string
	zoltarView: string
}

function readForkQuestionQueryParam(search: string) {
	return readStringQueryParam(search, FORK_QUESTION_QUERY_PARAM)
}

function writeForkQuestionQueryParam(search: string, questionId: string | undefined) {
	return updateSearchParams(search, params => setOrDeleteSearchParam(params, FORK_QUESTION_QUERY_PARAM, questionId))
}

function readZoltarUrlState(search: string): ZoltarUrlState {
	return {
		activeUniverseId: readUniverseQueryParam(search) ?? 0n,
		forkQuestionId: readForkQuestionQueryParam(search) ?? '',
		zoltarView: readZoltarViewQueryParam(search) ?? '',
	}
}

/**
 * Drops query parameters owned by other products while keeping the shared environment parameters. A malformed
 * universe is kept as written so route validation shows not-found instead of silently opening Genesis.
 */
function getZoltarSearch(search: string) {
	const filteredSearch = getTopLevelRouteSearch('zoltar', search)
	const zoltarView = readZoltarViewQueryParam(search)
	const universeSearch = hasInvalidUniverseQueryParam(search) ? filteredSearch : writeUniverseQueryParam(filteredSearch, readUniverseQueryParam(search))
	return writeForkQuestionQueryParam(writeZoltarViewQueryParam(universeSearch, zoltarView), readForkQuestionQueryParam(search))
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
	// The fork question follows the user across views and reloads; editing it replaces the entry instead of adding one per keystroke.
	const setForkQuestionId = useCallback(
		(questionId: string) => {
			applyUrlStateUpdate(writeForkQuestionQueryParam(getOwnedSearch(), questionId), 'replace')
		},
		[applyUrlStateUpdate, getOwnedSearch],
	)

	return {
		activeUniverseId: state.activeUniverseId,
		forkQuestionId: state.forkQuestionId,
		zoltarView: state.zoltarView,
		replaceZoltarView,
		setActiveUniverseId,
		setForkQuestionId,
		setZoltarView,
	}
}
