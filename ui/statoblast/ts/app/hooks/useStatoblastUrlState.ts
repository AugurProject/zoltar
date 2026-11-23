import { readPoolBrowseState, readVaultSelection, writePoolBrowseState } from '@zoltar/ui-statoblast-shared/lib/statoblastLocation.js'
import type { PoolBrowseState, SelectedVaultView } from '@zoltar/ui-statoblast-shared/types/app.js'
import { useCallback } from 'preact/hooks'
import { useUrlSearchState, type UrlHistoryMode } from '@zoltar/ui-core-shared/app/hooks/useUrlSearchState.js'
import { isHexAddressInput } from '@zoltar/ui-core-shared/lib/address.js'
import { getCurrentRouteHash, getRouteHashSearch } from '@zoltar/ui-core-shared/navigation/routing.js'
import { readOpenOracleReportIdQueryParam, writeOpenOracleReportIdQueryParam } from '@zoltar/ui-core-shared/navigation/openOracleUrlParams.js'
import { readQuestionLedgerQuestionIdQueryParam, readUniverseQueryParam, updateSearchParams, setOrDeleteSearchParam, writeUniverseQueryParam } from '@zoltar/ui-core-shared/navigation/urlParams.js'
import { buildPoolsRouteHash, mapLegacyStatoblastHash, parsePoolsRouteHash, writePoolsLocationSearch, type PoolsLocation } from '@zoltar/ui-statoblast-shared/lib/statoblastLocation.js'

type StatoblastUrlState = {
	poolBrowseState: PoolBrowseState
	vaultAddress: string | undefined
	vaultView: SelectedVaultView | undefined
	activeUniverseId: bigint
	openOracleReportId: string
	questionLedgersView: string
	questionLedgerAddress: string
	questionLedgerQuestionId: string
}

const QUESTION_ID_QUERY_PARAM = 'questionId'

/** Reads the pool location from the hash path and the remaining view state from its query. */
function readStatoblastUrlState(search: string, routeHash: string): StatoblastUrlState {
	const poolsLocation = parsePoolsRouteHash(routeHash)
	return {
		poolBrowseState: readPoolBrowseState(search),
		...readVaultSelection(search),
		activeUniverseId: readUniverseQueryParam(search) ?? readUniverseQueryParam(window.location.search) ?? 0n,
		openOracleReportId: readOpenOracleReportIdQueryParam(search) ?? '',
		questionLedgersView: poolsLocation?.view ?? 'browse',
		questionLedgerAddress: poolsLocation?.view === 'operate' ? poolsLocation.questionLedgerAddress : '',
		questionLedgerQuestionId: readQuestionLedgerQuestionIdQueryParam(search) ?? '',
	}
}

export function useStatoblastUrlState() {
	// A legacy `#/security-pools` link is rewritten in place so every reader sees the path-based pool location.
	const { navigate: navigateUrl, state } = useUrlSearchState(readStatoblastUrlState, { mapLegacyHash: mapLegacyStatoblastHash })
	const updateSearch = useCallback((update: (search: string) => string, historyMode: UrlHistoryMode = 'push') => navigateUrl(getCurrentRouteHash(), update(getRouteHashSearch()), historyMode), [navigateUrl])
	const navigatePools = useCallback(
		(location: PoolsLocation, historyMode: UrlHistoryMode = 'push') => {
			const current = parsePoolsRouteHash(getCurrentRouteHash())
			const search = writePoolsLocationSearch(getRouteHashSearch(), current, location)
			navigateUrl(buildPoolsRouteHash(location), search, historyMode)
		},
		[navigateUrl],
	)

	const setPoolBrowseState = useCallback((update: Partial<PoolBrowseState>) => updateSearch(search => writePoolBrowseState(search, update), update.searchText === undefined ? 'push' : 'replace'), [updateSearch])
	const setVaultAddress = useCallback((address: string | undefined) => updateSearch(search => updateSearchParams(search, params => setOrDeleteSearchParam(params, 'vault', address)), 'replace'), [updateSearch])
	const setVaultView = useCallback(
		(view: SelectedVaultView) =>
			updateSearch(search =>
				updateSearchParams(search, params => {
					params.set('vaultView', view)
					if (view === 'selected-vault') params.delete('vault')
				}),
			),
		[updateSearch],
	)

	const setActiveUniverseId = useCallback((universeId: bigint | undefined) => updateSearch(search => writeUniverseQueryParam(search, universeId)), [updateSearch])
	// Editing keeps one history entry per editing session: moving away from a complete address pushes, and replacing a partial address replaces that entry, so Back returns to the previous pool.
	const setQuestionLedgerAddress = useCallback(
		(questionLedgerAddress: string) => {
			const current = parsePoolsRouteHash(getCurrentRouteHash())
			const currentAddress = current?.view === 'operate' ? current.questionLedgerAddress : ''
			const currentIsPartial = currentAddress !== '' && !isHexAddressInput(currentAddress)
			const nextAddress = questionLedgerAddress.trim()
			navigatePools(nextAddress === '' ? { view: 'browse' } : { questionLedgerAddress: nextAddress, view: 'operate' }, currentIsPartial ? 'replace' : 'push')
		},
		[navigatePools],
	)
	// Opening a pool in another universe moves both in one history entry, so Back returns to the previous pool and universe together.
	const openQuestionLedgerInUniverse = useCallback(
		(universeId: bigint, questionLedgerAddress: string) => {
			const nextAddress = questionLedgerAddress.trim()
			const location: PoolsLocation = nextAddress === '' ? { view: 'browse' } : { questionLedgerAddress: nextAddress, view: 'operate' }
			navigateUrl(buildPoolsRouteHash(location), writeUniverseQueryParam(writePoolsLocationSearch(getRouteHashSearch(), parsePoolsRouteHash(getCurrentRouteHash()), location), universeId))
		},
		[navigateUrl],
	)
	// Like the pool address, typing a question ID keeps one history entry: the first keystroke pushes the create view, and later edits of that entry replace it.
	const setQuestionLedgerQuestionId = useCallback(
		(questionId: string | undefined) => {
			const currentSearch = getRouteHashSearch()
			const nextSearch = updateSearchParams(currentSearch, params => setOrDeleteSearchParam(params, QUESTION_ID_QUERY_PARAM, questionId))
			const currentHash = getCurrentRouteHash()
			const editingQuestionId = parsePoolsRouteHash(currentHash)?.view === 'create' && (readQuestionLedgerQuestionIdQueryParam(currentSearch) ?? '') !== ''
			const historyMode: UrlHistoryMode = editingQuestionId ? 'replace' : 'push'
			if ((questionId?.trim() ?? '') === '') {
				navigateUrl(currentHash, nextSearch, historyMode)
				return
			}
			navigateUrl(buildPoolsRouteHash({ view: 'create' }), writePoolsLocationSearch(nextSearch, parsePoolsRouteHash(currentHash), { view: 'create' }), historyMode)
		},
		[navigateUrl],
	)
	const setOpenOracleReport = useCallback((reportId: string | undefined, historyMode: UrlHistoryMode = 'push') => updateSearch(search => writeOpenOracleReportIdQueryParam(search, reportId), historyMode), [updateSearch])
	const setQuestionLedgersView = useCallback(
		(view: string | undefined) => {
			if (view === 'create' || view === 'universes' || view === 'migrate' || view === 'browse') {
				navigatePools({ view })
				return
			}
			const current = parsePoolsRouteHash(getCurrentRouteHash())
			if (view === 'operate' && current?.view === 'operate') return
			navigatePools({ view: 'browse' })
		},
		[navigatePools],
	)

	return {
		...state,
		openQuestionLedgerInUniverse,
		setActiveUniverseId,
		setPoolBrowseState,
		setVaultAddress,
		setVaultView,
		setOpenOracleReport,
		setQuestionLedgersView,
		setQuestionLedgerAddress,
		setQuestionLedgerQuestionId,
	}
}
