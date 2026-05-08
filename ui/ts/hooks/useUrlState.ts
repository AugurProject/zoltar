import { useSignal } from '@preact/signals'
import { useCallback, useEffect } from 'preact/hooks'
import {
	readOpenOracleReportIdQueryParam,
	readSecurityPoolQueryParam,
	readSelectedPoolViewQueryParam,
	readUniverseQueryParam,
	readZoltarViewQueryParam,
	writeOpenOracleReportIdQueryParam,
	writeSecurityPoolQueryParam,
	writeSelectedPoolViewQueryParam,
	writeUniverseQueryParam,
	writeZoltarViewQueryParam,
} from '../lib/urlParams.js'

type UrlState = {
	activeUniverseId: bigint
	openOracleReportId: string
	selectedPoolView: string
	securityPoolAddress: string
	zoltarView: string
}

type UseUrlStateResult = UrlState & {
	setActiveUniverseId: (universeId: bigint | undefined) => void
	setOpenOracleReport: (reportId: string | undefined) => void
	setSelectedPoolView: (view: string | undefined) => void
	setSecurityPoolAddress: (securityPoolAddress: string) => void
	setZoltarView: (view: string | undefined) => void
}

function readUrlState(search: string): UrlState {
	return {
		activeUniverseId: readUniverseQueryParam(search) ?? 0n,
		openOracleReportId: readOpenOracleReportIdQueryParam(search) ?? '',
		selectedPoolView: readSelectedPoolViewQueryParam(search) ?? '',
		securityPoolAddress: readSecurityPoolQueryParam(search) ?? '',
		zoltarView: readZoltarViewQueryParam(search) ?? '',
	}
}

function pushCurrentUrl(nextSearch: string) {
	window.history.pushState({}, '', `${window.location.pathname}${nextSearch}${window.location.hash}`)
}

export function useUrlState(): UseUrlStateResult {
	const urlState = useSignal<UrlState>(readUrlState(window.location.search))

	useEffect(() => {
		const onPopState = () => {
			urlState.value = readUrlState(window.location.search)
		}

		window.addEventListener('popstate', onPopState)
		return () => {
			window.removeEventListener('popstate', onPopState)
		}
	}, [])

	const applyUrlStateUpdate = useCallback((nextSearch: string) => {
		if (nextSearch === window.location.search) return
		pushCurrentUrl(nextSearch)
		urlState.value = readUrlState(nextSearch)
	}, [])

	const setActiveUniverseId = useCallback(
		(universeId: bigint | undefined) => {
			const nextSearch = writeUniverseQueryParam(window.location.search, universeId)
			applyUrlStateUpdate(nextSearch)
		},
		[applyUrlStateUpdate],
	)

	const setSecurityPoolAddress = useCallback(
		(securityPoolAddress: string) => {
			const nextSearch = writeSecurityPoolQueryParam(window.location.search, securityPoolAddress === '' ? undefined : securityPoolAddress)
			applyUrlStateUpdate(nextSearch)
		},
		[applyUrlStateUpdate],
	)

	const setOpenOracleReport = useCallback(
		(reportId: string | undefined) => {
			const nextSearch = writeOpenOracleReportIdQueryParam(window.location.search, reportId === '' ? undefined : reportId)
			applyUrlStateUpdate(nextSearch)
		},
		[applyUrlStateUpdate],
	)

	const setSelectedPoolView = useCallback(
		(view: string | undefined) => {
			const nextSearch = writeSelectedPoolViewQueryParam(window.location.search, view === '' ? undefined : view)
			applyUrlStateUpdate(nextSearch)
		},
		[applyUrlStateUpdate],
	)

	const setZoltarView = useCallback(
		(view: string | undefined) => {
			const nextSearch = writeZoltarViewQueryParam(window.location.search, view === '' ? undefined : view)
			applyUrlStateUpdate(nextSearch)
		},
		[applyUrlStateUpdate],
	)

	return {
		activeUniverseId: urlState.value.activeUniverseId,
		openOracleReportId: urlState.value.openOracleReportId,
		selectedPoolView: urlState.value.selectedPoolView,
		securityPoolAddress: urlState.value.securityPoolAddress,
		zoltarView: urlState.value.zoltarView,
		setActiveUniverseId,
		setOpenOracleReport,
		setSelectedPoolView,
		setSecurityPoolAddress,
		setZoltarView,
	}
}
