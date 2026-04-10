import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { readOpenOracleReportIdQueryParam, readSecurityPoolQueryParam, readUniverseQueryParam, writeOpenOracleReportIdQueryParam, writeSecurityPoolQueryParam, writeUniverseQueryParam } from '../lib/urlParams.js'

type UrlState = {
	activeUniverseId: bigint
	openOracleReportId: string
	securityPoolAddress: string
}

type UseUrlStateResult = UrlState & {
	setActiveUniverseId: (universeId: bigint | undefined) => void
	setOpenOracleReport: (reportId: string | undefined) => void
	setSecurityPoolAddress: (securityPoolAddress: string) => void
}

function readUrlState(search: string): UrlState {
	return {
		activeUniverseId: readUniverseQueryParam(search) ?? 0n,
		openOracleReportId: readOpenOracleReportIdQueryParam(search) ?? '',
		securityPoolAddress: readSecurityPoolQueryParam(search) ?? '',
	}
}

function replaceCurrentUrl(nextSearch: string) {
	window.history.replaceState({}, '', `${window.location.pathname}${nextSearch}${window.location.hash}`)
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

	const setActiveUniverseId = (universeId: bigint | undefined) => {
		const nextSearch = writeUniverseQueryParam(window.location.search, universeId)
		replaceCurrentUrl(nextSearch)
		urlState.value = readUrlState(nextSearch)
	}

	const setSecurityPoolAddress = (securityPoolAddress: string) => {
		const nextSearch = writeSecurityPoolQueryParam(window.location.search, securityPoolAddress === '' ? undefined : securityPoolAddress)
		replaceCurrentUrl(nextSearch)
		urlState.value = readUrlState(nextSearch)
	}

	const setOpenOracleReport = (reportId: string | undefined) => {
		const nextSearch = writeOpenOracleReportIdQueryParam(window.location.search, reportId === '' ? undefined : reportId)
		replaceCurrentUrl(nextSearch)
		urlState.value = readUrlState(nextSearch)
	}

	return {
		activeUniverseId: urlState.value.activeUniverseId,
		openOracleReportId: urlState.value.openOracleReportId,
		securityPoolAddress: urlState.value.securityPoolAddress,
		setActiveUniverseId,
		setOpenOracleReport,
		setSecurityPoolAddress,
	}
}
