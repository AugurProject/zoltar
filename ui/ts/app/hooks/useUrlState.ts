import { useSignal } from '@preact/signals'
import { useCallback, useEffect } from 'preact/hooks'
import { buildRouteHref, getCurrentRouteHash, getRouteHashSearch } from '../../lib/routing.js'
import {
	readOpenOracleViewQueryParam,
	readOpenOracleReportIdQueryParam,
	readSecurityPoolsViewQueryParam,
	readSecurityPoolQueryParam,
	readSelectedPoolViewQueryParam,
	readUniverseQueryParam,
	readZoltarViewQueryParam,
	writeOpenOracleViewQueryParam,
	writeOpenOracleReportIdQueryParam,
	writeSecurityPoolsViewQueryParam,
	writeSecurityPoolQueryParam,
	writeSelectedPoolViewQueryParam,
	writeUniverseQueryParam,
	writeZoltarViewQueryParam,
} from '../../lib/urlParams.js'

type UrlState = {
	activeUniverseId: bigint
	openOracleView: string
	openOracleReportId: string
	securityPoolsView: string
	selectedPoolView: string
	securityPoolAddress: string
	zoltarView: string
}

type UseUrlStateResult = UrlState & {
	setActiveUniverseId: (universeId: bigint | undefined) => void
	setOpenOracleReport: (reportId: string | undefined) => void
	setOpenOracleView: (view: string | undefined) => void
	setSecurityPoolsView: (view: string | undefined) => void
	setSelectedPoolView: (view: string | undefined) => void
	setSecurityPoolAddress: (securityPoolAddress: string) => void
	setZoltarView: (view: string | undefined) => void
}

function readUrlState(search: string): UrlState {
	return {
		activeUniverseId: readUniverseQueryParam(search) ?? 0n,
		openOracleView: readOpenOracleViewQueryParam(search) ?? '',
		openOracleReportId: readOpenOracleReportIdQueryParam(search) ?? '',
		securityPoolsView: readSecurityPoolsViewQueryParam(search) ?? '',
		selectedPoolView: readSelectedPoolViewQueryParam(search) ?? '',
		securityPoolAddress: readSecurityPoolQueryParam(search) ?? '',
		zoltarView: readZoltarViewQueryParam(search) ?? '',
	}
}

function getCurrentUrlStateSearch() {
	return getRouteHashSearch()
}

function readCurrentUrlState() {
	return readUrlState(getCurrentUrlStateSearch())
}

function pushCurrentUrl(nextSearch: string) {
	window.history.pushState({}, '', buildRouteHref(getCurrentRouteHash(), nextSearch))
}

export function useUrlState(): UseUrlStateResult {
	const urlState = useSignal<UrlState>(readCurrentUrlState())

	useEffect(() => {
		const syncUrlState = () => {
			urlState.value = readCurrentUrlState()
		}

		window.addEventListener('hashchange', syncUrlState)
		window.addEventListener('popstate', syncUrlState)
		return () => {
			window.removeEventListener('hashchange', syncUrlState)
			window.removeEventListener('popstate', syncUrlState)
		}
	}, [])

	const applyUrlStateUpdate = useCallback((nextSearch: string) => {
		if (nextSearch === getCurrentUrlStateSearch()) return
		pushCurrentUrl(nextSearch)
		urlState.value = readUrlState(nextSearch)
	}, [])

	const setActiveUniverseId = useCallback(
		(universeId: bigint | undefined) => {
			const nextSearch = writeUniverseQueryParam(getCurrentUrlStateSearch(), universeId)
			applyUrlStateUpdate(nextSearch)
		},
		[applyUrlStateUpdate],
	)

	const setSecurityPoolAddress = useCallback(
		(securityPoolAddress: string) => {
			const nextSearch = writeSecurityPoolQueryParam(getCurrentUrlStateSearch(), securityPoolAddress === '' ? undefined : securityPoolAddress)
			applyUrlStateUpdate(nextSearch)
		},
		[applyUrlStateUpdate],
	)

	const setOpenOracleReport = useCallback(
		(reportId: string | undefined) => {
			const nextSearch = writeOpenOracleReportIdQueryParam(getCurrentUrlStateSearch(), reportId === '' ? undefined : reportId)
			applyUrlStateUpdate(nextSearch)
		},
		[applyUrlStateUpdate],
	)

	const setOpenOracleView = useCallback(
		(view: string | undefined) => {
			const nextSearch = writeOpenOracleViewQueryParam(getCurrentUrlStateSearch(), view === '' ? undefined : view)
			applyUrlStateUpdate(nextSearch)
		},
		[applyUrlStateUpdate],
	)

	const setSecurityPoolsView = useCallback(
		(view: string | undefined) => {
			const nextSearch = writeSecurityPoolsViewQueryParam(getCurrentUrlStateSearch(), view === '' ? undefined : view)
			applyUrlStateUpdate(nextSearch)
		},
		[applyUrlStateUpdate],
	)

	const setSelectedPoolView = useCallback(
		(view: string | undefined) => {
			const nextSearch = writeSelectedPoolViewQueryParam(getCurrentUrlStateSearch(), view === '' ? undefined : view)
			applyUrlStateUpdate(nextSearch)
		},
		[applyUrlStateUpdate],
	)

	const setZoltarView = useCallback(
		(view: string | undefined) => {
			const nextSearch = writeZoltarViewQueryParam(getCurrentUrlStateSearch(), view === '' ? undefined : view)
			applyUrlStateUpdate(nextSearch)
		},
		[applyUrlStateUpdate],
	)

	return {
		activeUniverseId: urlState.value.activeUniverseId,
		openOracleView: urlState.value.openOracleView,
		openOracleReportId: urlState.value.openOracleReportId,
		securityPoolsView: urlState.value.securityPoolsView,
		selectedPoolView: urlState.value.selectedPoolView,
		securityPoolAddress: urlState.value.securityPoolAddress,
		zoltarView: urlState.value.zoltarView,
		setActiveUniverseId,
		setOpenOracleReport,
		setOpenOracleView,
		setSecurityPoolsView,
		setSelectedPoolView,
		setSecurityPoolAddress,
		setZoltarView,
	}
}
