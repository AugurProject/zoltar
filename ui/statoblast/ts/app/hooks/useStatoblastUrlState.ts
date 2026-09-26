import { useSignal } from '@preact/signals'
import { useCallback, useEffect } from 'preact/hooks'
import { isHexAddressInput } from '@zoltar/ui-core-shared/lib/address.js'
import { buildRouteHref, getCurrentRouteHash, getRouteHashSearch, parseRouteHash } from '@zoltar/ui-core-shared/navigation/routing.js'
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

type HistoryMode = 'push' | 'replace'

const QUESTION_ID_QUERY_PARAM = 'questionId'

/** Reads the pool location from the hash path and the remaining view state from its query. */
function readStatoblastUrlState(routeHash: string, search: string): StatoblastUrlState {
	const poolsLocation = parsePoolsRouteHash(routeHash)
	return {
		activeUniverseId: readUniverseQueryParam(search) ?? 0n,
		openOracleView: readOpenOracleViewQueryParam(search) ?? '',
		openOracleReportId: readOpenOracleReportIdQueryParam(search) ?? '',
		securityPoolsView: poolsLocation?.view ?? '',
		selectedPoolView: poolsLocation?.view === 'operate' ? poolsLocation.tab : '',
		securityPoolAddress: poolsLocation?.view === 'operate' ? poolsLocation.securityPoolAddress : '',
		securityPoolQuestionId: readSecurityPoolQuestionIdQueryParam(search) ?? '',
	}
}

function readCurrentUrlState() {
	const legacyHash = mapLegacyStatoblastHash(window.location.hash)
	if (legacyHash === undefined) return readStatoblastUrlState(getCurrentRouteHash(), getRouteHashSearch())
	const { routeHash, search } = parseRouteHash(legacyHash)
	return readStatoblastUrlState(routeHash, search)
}

function withoutQuestionId(search: string) {
	return updateSearchParams(search, params => params.delete(QUESTION_ID_QUERY_PARAM))
}

/** Rewrites a legacy `#/security-pools` link in place so every reader sees the path-based pool location. */
function canonicalizeLegacyHash() {
	const legacyHash = mapLegacyStatoblastHash(window.location.hash)
	if (legacyHash !== undefined) window.history.replaceState(window.history.state, '', legacyHash)
}

export function useStatoblastUrlState() {
	const urlState = useSignal<StatoblastUrlState>(readCurrentUrlState())

	useEffect(() => {
		const syncUrlState = () => {
			canonicalizeLegacyHash()
			urlState.value = readCurrentUrlState()
		}
		syncUrlState()
		window.addEventListener('hashchange', syncUrlState)
		window.addEventListener('popstate', syncUrlState)
		return () => {
			window.removeEventListener('hashchange', syncUrlState)
			window.removeEventListener('popstate', syncUrlState)
		}
	}, [urlState])

	const navigateUrl = useCallback(
		(nextRouteHash: string, nextSearch: string, historyMode: HistoryMode = 'push') => {
			const currentRouteHash = getCurrentRouteHash()
			if (nextRouteHash !== currentRouteHash || nextSearch !== getRouteHashSearch()) {
				const nextHref = buildRouteHref(nextRouteHash, nextSearch)
				if (historyMode === 'replace') window.history.replaceState({}, '', nextHref)
				else window.history.pushState({}, '', nextHref)
				// History writes do not fire hashchange; the route signal still has to observe a path change.
				if (nextRouteHash !== currentRouteHash) window.dispatchEvent(new Event('hashchange'))
			}
			urlState.value = readStatoblastUrlState(nextRouteHash, nextSearch)
		},
		[urlState],
	)
	const updateSearch = useCallback((update: (search: string) => string, historyMode: HistoryMode = 'push') => navigateUrl(getCurrentRouteHash(), update(getRouteHashSearch()), historyMode), [navigateUrl])
	const navigatePools = useCallback((location: PoolsLocation, historyMode: HistoryMode = 'push') => navigateUrl(buildPoolsRouteHash(location), location.view === 'create' ? getRouteHashSearch() : withoutQuestionId(getRouteHashSearch()), historyMode), [navigateUrl])

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
	const setOpenOracleReport = useCallback((reportId: string | undefined, historyMode: HistoryMode = 'push') => updateSearch(search => writeOpenOracleReportIdQueryParam(search, reportId), historyMode), [updateSearch])
	const setOpenOracleView = useCallback((view: string | undefined) => updateSearch(search => writeOpenOracleViewQueryParam(search, view)), [updateSearch])
	const setSecurityPoolsView = useCallback(
		(view: string | undefined) => {
			if (view === 'create' || view === 'universes' || view === 'browse') {
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
		...urlState.value,
		setActiveUniverseId,
		setOpenOracleReport,
		setOpenOracleView,
		setSecurityPoolsView,
		setSelectedPoolView,
		setSecurityPoolAddress,
		setSecurityPoolQuestionId,
	}
}
