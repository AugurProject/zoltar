import { useCallback } from 'preact/hooks'
import { useUrlSearchState, type UrlHistoryMode } from '@zoltar/ui-core-shared/app/hooks/useUrlSearchState.js'
import { isHexAddressInput } from '@zoltar/ui-core-shared/lib/address.js'
import { getCurrentRouteHash, getRouteHashSearch } from '@zoltar/ui-core-shared/navigation/routing.js'
import { readOpenOracleReportIdQueryParam, readOpenOracleViewQueryParam, writeOpenOracleReportIdQueryParam, writeOpenOracleViewQueryParam } from '@zoltar/ui-core-shared/navigation/openOracleUrlParams.js'
import { readSecurityPoolQuestionIdQueryParam, readUniverseQueryParam, updateSearchParams, setOrDeleteSearchParam, writeUniverseQueryParam } from '@zoltar/ui-core-shared/navigation/urlParams.js'
import { buildPoolsRouteHash, mapLegacyStatoblastHash, parsePoolsRouteHash, type PoolsLocation } from '@zoltar/ui-statoblast-shared/lib/statoblastLocation.js'

type StatoblastUrlState = {
	activeUniverseId: bigint
	openOracleView: string
	openOracleReportId: string
	securityPoolsView: string
	selectedPoolView: string
	securityPoolAddress: string
	securityPoolQuestionId: string
}

const QUESTION_ID_QUERY_PARAM = 'questionId'

/** Reads the pool location from the hash path and the remaining view state from its query. */
function readStatoblastUrlState(search: string, routeHash: string): StatoblastUrlState {
	const poolsLocation = parsePoolsRouteHash(routeHash)
	return {
		activeUniverseId: readUniverseQueryParam(search) ?? 0n,
		openOracleView: readOpenOracleViewQueryParam(search) ?? '',
		openOracleReportId: readOpenOracleReportIdQueryParam(search) ?? '',
		securityPoolsView: poolsLocation?.view ?? 'open',
		selectedPoolView: poolsLocation?.view === 'operate' ? poolsLocation.tab : '',
		securityPoolAddress: poolsLocation?.view === 'operate' ? poolsLocation.securityPoolAddress : '',
		securityPoolQuestionId: readSecurityPoolQuestionIdQueryParam(search) ?? '',
	}
}

function withoutQuestionId(search: string) {
	return updateSearchParams(search, params => params.delete(QUESTION_ID_QUERY_PARAM))
}

export function useStatoblastUrlState() {
	// A legacy `#/security-pools` link is rewritten in place so every reader sees the path-based pool location.
	const { navigate: navigateUrl, state } = useUrlSearchState(readStatoblastUrlState, { mapLegacyHash: mapLegacyStatoblastHash })
	const updateSearch = useCallback((update: (search: string) => string, historyMode: UrlHistoryMode = 'push') => navigateUrl(getCurrentRouteHash(), update(getRouteHashSearch()), historyMode), [navigateUrl])
	const navigatePools = useCallback((location: PoolsLocation, historyMode: UrlHistoryMode = 'push') => navigateUrl(buildPoolsRouteHash(location), location.view === 'create' ? getRouteHashSearch() : withoutQuestionId(getRouteHashSearch()), historyMode), [navigateUrl])

	const setActiveUniverseId = useCallback((universeId: bigint | undefined) => updateSearch(search => writeUniverseQueryParam(search, universeId)), [updateSearch])
	// Editing keeps one history entry per editing session: moving away from a complete address pushes, and replacing a partial address replaces that entry, so Back returns to the previous pool.
	const setSecurityPoolAddress = useCallback(
		(securityPoolAddress: string) => {
			const current = parsePoolsRouteHash(getCurrentRouteHash())
			const currentAddress = current?.view === 'operate' ? current.securityPoolAddress : ''
			const currentIsPartial = currentAddress !== '' && !isHexAddressInput(currentAddress)
			const nextAddress = securityPoolAddress.trim()
			navigatePools(nextAddress === '' ? { view: 'browse' } : { securityPoolAddress: nextAddress, tab: '', view: 'operate' }, currentIsPartial ? 'replace' : 'push')
		},
		[navigatePools],
	)
	const setSecurityPoolQuestionId = useCallback(
		(questionId: string | undefined) => {
			const nextSearch = updateSearchParams(getRouteHashSearch(), params => setOrDeleteSearchParam(params, QUESTION_ID_QUERY_PARAM, questionId))
			if ((questionId?.trim() ?? '') === '') {
				navigateUrl(getCurrentRouteHash(), nextSearch)
				return
			}
			navigateUrl(buildPoolsRouteHash({ view: 'create' }), nextSearch)
		},
		[navigateUrl],
	)
	const setOpenOracleReport = useCallback((reportId: string | undefined, historyMode: UrlHistoryMode = 'push') => updateSearch(search => writeOpenOracleReportIdQueryParam(search, reportId), historyMode), [updateSearch])
	const setOpenOracleView = useCallback((view: string | undefined) => updateSearch(search => writeOpenOracleViewQueryParam(search, view)), [updateSearch])
	const setSecurityPoolsView = useCallback(
		(view: string | undefined) => {
			if (view === 'open' || view === 'create' || view === 'universes' || view === 'browse') {
				navigatePools({ view })
				return
			}
			const current = parsePoolsRouteHash(getCurrentRouteHash())
			if (view === 'operate' && current?.view === 'operate') return
			navigatePools({ view: 'browse' })
		},
		[navigatePools],
	)
	const setSelectedPoolView = useCallback(
		(view: string | undefined) => {
			const current = parsePoolsRouteHash(getCurrentRouteHash())
			if (current?.view !== 'operate') return
			navigatePools({ securityPoolAddress: current.securityPoolAddress, tab: view ?? '', view: 'operate' })
		},
		[navigatePools],
	)

	return {
		...state,
		setActiveUniverseId,
		setOpenOracleReport,
		setOpenOracleView,
		setSecurityPoolsView,
		setSelectedPoolView,
		setSecurityPoolAddress,
		setSecurityPoolQuestionId,
	}
}
